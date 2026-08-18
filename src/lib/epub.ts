import { buildZip, readZipEntries, type ZipEntry } from "./zip";

const escapeXml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Extract readable text from an EPUB ebook buffer */
export const extractTextFromEpub = async (data: Uint8Array): Promise<string> => {
  const entries = await readZipEntries(data);
  const htmlEntries = entries.filter((e) => /\.(xhtml|html|htm)$/i.test(e.name));

  if (!htmlEntries.length) {
    throw new Error("Invalid EPUB file: No HTML chapters found");
  }

  const chapters: string[] = [];
  for (const entry of htmlEntries) {
    const text = new TextDecoder().decode(entry.data);
    // Strip XML/HTML tags
    const cleanText = text
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n# $1\n\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\n\s+\n/g, "\n\n")
      .trim();

    if (cleanText) chapters.push(cleanText);
  }

  return chapters.join("\n\n---\n\n");
};

/** Create a standard EPUB 3.0 ebook container from plain text / markdown */
export const createEpubFromText = (text: string, title = "Converted Document", author = "UtiliBox"): Uint8Array => {
  const lines = text.split(/\r?\n/);
  const htmlBody = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<p>&nbsp;</p>";
      if (trimmed.startsWith("# ")) return `<h1>${escapeXml(trimmed.slice(2))}</h1>`;
      if (trimmed.startsWith("## ")) return `<h2>${escapeXml(trimmed.slice(3))}</h2>`;
      if (trimmed.startsWith("### ")) return `<h3>${escapeXml(trimmed.slice(4))}</h3>`;
      return `<p>${escapeXml(line)}</p>`;
    })
    .join("\n");

  const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <style>
    body { font-family: sans-serif; line-height: 1.6; padding: 5%; color: #111827; }
    h1 { color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    h2 { color: #374151; }
    p { margin-bottom: 1em; }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;

  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${Date.now()}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter1"/>
  </spine>
</package>`;

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>${escapeXml(title)}</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

  const utf8 = (s: string) => new TextEncoder().encode(s);

  // In EPUB standard, mimetype MUST be the first uncompressed entry
  const entries: ZipEntry[] = [
    { name: "mimetype", data: utf8("application/epub+zip") },
    { name: "META-INF/container.xml", data: utf8(containerXml) },
    { name: "OEBPS/content.opf", data: utf8(contentOpf) },
    { name: "OEBPS/toc.ncx", data: utf8(tocNcx) },
    { name: "OEBPS/chapter1.xhtml", data: utf8(chapterXhtml) }
  ];

  return buildZip(entries);
};
