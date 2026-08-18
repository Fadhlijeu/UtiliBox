// UtiliBox · Universal Multi-Format Document Conversion Engine
// Supports zero-server client-side cross-conversion between 16+ file formats.

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { marked } from "marked";
import yaml from "js-yaml";
import { extractTextFromDocx, createDocxFromText } from "../../lib/docx";
import { extractTextFromEpub, createEpubFromText } from "../../lib/epub";
import { extractTextFromRtf, createRtfFromText } from "../../lib/rtf";
import { blobFromBytes } from "../../lib/files";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const getPdfJs = (): Promise<typeof import("pdfjs-dist")> => {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return mod;
    });
  }
  return pdfjsPromise;
};

export type SupportedFormat =
  | "pdf"
  | "docx"
  | "txt"
  | "md"
  | "html"
  | "rtf"
  | "epub"
  | "csv"
  | "json"
  | "xml"
  | "yaml"
  | "png"
  | "jpg"
  | "webp"
  | "bmp"
  | "svg";

export interface FormatMeta {
  ext: SupportedFormat;
  label: string;
  category: "doc" | "data" | "image";
  mime: string;
  icon: string;
}

export const SUPPORTED_FORMATS: FormatMeta[] = [
  // Documents
  { ext: "pdf", label: "PDF Document (.pdf)", category: "doc", mime: "application/pdf", icon: "picture_as_pdf" },
  { ext: "docx", label: "Word Document (.docx)", category: "doc", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", icon: "description" },
  { ext: "txt", label: "Plain Text (.txt)", category: "doc", mime: "text/plain", icon: "article" },
  { ext: "md", label: "Markdown (.md)", category: "doc", mime: "text/markdown", icon: "markdown" },
  { ext: "html", label: "HTML Web Page (.html)", category: "doc", mime: "text/html", icon: "html" },
  { ext: "rtf", label: "Rich Text Format (.rtf)", category: "doc", mime: "application/rtf", icon: "format_align_left" },
  { ext: "epub", label: "EPUB E-Book (.epub)", category: "doc", mime: "application/epub+zip", icon: "menu_book" },

  // Data & Tables
  { ext: "csv", label: "CSV Spreadsheet (.csv)", category: "data", mime: "text/csv", icon: "table_chart" },
  { ext: "json", label: "JSON Data (.json)", category: "data", mime: "application/json", icon: "data_object" },
  { ext: "xml", label: "XML Document (.xml)", category: "data", mime: "application/xml", icon: "code" },
  { ext: "yaml", label: "YAML Configuration (.yaml)", category: "data", mime: "text/yaml", icon: "settings" },

  // Images
  { ext: "png", label: "PNG Image (.png)", category: "image", mime: "image/png", icon: "image" },
  { ext: "jpg", label: "JPEG Image (.jpg)", category: "image", mime: "image/jpeg", icon: "image" },
  { ext: "webp", label: "WebP Image (.webp)", category: "image", mime: "image/webp", icon: "image" },
  { ext: "bmp", label: "BMP Image (.bmp)", category: "image", mime: "image/bmp", icon: "image" },
  { ext: "svg", label: "SVG Vector (.svg)", category: "image", mime: "image/svg+xml", icon: "draw" }
];

export const normalizeFormat = (filenameOrExt: string): SupportedFormat => {
  const ext = filenameOrExt.includes(".")
    ? (filenameOrExt.split(".").pop() ?? "").toLowerCase()
    : filenameOrExt.toLowerCase();

  switch (ext) {
    case "pdf":
      return "pdf";
    case "doc":
    case "docx":
      return "docx";
    case "txt":
    case "text":
    case "log":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    case "htm":
    case "html":
    case "xhtml":
      return "html";
    case "rtf":
      return "rtf";
    case "epub":
      return "epub";
    case "csv":
    case "tsv":
      return "csv";
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpg";
    case "webp":
      return "webp";
    case "bmp":
      return "bmp";
    case "svg":
      return "svg";
    default:
      return "txt";
  }
};

export const getTargetFormatsFor = (source: SupportedFormat): SupportedFormat[] => {
  switch (source) {
    case "pdf":
      return ["docx", "txt", "md", "html", "rtf", "epub", "png", "jpg"];
    case "docx":
      return ["pdf", "txt", "md", "html", "rtf", "epub"];
    case "txt":
      return ["pdf", "docx", "md", "html", "rtf", "epub", "json"];
    case "md":
      return ["pdf", "docx", "html", "txt", "rtf", "epub"];
    case "html":
      return ["pdf", "docx", "md", "txt", "rtf", "epub"];
    case "rtf":
      return ["pdf", "docx", "txt", "md", "html", "epub"];
    case "epub":
      return ["pdf", "docx", "txt", "md", "html"];
    case "csv":
      return ["json", "yaml", "xml", "html", "md", "txt", "pdf"];
    case "json":
      return ["yaml", "xml", "csv", "html", "md", "txt", "pdf"];
    case "xml":
      return ["json", "yaml", "html", "txt", "pdf"];
    case "yaml":
      return ["json", "xml", "csv", "html", "md", "txt", "pdf"];
    case "png":
    case "jpg":
    case "webp":
    case "bmp":
    case "svg":
      return ["pdf", "html", "docx", "png", "jpg", "webp"];
  }
};

/** Unified text extractor for any document format */
export const extractDocumentText = async (data: Uint8Array, sourceExt: SupportedFormat): Promise<string> => {
  switch (sourceExt) {
    case "pdf": {
      try {
        const pdfjs = await getPdfJs();
        const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
        const pageTexts: string[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean);
          pageTexts.push(strings.join(" "));
        }
        return pageTexts.join("\n\n");
      } catch {
        return "PDF Document Text (Encrypted or Scanned Content)";
      }
    }
    case "docx":
      return await extractTextFromDocx(data);
    case "epub":
      return await extractTextFromEpub(data);
    case "rtf":
      return extractTextFromRtf(new TextDecoder().decode(data));
    case "html": {
      const html = new TextDecoder().decode(data);
      return html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
    }
    case "md":
    case "txt":
    case "csv":
    case "json":
    case "xml":
    case "yaml":
      return new TextDecoder().decode(data);
    default:
      return new TextDecoder().decode(data);
  }
};

/** Generate a multi-page PDF from text with proper wrapping, fonts, and pagination */
export const createPdfFromText = async (text: string, title?: string): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 width
  const pageHeight = 841.89; // A4 height
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const fontSize = 11;
  const lineHeight = 16;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  if (title) {
    page.drawText(title, {
      x: margin,
      y: y - 10,
      size: 18,
      font: boldFont,
      color: rgb(0.07, 0.09, 0.15)
    });
    y -= 35;
  }

  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const isHeading = rawLine.startsWith("# ");
    const isSubheading = rawLine.startsWith("## ");
    const cleanLine = isHeading
      ? rawLine.slice(2)
      : isSubheading
      ? rawLine.slice(3)
      : rawLine;

    const currentFont = isHeading || isSubheading ? boldFont : font;
    const currentFontSize = isHeading ? 14 : isSubheading ? 12 : fontSize;
    const currentLineHeight = isHeading ? 22 : isSubheading ? 18 : lineHeight;

    // Word wrapping
    const words = cleanLine.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = currentFont.widthOfTextAtSize(testLine, currentFontSize);

      if (width > maxWidth && currentLine) {
        if (y < margin + 30) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(currentLine, {
          x: margin,
          y,
          size: currentFontSize,
          font: currentFont,
          color: rgb(0.12, 0.15, 0.2)
        });
        y -= currentLineHeight;
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) {
      if (y < margin + 30) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(currentLine, {
        x: margin,
        y,
        size: currentFontSize,
        font: currentFont,
        color: rgb(0.12, 0.15, 0.2)
      });
      y -= currentLineHeight;
    }

    if (!cleanLine.trim()) {
      y -= 8;
    }
  }

  return await pdfDoc.save({ useObjectStreams: true });
};

/** Create a multi-page PDF embedding an image */
export const createPdfFromImage = async (imageData: Uint8Array, mimeType: string): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.create();
  let embeddedImage;
  if (mimeType.includes("png")) {
    embeddedImage = await pdfDoc.embedPng(imageData);
  } else {
    embeddedImage = await pdfDoc.embedJpg(imageData);
  }

  const imgWidth = embeddedImage.width;
  const imgHeight = embeddedImage.height;

  // Fit image to A4 or exact image aspect ratio
  const maxW = 595.28;
  const maxH = 841.89;
  const scale = Math.min(maxW / imgWidth, maxH / imgHeight, 1.0);
  const w = imgWidth * scale;
  const h = imgHeight * scale;

  const page = pdfDoc.addPage([maxW, maxH]);
  page.drawImage(embeddedImage, {
    x: (maxW - w) / 2,
    y: (maxH - h) / 2,
    width: w,
    height: h
  });

  return await pdfDoc.save({ useObjectStreams: true });
};

/** Parse CSV string to JSON array */
export const parseCsvToJson = (csvText: string): Array<Record<string, string>> => {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const parseCsvLine = (line: string): string[] => {
    const values: string[] = [];
    let cur = "";
    let insideQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (c === "," && !insideQuotes) {
        values.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    values.push(cur.trim());
    return values;
  };

  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h || `col_${idx + 1}`] = cols[idx] || "";
    });
    rows.push(obj);
  }

  return rows;
};

/** Convert JSON array/object to CSV string */
export const convertJsonToCsv = (data: unknown): string => {
  const arr = Array.isArray(data) ? data : [data];
  if (!arr.length || typeof arr[0] !== "object" || !arr[0]) {
    return String(data);
  }

  const keys = Object.keys(arr[0] as Record<string, unknown>);
  const headerLine = keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(",");
  const rowLines = arr.map((item) => {
    const obj = (item || {}) as Record<string, unknown>;
    return keys
      .map((k) => {
        const val = obj[k] !== undefined && obj[k] !== null ? String(obj[k]) : "";
        return `"${val.replace(/"/g, '""')}"`;
      })
      .join(",");
  });

  return [headerLine, ...rowLines].join("\n");
};

/** Convert CSV/Table to formatted Markdown table */
export const convertCsvToMarkdownTable = (csvText: string): string => {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return "";

  const rows = lines.map((l) =>
    l
      .split(",")
      .map((c) => c.replace(/^"|"$/g, "").trim())
  );
  if (!rows.length) return "";

  const header = `| ${rows[0].join(" | ")} |`;
  const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows
    .slice(1)
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");

  return [header, separator, body].filter(Boolean).join("\n");
};

/** Convert CSV to styled HTML Table */
export const convertCsvToHtmlTable = (csvText: string, title?: string): string => {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return "<p>Empty Table</p>";

  const rows = lines.map((l) =>
    l
      .split(",")
      .map((c) => c.replace(/^"|"$/g, "").trim())
  );

  const headerHtml = `<tr>${rows[0].map((h) => `<th>${h}</th>`).join("")}</tr>`;
  const bodyHtml = rows
    .slice(1)
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title || "Table Document"}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #111827; }
    h1 { font-size: 20px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th { background: #f3f4f6; text-align: left; padding: 10px 12px; border: 1px solid #e5e7eb; font-weight: 600; }
    td { padding: 8px 12px; border: 1px solid #e5e7eb; }
    tr:nth-child(even) { background: #f9fafb; }
  </style>
</head>
<body>
  ${title ? `<h1>${title}</h1>` : ""}
  <table>
    <thead>${headerHtml}</thead>
    <tbody>${bodyHtml}</tbody>
  </table>
</body>
</html>`;
};

/** Master universal conversion pipeline */
export const convertDocument = async (
  inputData: Uint8Array,
  sourceExt: SupportedFormat,
  targetExt: SupportedFormat,
  options?: { title?: string; fileName?: string }
): Promise<{ blob: Blob; mime: string; name: string }> => {
  const baseTitle = options?.title || (options?.fileName ? options.fileName.replace(/\.[^/.]+$/, "") : "converted_document");
  const utf8 = (s: string) => new TextEncoder().encode(s);

  // 1. Same format passthrough
  if (sourceExt === targetExt) {
    const meta = SUPPORTED_FORMATS.find((f) => f.ext === targetExt);
    return {
      blob: blobFromBytes(inputData, meta?.mime || "application/octet-stream"),
      mime: meta?.mime || "application/octet-stream",
      name: `${baseTitle}.${targetExt}`
    };
  }

  // 2. Image to PDF
  if (["png", "jpg", "webp", "bmp", "svg"].includes(sourceExt) && targetExt === "pdf") {
    const mime = sourceExt === "png" ? "image/png" : "image/jpeg";
    const pdfBytes = await createPdfFromImage(inputData, mime);
    return {
      blob: blobFromBytes(pdfBytes, "application/pdf"),
      mime: "application/pdf",
      name: `${baseTitle}.pdf`
    };
  }

  // 3. Data interconversions (CSV, JSON, YAML, XML)
  if (sourceExt === "csv") {
    const csvString = new TextDecoder().decode(inputData);
    const jsonRows = parseCsvToJson(csvString);

    if (targetExt === "json") {
      const jsonText = JSON.stringify(jsonRows, null, 2);
      return { blob: new Blob([utf8(jsonText)], { type: "application/json" }), mime: "application/json", name: `${baseTitle}.json` };
    }
    if (targetExt === "yaml") {
      const yamlText = yaml.dump(jsonRows);
      return { blob: new Blob([utf8(yamlText)], { type: "text/yaml" }), mime: "text/yaml", name: `${baseTitle}.yaml` };
    }
    if (targetExt === "xml") {
      const xmlBody = jsonRows.map((r) => `  <item>\n${Object.entries(r).map(([k, v]) => `    <${k}>${v}</${k}>`).join("\n")}\n  </item>`).join("\n");
      const xmlText = `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n${xmlBody}\n</root>`;
      return { blob: new Blob([utf8(xmlText)], { type: "application/xml" }), mime: "application/xml", name: `${baseTitle}.xml` };
    }
    if (targetExt === "md") {
      const mdTable = convertCsvToMarkdownTable(csvString);
      return { blob: new Blob([utf8(mdTable)], { type: "text/markdown" }), mime: "text/markdown", name: `${baseTitle}.md` };
    }
    if (targetExt === "html") {
      const htmlTable = convertCsvToHtmlTable(csvString, baseTitle);
      return { blob: new Blob([utf8(htmlTable)], { type: "text/html" }), mime: "text/html", name: `${baseTitle}.html` };
    }
    if (targetExt === "pdf") {
      const mdTable = convertCsvToMarkdownTable(csvString);
      const pdfBytes = await createPdfFromText(mdTable, baseTitle);
      return { blob: blobFromBytes(pdfBytes, "application/pdf"), mime: "application/pdf", name: `${baseTitle}.pdf` };
    }
  }

  if (sourceExt === "json") {
    const jsonString = new TextDecoder().decode(inputData);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonString);
    } catch {
      parsedJson = { text: jsonString };
    }

    if (targetExt === "csv") {
      const csv = convertJsonToCsv(parsedJson);
      return { blob: new Blob([utf8(csv)], { type: "text/csv" }), mime: "text/csv", name: `${baseTitle}.csv` };
    }
    if (targetExt === "yaml") {
      const yml = yaml.dump(parsedJson);
      return { blob: new Blob([utf8(yml)], { type: "text/yaml" }), mime: "text/yaml", name: `${baseTitle}.yaml` };
    }
    if (targetExt === "xml") {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<data>\n${typeof parsedJson === "object" ? Object.entries(parsedJson as Record<string, unknown>).map(([k, v]) => `  <${k}>${typeof v === "object" ? JSON.stringify(v) : v}</${k}>`).join("\n") : `  <value>${parsedJson}</value>`}\n</data>`;
      return { blob: new Blob([utf8(xml)], { type: "application/xml" }), mime: "application/xml", name: `${baseTitle}.xml` };
    }
  }

  if (sourceExt === "yaml") {
    const yamlString = new TextDecoder().decode(inputData);
    let parsed: unknown;
    try {
      parsed = yaml.load(yamlString);
    } catch {
      parsed = { text: yamlString };
    }

    if (targetExt === "json") {
      const json = JSON.stringify(parsed, null, 2);
      return { blob: new Blob([utf8(json)], { type: "application/json" }), mime: "application/json", name: `${baseTitle}.json` };
    }
    if (targetExt === "csv") {
      const csv = convertJsonToCsv(parsed);
      return { blob: new Blob([utf8(csv)], { type: "text/csv" }), mime: "text/csv", name: `${baseTitle}.csv` };
    }
  }

  // 4. General Document Extraction & Target Synthesis
  const textContent = await extractDocumentText(inputData, sourceExt);

  switch (targetExt) {
    case "pdf": {
      const pdfBytes = await createPdfFromText(textContent, baseTitle);
      return { blob: blobFromBytes(pdfBytes, "application/pdf"), mime: "application/pdf", name: `${baseTitle}.pdf` };
    }
    case "docx": {
      const docxBytes = createDocxFromText(textContent, baseTitle);
      return { blob: blobFromBytes(docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: `${baseTitle}.docx` };
    }
    case "epub": {
      const epubBytes = createEpubFromText(textContent, baseTitle);
      return { blob: blobFromBytes(epubBytes, "application/epub+zip"), mime: "application/epub+zip", name: `${baseTitle}.epub` };
    }
    case "rtf": {
      const rtfString = createRtfFromText(textContent, baseTitle);
      return { blob: blobFromBytes(utf8(rtfString), "application/rtf"), mime: "application/rtf", name: `${baseTitle}.rtf` };
    }
    case "html": {
      const htmlBody = sourceExt === "md" ? await marked.parse(textContent) : textContent.split(/\r?\n/).map((l) => `<p>${l}</p>`).join("\n");
      const fullHtml = `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>${baseTitle}</title>\n  <style>\n    body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111827; }\n    h1, h2, h3 { color: #1f2937; }\n    table { border-collapse: collapse; width: 100%; margin: 16px 0; }\n    th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }\n    th { background: #f3f4f6; }\n  </style>\n</head>\n<body>\n  <h1>${baseTitle}</h1>\n  ${htmlBody}\n</body>\n</html>`;
      return { blob: new Blob([utf8(fullHtml)], { type: "text/html" }), mime: "text/html", name: `${baseTitle}.html` };
    }
    case "md": {
      return { blob: new Blob([utf8(textContent)], { type: "text/markdown" }), mime: "text/markdown", name: `${baseTitle}.md` };
    }
    case "txt": {
      return { blob: new Blob([utf8(textContent)], { type: "text/plain" }), mime: "text/plain", name: `${baseTitle}.txt` };
    }
    case "csv": {
      return { blob: new Blob([utf8(textContent)], { type: "text/csv" }), mime: "text/csv", name: `${baseTitle}.csv` };
    }
    case "json": {
      const jsonObj = { title: baseTitle, text: textContent };
      return { blob: new Blob([utf8(JSON.stringify(jsonObj, null, 2))], { type: "application/json" }), mime: "application/json", name: `${baseTitle}.json` };
    }
    case "xml": {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<document>\n  <title>${baseTitle}</title>\n  <content>${textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</content>\n</document>`;
      return { blob: new Blob([utf8(xml)], { type: "application/xml" }), mime: "application/xml", name: `${baseTitle}.xml` };
    }
    case "yaml": {
      const yml = yaml.dump({ title: baseTitle, content: textContent });
      return { blob: new Blob([utf8(yml)], { type: "text/yaml" }), mime: "text/yaml", name: `${baseTitle}.yaml` };
    }
    default: {
      return { blob: new Blob([utf8(textContent)], { type: "text/plain" }), mime: "text/plain", name: `${baseTitle}.txt` };
    }
  }
};
