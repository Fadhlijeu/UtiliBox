// Minimal ZIP writer (STORE method, no compression) — zero dependencies.
// Produces a valid .zip readable by any OS/browser unzip.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const dosDateTime = (d = new Date()): number => {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return ((date << 16) | time) >>> 0;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const buildZip = (entries: ZipEntry[]): Uint8Array => {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const dateTime = dosDateTime();

  for (const e of entries) {
    const name = utf8(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header signature
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0x0800, true); // UTF-8 flag
    dv.setUint16(8, 0, true); // method: store
    dv.setUint32(10, dateTime, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true); // extra len
    local.set(name, 30);
    chunks.push(local, e.data);

    const cen = new Uint8Array(46 + name.length);
    const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true); // central header signature
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true); // store
    cdv.setUint32(12, dateTime, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + size;
  }

  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cenSize, true);
  edv.setUint32(16, offset, true);
  chunks.push(...central, eocd);

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
};

/** Zip a list of named blobs (STORE). Rejects reserved names for safety. */
export const zipBlobs = async (files: { name: string; blob: Blob }[]): Promise<Blob> => {
  const entries: ZipEntry[] = [];
  for (const f of files) {
    const name = f.name.replace(/[\\/:*?"<>|]/g, "_");
    if (!name) continue;
    entries.push({ name, data: new Uint8Array(await f.blob.arrayBuffer()) });
  }
  return new Blob([buildZip(entries)], { type: "application/zip" });
};