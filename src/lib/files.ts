// Binary file helpers without external deps.

export const downloadBlob = (
  blob: Blob,
  filename: string
): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const downloadText = (text: string, filename: string, mime = "text/plain"): void =>
  downloadBlob(new Blob([text], { type: mime }), filename);

/** Byte-accurate download; central place for the BlobPart cast. */
export const downloadBytes = (
  bytes: Uint8Array,
  filename: string,
  mime = "application/octet-stream"
): void => downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: mime }), filename);

export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // legacy fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      // fallback failed — report false
    }
    ta.remove();
    return ok;
  }
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[u]}`;
};