import { clear, el } from "../../lib/dom";
import { copyText } from "../../lib/files";
import { toast } from "../../components/toast";

export const mount = (root: HTMLElement): void => {
  clear(root);

  const input = el("textarea", {
    class: "codearea mono",
    rows: "12",
    placeholder: '{"hello": "world"}',
    spellcheck: "false"
  });
  const output = el("pre", { class: "codearea codearea--output mono" });
  const status = el("span", { class: "muted" });

  const format = () => {
    const text = input.value.trim();
    if (!text) {
      output.textContent = "—";
      status.textContent = "";
      return;
    }
    try {
      output.textContent = JSON.stringify(JSON.parse(text), null, 2);
      status.textContent = "Valid JSON";
    } catch {
      output.textContent = "";
      status.textContent = "Invalid JSON";
    }
  };

  root.append(
    el("h2", { class: "tool-title" }, ["JSON Formatter & Validator"]),
    el("p", { class: "tool-desc" }, [
      "Validate, format and minify JSON. Nothing leaves your browser."
    ]),
    el("label", { class: "field-label" }, ["Input"]),
    input,
    el("div", { class: "row gap" }, [
      el("button", { class: "btn btn--primary" }, ["Format & validate"]),
      el("button", { class: "btn", id: "minify-btn" }, ["Minify"]),
      el("button", { class: "btn btn--ghost", id: "copy-btn" }, ["Copy result"])
    ]),
    output,
    status
  );

  const fmtBtn = root.querySelector<HTMLButtonElement>(".btn--primary")!;
  const minBtn = root.querySelector<HTMLButtonElement>("#minify-btn")!;
  const copyBtn = root.querySelector<HTMLButtonElement>("#copy-btn")!;

  fmtBtn.addEventListener("click", () => format());
  minBtn.addEventListener("click", () => {
    try {
      output.textContent = JSON.stringify(JSON.parse(input.value.trim()));
      status.textContent = "Minified";
    } catch {
      status.textContent = "Invalid JSON";
    }
  });
  copyBtn.addEventListener("click", async () => {
    if (!output.textContent || output.textContent === "—") return;
    toast((await copyText(output.textContent)) ? "Copied" : "Copy failed", "success");
  });
};