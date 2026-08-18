// Pure client-side DOCX reader & writer for UtiliBox
// Generates and parses valid Microsoft Word .docx OpenXML files without external servers.

import { buildZip, readZipTextFile, type ZipEntry } from "./zip";

const escapeXml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Extract clean structured text from a DOCX file buffer */
export const extractTextFromDocx = async (data: Uint8Array): Promise<string> => {
  const xml = await readZipTextFile(data, "word/document.xml");
  if (!xml) {
    throw new Error("Invalid DOCX file: word/document.xml not found");
  }

  // Parse paragraphs and text nodes
  const paragraphs: string[] = [];
  const pMatches = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];

  for (const pXml of pMatches) {
    const isHeading1 = pXml.includes('w:val="Heading1"') || pXml.includes('w:val="Title"');
    const isHeading2 = pXml.includes('w:val="Heading2"');
    const isHeading3 = pXml.includes('w:val="Heading3"');

    const tMatches = pXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
    const textPieces = tMatches.map((t) => t.replace(/<[^>]+>/g, ""));
    const fullText = textPieces.join("").trim();

    if (fullText) {
      if (isHeading1) {
        paragraphs.push(`# ${fullText}`);
      } else if (isHeading2) {
        paragraphs.push(`## ${fullText}`);
      } else if (isHeading3) {
        paragraphs.push(`### ${fullText}`);
      } else {
        paragraphs.push(fullText);
      }
    }
  }

  if (!paragraphs.length) {
    // Fallback: extract all w:t text
    const allText = (xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join(" ");
    return allText.trim();
  }

  return paragraphs.join("\n\n");
};

/** Create standard Microsoft Word DOCX OpenXML archive from plain text / markdown */
export const createDocxFromText = (text: string, title?: string): Uint8Array => {
  const lines = text.split(/\r?\n/);
  const pElements: string[] = [];

  if (title) {
    pElements.push(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Title"/>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:sz w:val="48"/>
            <w:color w:val="111827"/>
          </w:rPr>
          <w:t>${escapeXml(title)}</w:t>
        </w:r>
      </w:p>
    `);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pElements.push("<w:p/>");
      continue;
    }

    if (trimmed.startsWith("# ")) {
      pElements.push(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F2937"/></w:rPr>
            <w:t>${escapeXml(trimmed.slice(2))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("## ")) {
      pElements.push(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="374151"/></w:rPr>
            <w:t>${escapeXml(trimmed.slice(3))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("### ")) {
      pElements.push(`
        <w:p>
          <w:pPr><w:pStyle w:val="Heading3"/></w:pPr>
          <w:r>
            <w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="4B5563"/></w:rPr>
            <w:t>${escapeXml(trimmed.slice(4))}</w:t>
          </w:r>
        </w:p>
      `);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      pElements.push(`
        <w:p>
          <w:pPr>
            <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
          </w:pPr>
          <w:r>
            <w:rPr><w:sz w:val="22"/><w:color w:val="111827"/></w:rPr>
            <w:t>• ${escapeXml(trimmed.slice(2))}</w:t>
          </w:r>
        </w:p>
      `);
    } else {
      pElements.push(`
        <w:p>
          <w:r>
            <w:rPr><w:sz w:val="22"/><w:color w:val="111827"/></w:rPr>
            <w:t xml:space="preserve">${escapeXml(line)}</w:t>
          </w:r>
        </w:p>
      `);
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${pElements.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const utf8 = (s: string) => new TextEncoder().encode(s);

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: utf8(contentTypesXml) },
    { name: "_rels/.rels", data: utf8(relsXml) },
    { name: "word/_rels/document.xml.rels", data: utf8(wordRelsXml) },
    { name: "word/document.xml", data: utf8(documentXml) }
  ];

  return buildZip(entries);
};
