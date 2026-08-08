import { describe, it, expect } from "vitest";
import { handoffTargetsFor, stageHandoff, takeHandoff, hasHandoff } from "../src/lib/handoff";

describe("handoffTargetsFor", () => {
  it("returns PDF targets for application/pdf", () => {
    const t = handoffTargetsFor("application/pdf");
    expect(t.map((x) => x.toolId)).toContain("pdf-compress");
    expect(t.map((x) => x.toolId)).toContain("ocr");
  });

  it("returns image targets for image/png", () => {
    const t = handoffTargetsFor("image/png");
    expect(t.map((x) => x.toolId)).toEqual(expect.arrayContaining(["image-convert", "remove-bg", "image-resize", "ocr"]));
  });

  it("excludes same tool+feature (no self-loop)", () => {
    const t = handoffTargetsFor("application/pdf", "pdf-organizer", "merge");
    expect(t.some((x) => x.toolId === "pdf-organizer" && x.featureId === "merge")).toBe(false);
  });

  it("returns nothing for unknown mime", () => {
    expect(handoffTargetsFor("application/x-unknown")).toEqual([]);
  });
});

describe("handoff store", () => {
  it("stages and takes files per tool", () => {
    const f1 = new File(["a"], "a.pdf", { type: "application/pdf" });
    const f2 = new File(["b"], "b.pdf", { type: "application/pdf" });
    stageHandoff("pdf-compress", [f1]);
    stageHandoff("pdf-compress", [f2]);
    expect(hasHandoff("pdf-compress")).toBe(true);
    expect(takeHandoff("pdf-compress").length).toBe(2);
    expect(hasHandoff("pdf-compress")).toBe(false);
    expect(takeHandoff("pdf-compress")).toEqual([]);
  });
});