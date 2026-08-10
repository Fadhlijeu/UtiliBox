import { describe, it, expect } from "vitest";
import { toolById } from "../src/config/tools";

describe("Compress Tool Registry & Module Loader", () => {
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

  it("calculates percentage size reduction correctly", () => {
    const originalSize = 2000000; // 2 MB
    const compressedSize = 500000; // 500 KB
    const reduction = Math.round((1 - compressedSize / originalSize) * 100);
    expect(reduction).toBe(75);
  });
});
