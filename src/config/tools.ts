// UtiliBox · Tool registry
// Single source of truth for every tool (id, title, category, icon, route).

export type ToolCategory =
  | "documents"
  | "media"
  | "developer"
  | "security"
  | "ai";

export interface ToolMeta {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  /** Material Symbols Outlined name */
  icon: string;
  /** P0/P1/P2 roadmap tier */
  tier: "P0" | "P1" | "P2";
  /** true when tool is implemented (import path exists) */
  implemented?: boolean;
}

export const CATEGORIES: { id: ToolCategory; label: string; icon: string }[] = [
  { id: "documents", label: "Documents & Files", icon: "folder_open" },
  { id: "media", label: "Images & Media", icon: "image" },
  { id: "developer", label: "Developer & Data", icon: "code" },
  { id: "security", label: "Security & Utility", icon: "lock" },
  { id: "ai", label: "AI Extras", icon: "auto_awesome" }
];

export const TOOLS: ToolMeta[] = [
  // ── Documents & Files ────────────────────────────────
  { id: "pdf-convert", title: "Convert Document", description: "Convert documents between formats", category: "documents", icon: "swap_horiz", tier: "P0" },
  { id: "compress", title: "Compress", description: "Reduce file size for documents & images", category: "documents", icon: "compress", tier: "P0" },
  { id: "pdf-organizer", title: "Merge & Split", description: "Merge, split, reorder & delete pages", category: "documents", icon: "auto_stories", tier: "P0" },
  { id: "ocr", title: "OCR", description: "Extract text from images & PDFs", category: "documents", icon: "text_snippet", tier: "P0" },
  { id: "encrypt", title: "Encryption", description: "Encrypt & decrypt files", category: "documents", icon: "enhanced_encryption", tier: "P1" },
  { id: "metadata", title: "Metadata", description: "View & strip photo metadata", category: "documents", icon: "info", tier: "P0" },
  { id: "diff", title: "Diff Checker", description: "Compare two texts or files", category: "documents", icon: "difference", tier: "P1" },

  // ── Images & Media ────────────────────────────────────
  { id: "remove-bg", title: "Remove Background", description: "AI background removal", category: "media", icon: "cut", tier: "P0" },
  { id: "image-convert", title: "Image Converter", description: "Convert between image formats", category: "media", icon: "image_search", tier: "P0" },
  { id: "image-resize", title: "Resize & Crop", description: "Resize, crop & aspect presets", category: "media", icon: "crop", tier: "P0" },
  { id: "video-gif", title: "Video ↔ GIF", description: "Convert video to GIF and back", category: "media", icon: "gif_box", tier: "P1" },
  { id: "audio-convert", title: "Audio Converter", description: "Convert between audio formats", category: "media", icon: "graphic_eq", tier: "P1" },
  { id: "media-downloader", title: "Media Downloader", description: "Download HD media from popular platforms", category: "media", icon: "download", tier: "P0" },

  // ── Developer & Data ──────────────────────────────────
  { id: "json", title: "JSON / YAML / XML", description: "Format, validate & convert data", category: "developer", icon: "data_object", tier: "P0" },
  { id: "base64", title: "Base64", description: "Encode & decode text, files, images", category: "developer", icon: "tag", tier: "P0" },
  { id: "markdown", title: "Markdown ↔ HTML", description: "Live preview & conversion", category: "developer", icon: "note_alt", tier: "P0" },
  { id: "api-tester", title: "API Tester", description: "REST, WebSocket & SSE client", category: "developer", icon: "api", tier: "P0" },
  { id: "code-runner", title: "Code Runner", description: "Run code in popular languages", category: "developer", icon: "terminal", tier: "P0" },
  { id: "speedtest", title: "Speed Test", description: "Measure connection speed", category: "developer", icon: "speed", tier: "P2" },

  // ── Security & Utility ────────────────────────────────
  { id: "qr", title: "QR Code", description: "Generator & scanner", category: "security", icon: "qr_code_2", tier: "P0" },
  { id: "password", title: "Password", description: "Generator & strength checker", category: "security", icon: "password", tier: "P0" },
  { id: "hash", title: "Hash Generator", description: "Generate hashes & HMAC", category: "security", icon: "fingerprint", tier: "P0" },
  { id: "jwt", title: "JWT Decoder", description: "Decode & verify tokens", category: "security", icon: "token", tier: "P0" },

  // ── AI Extras ─────────────────────────────────────────
  { id: "summarizer", title: "Summarizer", description: "Long text → short summary", category: "ai", icon: "compress", tier: "P0" },
  { id: "paraphraser", title: "Paraphraser", description: "Rewrite with 9 modes", category: "ai", icon: "edit_note", tier: "P0" },
  { id: "humanizer", title: "Humanizer", description: "Make AI text natural", category: "ai", icon: "person_pin", tier: "P1" },
  { id: "caption", title: "Image Caption", description: "Describe images in browser", category: "ai", icon: "image_search", tier: "P1" },
  { id: "sketch", title: "Sketch Enhancer", description: "Clean & classify sketches", category: "ai", icon: "brush", tier: "P2" },
  { id: "chatbot", title: "FAQ Chatbot", description: "Semantic FAQ assistant", category: "ai", icon: "forum", tier: "P1" },
  { id: "code-assist", title: "AI Code Assistant", description: "Explain, fix, lint code", category: "ai", icon: "code_blocks", tier: "P1" },
  { id: "prompt", title: "Prompt Beautifier", description: "Short idea → mega prompt", category: "ai", icon: "lightbulb", tier: "P1" }
];

export const toolById = (id: string): ToolMeta | undefined =>
  TOOLS.find((t) => t.id === id || (id === "pdf-compress" && t.id === "compress"));

export const toolsByCategory = (category: ToolCategory): ToolMeta[] =>
  TOOLS.filter((t) => t.category === category);

/** Lazy-load a tool's mount module. Throws if not implemented yet. */
export const loadToolModule = async (
  id: string
): Promise<{ mount: (root: HTMLElement) => void }> => {
  switch (id) {
    case "json":
      return import("../tools/json/index");
    case "base64":
      return import("../tools/base64/index");
    case "pdf-organizer":
      return import("../tools/pdf-organizer/index");
    case "compress":
    case "pdf-compress":
      return import("../tools/compress/index");
    default:
      throw new Error("not-implemented: " + id);
  }
};