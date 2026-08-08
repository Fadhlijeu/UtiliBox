import { describe, it, expect } from "vitest";
import { encodeBase64, decodeBase64 } from "../src/lib/base64";

describe("base64 encode/decode", () => {
  it("roundtrips ASCII", () => {
    const s = "hello world";
    expect(decodeBase64(encodeBase64(s))).toBe(s);
  });

  it("roundtrips unicode (emoji + utf8)", () => {
    const s = "Héllo → 你好 🚀";
    expect(decodeBase64(encodeBase64(s))).toBe(s);
  });

  it("handles empty string", () => {
    expect(encodeBase64("")).toBe("");
    expect(decodeBase64("")).toBe("");
  });

  it("throws on invalid base64", () => {
    expect(() => decodeBase64("not-valid!")).toThrow();
  });

  it("known vector: 'hello' → aGVsbG8=", () => {
    expect(encodeBase64("hello")).toBe("aGVsbG8=");
    expect(decodeBase64("aGVsbG8=")).toBe("hello");
  });

  it("roundtrips long text (1MB)", () => {
    const s = "x".repeat(1_000_000);
    expect(encodeBase64(s).length).toBeGreaterThan(1_000_000);
    expect(decodeBase64(encodeBase64(s))).toBe(s);
  });
});