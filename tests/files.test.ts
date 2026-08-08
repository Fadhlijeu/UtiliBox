import { describe, it, expect } from "vitest";
import { formatBytes } from "../src/lib/files";

describe("formatBytes", () => {
  it("shows B under 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("shows KB/MB/GB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});