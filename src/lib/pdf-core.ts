// Pure PDF operations (pdf-lib) â€” merge, split by range, extract pages.
// No DOM access: unit-testable in node.

import { PDFDocument } from "pdf-lib";

/** pdf-lib wants a plain ArrayBuffer-backed Uint8Array; copy to guarantee. */
const toPdfBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

export interface PageRange {
  from: number;
  to: number;
}

/**
 * "1-3,5,8-9" â†’ [{from:1,to:3},{from:5,to:5},{from:8,to:9}]
 * Throws on malformed input (reversed, zero, non-numeric, empty).
 */
export const parsePageRanges = (input: string): PageRange[] => {
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("empty range");
  return parts.map((p) => {
    const m = p.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`invalid range: "${p}"`);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from) throw new Error(`invalid range: "${p}"`);
    return { from, to };
  });
};

/** Expand ranges into 0-based page indices, bounded by pageCount. */
export const pageIndicesForRanges = (input: string, pageCount: number): number[] => {
  const ranges = parsePageRanges(input);
  const indices: number[] = [];
  for (const r of ranges) {
    if (r.to > pageCount) throw new Error(`page ${r.to} out of range (${pageCount})`);
    for (let p = r.from; p <= r.to; p++) indices.push(p - 1);
  }
  return indices;
};

/** Validate a PDF buffer without heavy work. */
export const validatePdf = async (bytes: Uint8Array): Promise<boolean> => {
  try {
    await PDFDocument.load(toPdfBytes(bytes));
    return true;
  } catch {
    return false;
  }
};

/** Merge multiple PDFs, in order, into a single PDF document. */
export const mergePdfs = async (buffers: Uint8Array[]): Promise<Uint8Array> => {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(toPdfBytes(buf), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
};

/** Extract selected 0-based indices into a new PDF (order kept, dupes allowed). */
export const extractPages = async (
  source: Uint8Array,
  indices: number[]
): Promise<Uint8Array> => {
  const src = await PDFDocument.load(toPdfBytes(source), { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return out.save();
};

/** Split by user ranges; returns one buffer per range group. */
export const splitPdfByRanges = async (
  source: Uint8Array,
  rangesInput: string
): Promise<Uint8Array[]> => {
  const doc = await PDFDocument.load(toPdfBytes(source), { ignoreEncryption: true });
  const ranges = parsePageRanges(rangesInput);
  const out: Uint8Array[] = [];
  for (const r of ranges) {
    if (r.to > doc.getPageCount()) throw new Error(`page ${r.to} out of range (${doc.getPageCount()})`);
    const indices: number[] = [];
    for (let p = r.from; p <= r.to; p++) indices.push(p - 1);
    out.push(await extractPages(source, indices));
  }
  return out;
};
