import { clear, el } from "../../lib/dom";
import { encodeBase64, decodeBase64 } from "../../lib/base64";
import { copyText, downloadText } from "../../lib/files";
import { toast } from "../../components/toast";

export const mount = (root: HTMLElement): void => {
  clear(root);

  const input = el("textarea", {
    class: "codearea mono",
    rows: "8",
    placeholder: "Paste text or Base64 here…",
    spellcheck: "false"
  });
  const output = el("pre", { class: "codearea mono codearea--output", "aria-live": "polite" }, ["—"]);
  const status = el("span", { class: "muted" });

  const run = (mode: "encode" | "decode") => {
    const text = input.value;
    if (!text.trim()) {
      output.textContent = "—";
      status.textContent = "";
      return;
    }
    try {
      const res = mode === "encode" ? encodeBase64(text) : decodeBase64(text);
      output.textContent = res;
      status.textContent = `${mode === "encode" ? "Encoded" : "Decoded"} · ${res.length} chars`;
    } catch {
      output.textContent = "";
      status.textContent = "Invalid Base64 input";
    }
  };

  root.append(
    el("h2", { class: "tool-title" }, ["Base64"]),
    el("p", { class: "tool-desc" }, [
      "Encode or decode Base64. Text-UTF-8 safe; binary handled via files in a later milestone."
    ]),
    el("label", { class: "field-label" }, ["Input"]),
    input,
    el("div", { class: "row gap" }, [
      el("button", { class: "btn btn--primary" }, ["Encode → Base64"]),
      el("button", { class: "btn" }, ["Decode ←"]),
      el("button", { class: "btn btn--ghost", id: "copy-btn" }, ["Copy result"]),
      el("button", { class: "btn btn--ghost", id: "dl-btn" }, ["Download .txt"])
    ]),
    output,
    status
  );

  const [encBtn, decBtn] = root.querySelectorAll<HTMLButtonElement>("button:not(.btn--ghost)");
  const copyBtn = root.querySelector<HTMLButtonElement>("#copy-btn")!;
  const dlBtn = root.querySelector<HTMLButtonElement>("#dl-btn")!;

  encBtn.addEventListener("click", () => run("encode"));
  decBtn.addEventListener("click", () => run("decode"));
  copyBtn.addEventListener("click", async () => {
    if (!output.textContent || output.textContent === "—") return;
    toast((await copyText(output.textContent)) ? "Copied" : "Copy failed", "success");
  });
  dlBtn.addEventListener("click", () => {
    if (!output.textContent || output.textContent === "—") return;
    downloadText(output.textContent, "base64-result.txt");
    toast("Download started", "success");
  });
};