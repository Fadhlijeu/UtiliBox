import { el } from "../lib/dom";
import { downloadBlob, formatBytes } from "../lib/files";
import { fileThumb } from "../lib/thumb";
import { handoffTargetsFor, stageHandoff } from "../lib/handoff";
import { toast } from "./toast";

export interface OutputFile {
  name: string;
  blob: Blob;
  mime: string;
}

const currentToolId = (): string | undefined =>
  location.hash.match(/^#\/tool\/([a-z0-9-]+)/)?.[1];

/** Handoff to a feature of the same tool → notify shell via custom event. */
const SAME_TOOL_EVENT = "utilibox:feature-handoff";

/**
 * Output panel — appears only when there IS output (never idle chrome).
 * Each file row: thumbnail, name, size, Download, Preview, Send-to…
 */
export const OutputPanel = () => {
  const list = el("div", { class: "output-grid" });
  const panel = el("section", { class: "output-panel", hidden: "hidden" }, [
    el("h3", { class: "output-panel__title" }, ["Output · preview first, then download or send"]),
    list
  ]);
  let urls: string[] = [];

  const clearOld = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };

  const show = (files: OutputFile[]) => {
    clearOld();
    const cur = currentToolId();
    list.replaceChildren(
      ...files.map((f) => {
        const url = URL.createObjectURL(f.blob);
        urls.push(url);
        const thumbSlot = el("span", { class: "out-thumb" }, ["…"]);
        const previewBtn = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["visibility"]),
          "Preview"
        ]);
        previewBtn.addEventListener("click", () => openPreview(f, url));

        const row = el("div", { class: "output-file" }, [
          thumbSlot,
          el("span", { class: "output-file__name" }, [f.name]),
          el("span", { class: "muted" }, [formatBytes(f.blob.size)]),
          previewBtn,
          el("button", { class: "btn btn--sm btn--ghost", type: "button" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
            "Download"
          ])
        ]);
        row.querySelectorAll(".btn")[1].addEventListener("click", () => {
          downloadBlob(f.blob, f.name);
          toast("Download started", "success");
        });

        void fileThumb(new File([f.blob], f.name, { type: f.mime })).then((t) => {
          thumbSlot.replaceChildren(t.node);
        });

        // send-to (oper file): filtered by mime, no self-loop
        const targets = handoffTargetsFor(f.mime, cur, "");
        if (targets.length) {
          const select = el("select", { class: "input input--sm sendto", "aria-label": "Send to feature" });
          select.appendChild(el("option", { value: "" }, ["Send to…"]));
          for (const t of targets) {
            select.appendChild(el("option", { value: `${t.toolId}|${t.featureId}` }, [t.label]));
          }
          select.addEventListener("change", () => {
            const [toolId, featureId] = (select.value || "").split("|");
            if (!toolId) {
              select.value = "";
              return;
            }
            stageHandoff(toolId, [new File([f.blob], f.name, { type: f.mime })]);
            toast("File handed off", "success");
            if (toolId === cur) {
              window.dispatchEvent(new CustomEvent(SAME_TOOL_EVENT, { detail: { featureId } }));
            } else {
              location.hash = `#/tool/${toolId}`;
            }
            select.value = "";
          });
          row.appendChild(select);
        }
        return row;
      })
    );
    panel.hidden = false;
  };

  const openPreview = (f: OutputFile, url: string) => {
    // separate preview view: small embedded render, not full page
    const overlay = el("div", { class: "preview-overlay", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "preview-card" }, [
        el("div", { class: "preview-card__head" }, [
          el("span", { class: "output-file__name" }, [f.name]),
          el("button", { class: "btn btn--sm btn--ghost", type: "button", "data-close": "" }, ["✕"])
        ]),
        previewBody(f, url)
      ])
    ]);
    overlay.querySelector("[data-close]")!.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  };

  const previewBody = (f: OutputFile, url: string): HTMLElement => {
    if (f.mime === "application/pdf") {
      const frame = el("iframe", { class: "preview-frame", title: "PDF preview" }) as HTMLIFrameElement;
      frame.src = url;
      return el("div", { class: "preview-scroll" }, [frame]);
    }
    if (f.mime.startsWith("image/")) {
      const img = el("img", { class: "preview-image", alt: f.name }) as HTMLImageElement;
      img.src = url;
      return el("div", { class: "preview-scroll" }, [img]);
    }
    if (f.mime.startsWith("video/")) {
      const v = el("video", { class: "preview-video", controls: "controls", src: url }) as HTMLVideoElement;
      return el("div", { class: "preview-scroll" }, [v]);
    }
    if (f.mime.startsWith("audio/")) {
      const a = el("audio", { class: "preview-audio", controls: "controls", src: url }) as HTMLAudioElement;
      return el("div", { class: "preview-scroll" }, [a]);
    }
    if (f.mime.startsWith("text/") || f.mime.includes("json")) {
      const pre = el("pre", { class: "preview-text mono" });
      void fetch(url).then((r) => r.text()).then((t) => (pre.textContent = t.slice(0, 50_000)));
      return el("div", { class: "preview-scroll" }, [pre]);
    }
    return el("div", { class: "preview-scroll" }, [
      el("p", { class: "muted" }, ["No inline preview for this type — use Download."])
    ]);
  };

  const clear = () => {
    clearOld();
    list.replaceChildren();
    panel.hidden = true;
  };

  return { node: panel, show, clear, SAME_TOOL_EVENT };
};

// shared event name export for tools
export { SAME_TOOL_EVENT }; // re-export for convenience