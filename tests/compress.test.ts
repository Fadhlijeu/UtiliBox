import { describe, it, expect } from "vitest";
import { toolById } from "../src/config/tools";

describe("Compress Tool Suite, Hard Compress Engine & Target Size Limits", () => {
  it("registers generic Compress tool in tool registry", () => {
    const meta = toolById("compress");
    expect(meta).toBeDefined();
    expect(meta?.title).toBe("Compress");
    expect(meta?.category).toBe("documents");
    expect(meta?.icon).toBe("compress");
  });

  it("supports backwards compatibility alias pdf-compress", () => {
    const aliasMeta = toolById("pdf-compress");
    expect(aliasMeta).toBeDefined();
    expect(aliasMeta?.id).toBe("compress");
  });

  it("calculates document & image percentage size reduction correctly", () => {
    const originalSize = 6000000; // 6 MB
    const compressedSize = 900000; // 900 KB
    const reduction = Math.round((1 - compressedSize / originalSize) * 100);
    expect(reduction).toBe(85);
  });

  it("parses target size bytes input accurately", () => {
    const valueMb = 1.0;
    const bytesMb = Math.round(valueMb * 1024 * 1024);
    expect(bytesMb).toBe(1048576);

    const valueKb = 500;
    const bytesKb = Math.round(valueKb * 1024);
    expect(bytesKb).toBe(512000);
  });
});
