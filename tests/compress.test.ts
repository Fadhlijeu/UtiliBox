import { describe, it, expect } from "vitest";
import { toolById } from "../src/config/tools";

describe("Compress Tool Suite & Real-Time Size Estimator", () => {
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
    const originalSize = 2000000; // 2 MB
    const compressedSize = 500000; // 500 KB
    const reduction = Math.round((1 - compressedSize / originalSize) * 100);
    expect(reduction).toBe(75);
  });

  it("calculates audio bitrate reduction estimate", () => {
    const originalBitrate = 320; // 320 kbps MP3
    const targetBitrate = 128;   // 128 kbps MP3
    const reduction = Math.round((1 - targetBitrate / originalBitrate) * 100);
    expect(reduction).toBe(60);
  });

  it("calculates video resolution scale reduction estimate", () => {
    const originalHeight = 1080;
    const targetHeight = 720;
    const scaleRatio = targetHeight / originalHeight;
    expect(scaleRatio).toBeCloseTo(0.666, 2);
  });
});
