// Minimal zip writer sanity tests — parse EOCD & central directory in node.

import { describe, it, expect } from "vitest";
import { zipBlobs } from "../src/lib/zip";

const readZip = async (blob: Blob): Promise<{ buffer: Uint8Array }> => ({
  buffer: new Uint8Array(await blob.arrayBuffer())
});

const eocdEntries = (buf: Uint8Array): { count: number; cenSize: number; cenOffset: number } => {
  // EOCD = last 22 bytes (no comment)
  const e = buf.length - 22;
  const dv = new DataView(buf.buffer, e, 22);
  if (dv.getUint32(0, true) !== 0x06054b50) throw new Error("no EOCD");
  return { count: dv.getUint16(10, true), cenSize: dv.getUint32(12, true), cenOffset: dv.getUint32(16, true) };
};

describe("zipBlobs", () => {
  it("produces a zip with the expected entry count", async () => {
    const zip = await zipBlobs([
      { name: "a.txt", blob: new Blob(["hello"]) },
      { name: "b.txt", blob: new Blob(["world"]) }
    ]);
    expect(zip.type).toBe("application/zip");
    const meta = eocdEntries(await (await readZip(zip)).buffer);
    expect(meta.count).toBe(2);
  });

  it("stores file bytes verbatim (STORE method)", async () => {
    const payload = "UtiliBox test payload 123";
    const zip = await zipBlobs([{ name: "x.txt", blob: new Blob([payload]) }]);
    const buf = new Uint8Array(await zip.arrayBuffer());
    // find the payload bytes inside the archive
    const needle = new TextEncoder().encode(payload);
    let found = false;
    for (let i = 0; i <= buf.length - needle.length; i++) {
      if (buf.slice(i, i + needle.length).every((b, j) => b === needle[j])) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("sanitizes unsafe file names", async () => {
    const zip = await zipBlobs([{ name: "a/b:c*.txt", blob: new Blob(["x"]) }]);
    const buf = new Uint8Array(await zip.arrayBuffer());
    const text = new TextDecoder().decode(buf);
    expect(text).not.toContain(":/");
    expect(text).toContain("a_b_c_.txt");
  });
});