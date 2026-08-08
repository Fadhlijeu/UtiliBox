import { el } from "../lib/dom";
import { downloadText, copyText } from "../lib/files";
import { toast } from "./toast";

/** Copy button with idle / done feedback. */
export const copyButton = (getText: () => string, opts: { label?: string } = {}): HTMLElement => {
  const btn = el("button", { class: "btn btn--ghost", type: "button", "data-copy": "" }, [
    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_copy"]),
    el("span", {}, [opts.label ?? "Copy"])
  ]);
  btn.addEventListener("click", async () => {
    const ok = await copyText(getText());
    toast(ok ? "Copied to clipboard" : "Copy failed", ok ? "success" : "error");
  });
  return btn;
};

/** Download button for text content. */
export const downloadButton = (
  getFilename: () => string,
  getText: () => string,
  opts: { mime?: string; label?: string } = {}
): HTMLElement => {
  const btn = el("button", { class: "btn btn--ghost", type: "button" }, [
    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
    el("span", {}, [opts.label ?? "Download"])
  ]);
  btn.addEventListener("click", () => {
    downloadText(getText(), getFilename(), opts.mime);
    toast("Download started", "success");
  });
  return btn;
};