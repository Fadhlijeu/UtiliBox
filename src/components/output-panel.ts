import { el } from "../lib/dom";
import { downloadBlob, formatBytes } from "../lib/files";

export interface OutputFile {
  name: string;
  blob: Blob;
  mime: string;
}

/**
 * Output panel — shows every produced file with size + Preview toggle +
 * Download, so the user inspects BEFORE saving anywhere.
 */
export const outputPanel = (): {
  node: HTMLElement;
  show: (files: OutputFile[]) => void;
  clear: () => void;
} => {
  const list = el("div", { class: "output-panel__list" });
  let urls: string[] = [];

  const clearOld = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };

  const previewHost = el("div", { class: "output-panel__preview" });

  const showPreview = (file: OutputFile, url: string) => {
    previewHost.replaceChildren();
    if (file.mime === "application/pdf") {
      const frame = el("iframe", { class: "preview-frame", title: "PDF preview" }) as HTMLIFrameElement;
      frame.src = url;
      previewHost.appendChild(frame);
    } else if (file.mime.startsWith("image/")) {
      const img = el("img", { class: "preview-image", alt: file.name }) as HTMLImageElement;
      img.src = url;
      previewHost.appendChild(img);
    } else if (file.mime.startsWith("video/")) {
      const v = el("video", { class: "preview-video", controls: "controls", src: url }) as HTMLVideoElement;
      previewHost.appendChild(v);
    } else if (file.mime.startsWith("audio/")) {
      const a = el("audio", { class: "preview-audio", controls: "controls", src: url }) as HTMLAudioElement;
      previewHost.appendChild(a);
    } else if (file.mime.startsWith("text/") || file.mime.includes("json")) {
      const pre = el("pre", { class: "preview-text mono" });
      void fetch(url).then((r) => r.text()).then((t) => (pre.textContent = t.slice(0, 50_000)));
      previewHost.appendChild(pre);
    }
    previewHost.hidden = false;
  };

  const render = (files: OutputFile[]) => {
    clearOld();
    previewHost.replaceChildren();
    previewHost.hidden = true;
    list.replaceChildren(
      ...files.map((f) => {
        const url = URL.createObjectURL(f.blob);
        urls.push(url);
        const previewBtn = el("button", { class: "btn btn--sm", type: "button" }, ["Preview"]);
        const dlBtn = el("button", { class: "btn btn--sm", type: "button" }, ["Download"]);
        previewBtn.addEventListener("click", () => showPreview(f, url));
        dlBtn.addEventListener("click", () => {
          downloadBlob(f.blob, f.name);
        });
        return el("div", { class: "output-file" }, [
          el("span", { class: "output-file__name" }, [f.name]),
          el("span", { class: "muted" }, [formatBytes(f.blob.size)]),
          previewBtn,
          dlBtn
        ]);
      })
    );
  };

  return {
    node: el("section", { class: "output-panel", "aria-label": "Result files" }, [
      el("h3", { class: "output-panel__title" }, ["Output — preview before you download"]),
      list,
      previewHost
    ]),
    show: render,
    clear: () => {
      clearOld();
      list.replaceChildren();
      previewHost.replaceChildren();
      previewHost.hidden = true;
    }
  };
};