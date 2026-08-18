import { describe, it, expect } from "vitest";
import {
  convertDocument,
  normalizeFormat,
  getTargetFormatsFor,
  extractDocumentText,
  createPdfFromText,
  parseCsvToJson,
  convertJsonToCsv,
  convertCsvToMarkdownTable,
  convertCsvToHtmlTable,
  SUPPORTED_FORMATS,
  type SupportedFormat
} from "../src/tools/convert/engine";
import { createDocxFromText, extractTextFromDocx } from "../src/lib/docx";
import { createEpubFromText, extractTextFromEpub } from "../src/lib/epub";
import { createRtfFromText, extractTextFromRtf } from "../src/lib/rtf";
import { buildZip, readZipEntries, readZipTextFile } from "../src/lib/zip";

// ── Dummy File Generators for All Formats ────────────────────────
const utf8 = (s: string) => new TextEncoder().encode(s);

const DUMMY_TEXT = `# UtiliBox Test Document\n\nUtiliBox is a universal toolkit.\n\n## Features\n\n- Multi-format conversion\n- 100% Client-side\n- Privacy First`;

// 1x1 transparent PNG binary bytes
const DUMMY_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

// 1x1 JPEG binary bytes
const DUMMY_JPG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9
]);

const createDummyFiles = async (): Promise<Record<SupportedFormat, Uint8Array>> => {
  const pdfBytes = await createPdfFromText(DUMMY_TEXT, "UtiliBox PDF Sample");
  const docxBytes = createDocxFromText(DUMMY_TEXT, "UtiliBox Word Sample");
  const epubBytes = createEpubFromText(DUMMY_TEXT, "UtiliBox EPUB Sample");
  const rtfText = createRtfFromText(DUMMY_TEXT, "UtiliBox RTF Sample");

  return {
    pdf: pdfBytes,
    docx: docxBytes,
    txt: utf8(DUMMY_TEXT),
    md: utf8(DUMMY_TEXT),
    html: utf8(`<!DOCTYPE html><html><head><title>UtiliBox</title></head><body><h1>UtiliBox Test</h1><p>Universal client-side toolkit</p></body></html>`),
    rtf: utf8(rtfText),
    epub: epubBytes,
    csv: utf8("id,name,role,department\n1,Alice,Engineer,Tech\n2,Bob,Designer,Design\n3,Charlie,Product,Management"),
    json: utf8(JSON.stringify([{ id: 1, name: "Alice", role: "Engineer" }, { id: 2, name: "Bob", role: "Designer" }], null, 2)),
    xml: utf8(`<?xml version="1.0" encoding="UTF-8"?><root><item><id>1</id><name>Alice</name></item></root>`),
    yaml: utf8(`app: UtiliBox\nversion: 0.1.0\nfeatures:\n  - documents\n  - convert`),
    png: DUMMY_PNG_BYTES,
    jpg: DUMMY_JPG_BYTES,
    webp: DUMMY_PNG_BYTES,
    bmp: DUMMY_PNG_BYTES,
    svg: utf8(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" stroke="black" stroke-width="3" fill="red" /></svg>`)
  };
};

describe("Convert Document · Format Registry & Normalization", () => {
  it("should have 16 supported formats in registry", () => {
    expect(SUPPORTED_FORMATS.length).toBe(16);
  });

  it("should correctly normalize file extensions", () => {
    expect(normalizeFormat("report.pdf")).toBe("pdf");
    expect(normalizeFormat("doc.docx")).toBe("docx");
    expect(normalizeFormat("doc.DOC")).toBe("docx");
    expect(normalizeFormat("notes.txt")).toBe("txt");
    expect(normalizeFormat("readme.markdown")).toBe("md");
    expect(normalizeFormat("page.html")).toBe("html");
    expect(normalizeFormat("page.HTM")).toBe("html");
    expect(normalizeFormat("sheet.csv")).toBe("csv");
    expect(normalizeFormat("data.json")).toBe("json");
    expect(normalizeFormat("config.yaml")).toBe("yaml");
    expect(normalizeFormat("config.yml")).toBe("yaml");
    expect(normalizeFormat("photo.jpeg")).toBe("jpg");
    expect(normalizeFormat("vector.svg")).toBe("svg");
    expect(normalizeFormat("book.epub")).toBe("epub");
    expect(normalizeFormat("letter.rtf")).toBe("rtf");
  });

  it("should provide valid target conversion lists for each source format", () => {
    for (const f of SUPPORTED_FORMATS) {
      const targets = getTargetFormatsFor(f.ext);
      expect(targets).toBeDefined();
      expect(targets.length).toBeGreaterThan(0);
    }
  });
});

describe("Convert Document · Pure Client-Side Engines (ZIP / DOCX / EPUB / RTF)", () => {
  it("should create and read standard ZIP archives", async () => {
    const entries = [
      { name: "hello.txt", data: utf8("Hello UtiliBox!") },
      { name: "sub/test.json", data: utf8('{"status":"ok"}') }
    ];
    const zipBytes = buildZip(entries);
    expect(zipBytes.length).toBeGreaterThan(50);

    const readEntries = await readZipEntries(zipBytes);
    expect(readEntries.length).toBe(2);
    expect(readEntries[0].name).toBe("hello.txt");
    expect(new TextDecoder().decode(readEntries[0].data)).toBe("Hello UtiliBox!");

    const text = await readZipTextFile(zipBytes, "sub/test.json");
    expect(text).toBe('{"status":"ok"}');
  });

  it("should create and extract valid DOCX files", async () => {
    const docxBytes = createDocxFromText("# Project Plan\n\n- Task 1: Complete\n- Task 2: In Progress", "UtiliBox Plan");
    expect(docxBytes.length).toBeGreaterThan(500);

    const extracted = await extractTextFromDocx(docxBytes);
    expect(extracted).toContain("Project Plan");
    expect(extracted).toContain("Task 1: Complete");
  });

  it("should create and extract valid EPUB 3.0 ebooks", async () => {
    const epubBytes = createEpubFromText("# Chapter 1\n\nOnce upon a time in UtiliBox...", "My Story");
    expect(epubBytes.length).toBeGreaterThan(500);

    const extracted = await extractTextFromEpub(epubBytes);
    expect(extracted).toContain("Chapter 1");
    expect(extracted).toContain("Once upon a time");
  });

  it("should create and extract valid RTF documents", () => {
    const rtf = createRtfFromText("# Meeting Notes\n\nDiscussion points:\n- Point A\n- Point B", "UtiliBox Notes");
    expect(rtf).toContain("{\\rtf1");

    const extracted = extractTextFromRtf(rtf);
    expect(extracted).toContain("Meeting Notes");
    expect(extracted).toContain("Point A");
  });
});

describe("Convert Document · Tabular & Data Helpers (CSV / JSON / YAML / XML)", () => {
  const csvSample = "name,age,city\nAlice,30,Jakarta\nBob,25,Bandung";

  it("should parse CSV into JSON objects", () => {
    const json = parseCsvToJson(csvSample);
    expect(json.length).toBe(2);
    expect(json[0].name).toBe("Alice");
    expect(json[0].city).toBe("Jakarta");
  });

  it("should convert JSON objects to CSV string", () => {
    const json = [{ id: 1, item: "Keyboard" }, { id: 2, item: "Mouse" }];
    const csv = convertJsonToCsv(json);
    expect(csv).toContain('"id","item"');
    expect(csv).toContain('"1","Keyboard"');
    expect(csv).toContain('"2","Mouse"');
  });

  it("should convert CSV to Markdown table", () => {
    const md = convertCsvToMarkdownTable(csvSample);
    expect(md).toContain("| name | age | city |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| Alice | 30 | Jakarta |");
  });

  it("should convert CSV to HTML table", () => {
    const html = convertCsvToHtmlTable(csvSample, "User Table");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>name</th>");
    expect(html).toContain("<td>Alice</td>");
  });
});

describe("Convert Document · Cross-Conversion Matrix (All Formats Tested)", () => {
  it("should test all cross-conversion pathways across document, data, and image formats", async () => {
    const dummyFiles = await createDummyFiles();

    const pathways: Array<{ from: SupportedFormat; to: SupportedFormat }> = [
      // From DOCX
      { from: "docx", to: "pdf" },
      { from: "docx", to: "txt" },
      { from: "docx", to: "md" },
      { from: "docx", to: "html" },
      { from: "docx", to: "rtf" },
      { from: "docx", to: "epub" },

      // From TXT
      { from: "txt", to: "pdf" },
      { from: "txt", to: "docx" },
      { from: "txt", to: "md" },
      { from: "txt", to: "html" },
      { from: "txt", to: "rtf" },
      { from: "txt", to: "epub" },

      // From Markdown
      { from: "md", to: "pdf" },
      { from: "md", to: "docx" },
      { from: "md", to: "html" },
      { from: "md", to: "txt" },
      { from: "md", to: "rtf" },
      { from: "md", to: "epub" },

      // From HTML
      { from: "html", to: "pdf" },
      { from: "html", to: "docx" },
      { from: "html", to: "md" },
      { from: "html", to: "txt" },
      { from: "html", to: "rtf" },
      { from: "html", to: "epub" },

      // From RTF
      { from: "rtf", to: "pdf" },
      { from: "rtf", to: "docx" },
      { from: "rtf", to: "txt" },
      { from: "rtf", to: "md" },
      { from: "rtf", to: "html" },
      { from: "rtf", to: "epub" },

      // From EPUB
      { from: "epub", to: "pdf" },
      { from: "epub", to: "docx" },
      { from: "epub", to: "txt" },
      { from: "epub", to: "md" },
      { from: "epub", to: "html" },

      // From CSV
      { from: "csv", to: "json" },
      { from: "csv", to: "yaml" },
      { from: "csv", to: "xml" },
      { from: "csv", to: "md" },
      { from: "csv", to: "html" },
      { from: "csv", to: "pdf" },

      // From JSON
      { from: "json", to: "csv" },
      { from: "json", to: "yaml" },
      { from: "json", to: "xml" },
      { from: "json", to: "pdf" },

      // From YAML
      { from: "yaml", to: "json" },
      { from: "yaml", to: "csv" },
      { from: "yaml", to: "xml" },
      { from: "yaml", to: "pdf" },

      // From XML
      { from: "xml", to: "json" },
      { from: "xml", to: "yaml" },
      { from: "xml", to: "html" },
      { from: "xml", to: "txt" },
      { from: "xml", to: "pdf" },

      // From Images to PDF
      { from: "png", to: "pdf" },
      { from: "jpg", to: "pdf" }
    ];

    for (const { from, to } of pathways) {
      const inputBytes = dummyFiles[from];
      expect(inputBytes).toBeDefined();

      const result = await convertDocument(inputBytes, from, to, { fileName: `sample.${from}` });
      expect(result).toBeDefined();
      expect(result.blob).toBeDefined();
      expect(result.blob.size).toBeGreaterThan(0);
      expect(result.name).toBe(`sample.${to}`);
    }
  });

  it("should extract text from general documents via extractDocumentText", async () => {
    const dummyFiles = await createDummyFiles();
    const docxText = await extractDocumentText(dummyFiles.docx, "docx");
    expect(docxText).toContain("UtiliBox");

    const rtfText = await extractDocumentText(dummyFiles.rtf, "rtf");
    expect(rtfText).toContain("UtiliBox");

    const epubText = await extractDocumentText(dummyFiles.epub, "epub");
    expect(epubText).toContain("UtiliBox");

    const mdText = await extractDocumentText(dummyFiles.md, "md");
    expect(mdText).toContain("UtiliBox");
  });
});
