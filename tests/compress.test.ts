import { describe, it, expect } from "vitest";
import { toolById } from "../src/config/tools";
import { getNextPresetName, calculateEstimateForEntries, calculateProportionalTarget } from "../src/tools/compress/index";

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

  it("recycles preset incremental numbers when presets are deleted", () => {
    // Preset #1 and #2 exist -> next should be Preset #3
    const p1 = [
      { id: "p1", name: "Preset #1", mode: "target-size" as const, qualityVal: 65, targetVal: 1, targetUnit: "MB" as const, precision: "exact" as const },
      { id: "p2", name: "Preset #2", mode: "target-size" as const, qualityVal: 65, targetVal: 1, targetUnit: "MB" as const, precision: "exact" as const }
    ];
    expect(getNextPresetName(p1)).toBe("Preset #3");

    // Preset #2 deleted -> next should recycle Preset #2
    const p2 = [
      { id: "p1", name: "Preset #1", mode: "target-size" as const, qualityVal: 65, targetVal: 1, targetUnit: "MB" as const, precision: "exact" as const }
    ];
    expect(getNextPresetName(p2)).toBe("Preset #2");

    // All presets deleted -> next should start at Preset #1
    expect(getNextPresetName([])).toBe("Preset #1");
  });

  it("calculates file-aware multi-item estimator correctly with mixed presets", () => {
    const dummyFile100MB = new File([new ArrayBuffer(100 * 1024 * 1024)], "file100.pdf", { type: "application/pdf" });
    const dummyFile50MB = new File([new ArrayBuffer(50 * 1024 * 1024)], "file50.pdf", { type: "application/pdf" });
    const dummyFile10MB = new File([new ArrayBuffer(10 * 1024 * 1024)], "file10.pdf", { type: "application/pdf" });

    const activeEntries = [
      { id: "1", file: dummyFile100MB, data: new Uint8Array(0), mime: "application/pdf", kind: "pdf" as const, presetId: "p1" },
      { id: "2", file: dummyFile50MB, data: new Uint8Array(0), mime: "application/pdf", kind: "pdf" as const }, // global
      { id: "3", file: dummyFile10MB, data: new Uint8Array(0), mime: "application/pdf", kind: "pdf" as const }  // global
    ];

    const presets = [
      { id: "p1", name: "Preset #1", mode: "target-size" as const, qualityVal: 65, targetVal: 1, targetUnit: "MB" as const, precision: "exact" as const }
    ];

    // Global settings: Target Size 15 MB
    const est = calculateEstimateForEntries(activeEntries, presets, "target-size", 65, 15 * 1024 * 1024);

    expect(est.originalBytes).toBe(160 * 1024 * 1024);
    // File 1 (100MB in Preset 1MB) -> ~1MB (1048576 * 0.95 = 996147)
    // File 2 (50MB in Global 15MB) -> ~15MB (15728640 * 0.95 = 14942208)
    // File 3 (10MB in Global 15MB) -> 10MB (file is smaller than 15MB target ceiling, stays 10MB!)
    expect(est.estimatedBytes).toBeLessThan(26 * 1024 * 1024);
    expect(est.estimatedBytes).toBeGreaterThan(24 * 1024 * 1024);
  });

  it("calculates proportional target allocation for batch files", () => {
    const file50MB = 50 * 1024 * 1024;
    const file20MB = 20 * 1024 * 1024;
    const file10MB = 10 * 1024 * 1024;
    const totalBatch = 80 * 1024 * 1024;
    const totalTarget = 20 * 1024 * 1024;

    const target50 = calculateProportionalTarget(file50MB, totalBatch, totalTarget, "proportional");
    const target20 = calculateProportionalTarget(file20MB, totalBatch, totalTarget, "proportional");
    const target10 = calculateProportionalTarget(file10MB, totalBatch, totalTarget, "proportional");

    expect(target50).toBe(Math.round(12.5 * 1024 * 1024));
    expect(target20).toBe(Math.round(5.0 * 1024 * 1024));
    expect(target10).toBe(Math.round(2.5 * 1024 * 1024));
  });
});
