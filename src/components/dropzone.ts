import { el } from "../lib/dom";

export interface DropzoneOptions {
  label?: string;
  hint?: string;
  multiple?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
}

/**
 * A tappable/draggable file drop zone.
 * Axiom: one flat box, no flourish; open is one click.
 */
export const dropzone = (options: DropzoneOptions): HTMLElement => {
  const input = el("input", {
    type: "file",
    class: "visually-hidden",
    ...(options.multiple ? { multiple: "" } : {}),
    ...(options.accept ? { accept: options.accept } : {})
  });
  const zone = el(
    "button",
    {
      class: "dropzone",
      type: "button",
      "aria-label": options.label ?? "choose file"
    },
    [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["upload_file"]),
      el("span", { class: "dropzone__label" }, [options.label ?? "Drop files here"]),
      el("span", { class: "dropzone__hint" }, [
        options.hint ?? "or click to browse — processed 100% locally"
      ])
    ]
  );

  const trigger = () => input.click();
  zone.addEventListener("click", trigger);
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      trigger();
    }
  });
  input.addEventListener("change", () => {
    if (input.files?.length) options.onFiles([...input.files]);
    input.value = "";
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dropzone--drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dropzone--drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dropzone--drag");
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) options.onFiles(files);
  });

  return zone;
};