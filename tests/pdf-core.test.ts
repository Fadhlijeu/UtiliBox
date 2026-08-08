// TDD targets for pdf-core — merge/split/extract/validate.

import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  parsePageRanges,
  pageIndicesForRanges,
  mergePdfs,
  splitPdfByRanges,
  extractPages,
  validatePdf,
  imageToPdf
} from "../src/lib/pdf-core";

const makePdf = async (pageCount: number, tag = "P"): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([200, 200]);
    page.drawText(`${tag}${i}`, { x: 50, y: 80, font, size: 18 });
  }
  return doc.save();
};

describe("parsePageRanges", () => {
  it("parses single ranges", () => {
    expect(parsePageRanges("1-3,5,8-9")).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 8, to: 9 }
    ]);
  });

  it("accepts single page and full range", () => {
    expect(parsePageRanges("2")).toEqual([{ from: 2, to: 2 }]);
    expect(parsePageRanges("1-100")).toEqual([{ from: 1, to: 100 }]);
  });

  it("throws on reversed, zero or junk input", () => {
    expect(() => parsePageRanges("5-2")).toThrow();
    expect(() => parsePageRanges("0-3")).toThrow();
    expect(() => parsePageRanges("abc")).toThrow();
    expect(() => parsePageRanges("1-3,4x")).toThrow();
    expect(() => parsePageRanges("")).toThrow();
  });

  it("throws when range exceeds document pages", () => {
    expect(() => pageIndicesForRanges("1-3,7", 6)).toThrow();
  });
});

describe("mergePdfs", () => {
  it("merges several docs preserving order", async () => {
    const a = await makePdf(3, "A");
    const b = await makePdf(2, "B");
    const c = await makePdf(2, "C");
    const out = await mergePdfs([a, b, c]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(7);
  });

  it("throws on invalid input buffer", async () => {
    await expect(mergePdfs([new Uint8Array([1, 2, 3])])).rejects.toThrow();
  });
});

describe("splitPdfByRanges / extractPages", () => {
  it("splits a doc by explicit ranges", async () => {
    const src = await makePdf(9, "S");
    const parts = await splitPdfByRanges(src, "1-2,4,6-8");
    expect(parts).toHaveLength(3);
    const counts = await Promise.all(
      parts.map(async (p) => {
        const d = await PDFDocument.load(p);
        return d.getPageCount();
      })
    );
    expect(counts).toEqual([2, 1, 3]);
  });

  it("extractPages keeps requested order incl. duplicates", async () => {
    const src = await makePdf(5, "E");
    const one = await extractPages(src, [4, 1, 1]);
    const doc = await PDFDocument.load(one);
    expect(doc.getPageCount()).toBe(3);
  });

  it("extractPages throws when an index is out of bounds", async () => {
    const src = await makePdf(3);
    await expect(extractPages(src, [9])).rejects.toThrow();
  });
});

describe("validatePdf", () => {
  it("accepts a valid pdf, rejects junk", async () => {
    const good = await makePdf(1);
    expect(await validatePdf(good)).toBe(true);
    expect(await validatePdf(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("imageToPdf", () => {
  const png1x1 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x83, 0x5f, 0x00,
    0x23, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82
  ]);

  it("converts a tiny png into a valid single-page pdf", async () => {
    const pdf = await imageToPdf(png1x1);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
  });

  it("rejects unsupported formats", async () => {
    await expect(imageToPdf(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).rejects.toThrow();
  });
});