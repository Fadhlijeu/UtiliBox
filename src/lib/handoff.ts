// Handoff — "oper file" between tools & features.
// A tool's output can be sent to another tool (or feature of the same tool)
// when the receiving side accepts that MIME type, e.g. Merge output (PDF) → Compress.

export interface HandoffTarget {
  toolId: string;
  featureId: string;
  label: string;
  accepts: (mime: string) => boolean;
}

/** Registry: every file-type tool/fitur that can receive incoming files. */
export const HANDOFF_TARGETS: HandoffTarget[] = [
  { toolId: "pdf-organizer", featureId: "merge", label: "Merge & Split → Merge", accepts: (m) => m === "application/pdf" || m === "image/png" || m === "image/jpeg" },
  { toolId: "pdf-organizer", featureId: "split", label: "Merge & Split → Split", accepts: (m) => m === "application/pdf" },
  { toolId: "pdf-organizer", featureId: "organize", label: "Merge & Split → Organize", accepts: (m) => m === "application/pdf" },
  { toolId: "pdf-compress", featureId: "core", label: "Compress", accepts: (m) => m === "application/pdf" },
  { toolId: "pdf-convert", featureId: "core", label: "Convert Document", accepts: (m) => m === "application/pdf" },
  { toolId: "ocr", featureId: "core", label: "OCR", accepts: (m) => m === "application/pdf" || m.startsWith("image/") },
  { toolId: "image-convert", featureId: "core", label: "Image Converter", accepts: (m) => m.startsWith("image/") },
  { toolId: "image-resize", featureId: "core", label: "Resize & Crop", accepts: (m) => m.startsWith("image/") },
  { toolId: "remove-bg", featureId: "core", label: "Remove Background", accepts: (m) => m.startsWith("image/") },
  { toolId: "audio-convert", featureId: "core", label: "Audio Converter", accepts: (m) => m.startsWith("audio/") },
  { toolId: "video-gif", featureId: "core", label: "Video ↔ GIF", accepts: (m) => m.startsWith("video/") },
  { toolId: "json", featureId: "core", label: "JSON / YAML / XML", accepts: (m) => m === "application/json" || m.includes("json") || m.includes("yaml") || m.includes("xml") },
  { toolId: "base64", featureId: "core", label: "Base64", accepts: (m) => m.startsWith("text/") || m === "application/json" },
  { toolId: "markdown", featureId: "core", label: "Markdown ↔ HTML", accepts: (m) => m.startsWith("text/") }
];

/** Targets that accept the given MIME, excluding a tool/feature to avoid loops. */
export const handoffTargetsFor = (
  mime: string,
  excludeToolId?: string,
  excludeFeatureId?: string
): HandoffTarget[] =>
  HANDOFF_TARGETS.filter(
    (t) =>
      t.accepts(mime) &&
      !(excludeToolId && t.toolId === excludeToolId && t.featureId === excludeFeatureId)
  );

// ── In-transit store: files ready to be picked up by a target tool ─────

const pending = new Map<string, File[]>();

export const stageHandoff = (toolId: string, files: File[]): void => {
  const existing = pending.get(toolId) ?? [];
  pending.set(toolId, [...existing, ...files]);
};

export const takeHandoff = (toolId: string): File[] => {
  const files = pending.get(toolId) ?? [];
  pending.delete(toolId);
  return files;
};

export const hasHandoff = (toolId: string): boolean => (pending.get(toolId)?.length ?? 0) > 0;