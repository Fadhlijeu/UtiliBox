import { el } from "../lib/dom";
import { downloadBlob, formatBytes } from "../lib/files";
import { fileThumb, genericThumb, pdfPageThumbs } from "../lib/thumb";
import { zipBlobs } from "../lib/zip";
import { toast } from "./toast";
import { timelineStore } from "../lib/timeline-store";
import { createSendToMenu } from "./send-to-menu";

export interface OutputFile {
  name: string;
  blob: Blob;
  mime: string;
  sourceFeatureId?: string;
  sourceLabel?: string;
}

const currentToolId = (): string | undefined =>
  location.hash.match(/^#\/tool\/([a-z0-9-]+)/)?.[1];

/** Handoff to a feature of the same tool → notify shell via custom event. */
const SAME_TOOL_EVENT = "utilibox:feature-handoff";
const CLOSE_RESULT_EVENT = "utilibox:close-result";
const RESTORE_SNAPSHOT_EVENT = "utilibox:restore-snapshot";

/**
 * Output panel — appears only when there IS output (never idle chrome).
 * Each file: thumbnail, name, size, Pages (PDF per-page strip), Preview
 * (modal), Download, Send-to…
 */
export const OutputPanel = () => {
  const list = el("div", { class: "output-grid" });
  const head = el("div", { class: "output-panel__head" }, [
    el("h3", { class: "output-panel__title" }, ["Output — preview first, then download or send"])
  ]);
  const panel = el("section", { class: "output-panel", hidden: "hidden" }, [head, list]);
  let urls: string[] = [];

  const clearOld = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };

  const show = (
    files: OutputFile[],
    sourceFeatureId?: string,
    sourceLabel?: string,
    inputFiles?: File[],
    skipTimelineLog?: boolean
  ) => {
    clearOld();
    const cur = currentToolId();
    const headNodes: Node[] = [
      el("h3", { class: "output-panel__title" }, ["Output — preview first, then download or send"])
    ];
    if (files.length > 1) {
      const zipBtn = el("button", { class: "btn btn--sm", type: "button" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["folder_zip"]),
        `Download all (${files.length} · ZIP)`
      ]);
      zipBtn.addEventListener("click", async () => {
        zipBtn.disabled = true;
        try {
          const zip = await zipBlobs(files.map((f) => ({ name: f.name, blob: f.blob })));
          downloadBlob(zip, "utilibox-output.zip");
          toast("ZIP ready — downloading", "success");
        } catch (e) {
          toast(`ZIP failed: ${e instanceof Error ? e.message : e}`, "error");
        } finally {
          zipBtn.disabled = false;
        }
      });
      headNodes.push(zipBtn);
    }
    head.replaceChildren(...headNodes);
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

        const downloadBtn = el("button", { class: "btn btn--sm btn--ghost", type: "button" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
          "Download"
        ]);
        downloadBtn.addEventListener("click", () => {
          downloadBlob(f.blob, f.name);
          toast("Download started", "success");
        });

        const row = el("div", { class: "output-item" }, [
          el("div", { class: "output-file" }, [
            thumbSlot,
            el("span", { class: "output-file__name" }, [f.name]),
            el("span", { class: "muted" }, [formatBytes(f.blob.size)]),
            previewBtn,
            downloadBtn
          ])
        ]);
        const fileRow = row.firstElementChild as HTMLElement;

        void fileThumb(new File([f.blob], f.name, { type: f.mime }))
          .then((t) => {
            if (t?.node) thumbSlot.replaceChildren(t.node);
            else thumbSlot.replaceChildren(genericThumb("description").node);
          })
          .catch(() => {
            thumbSlot.replaceChildren(genericThumb("description").node);
          });

        if (!skipTimelineLog) {
          // Record output file into timeline store with input and output files
          timelineStore.addEntry({
            toolId: cur ?? "output",
            featureId: sourceFeatureId ?? f.sourceFeatureId ?? "output",
            sourceLabel: sourceLabel ?? f.sourceLabel,
            fileName: f.name,
            blob: f.blob,
            mime: f.mime,
            size: f.blob.size,
            lineage: "main",
            inputFiles,
            outputFiles: files
          });
        }

        // per-page preview strip for PDF outputs (verify before download)
        if (f.mime === "application/pdf") {
          const pagesBtn = el("button", { class: "btn btn--sm btn--ghost output-pages-toggle", type: "button" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["grid_view"]),
            "Pages"
          ]);
          const strip = el("div", { class: "output-pdf-pages", hidden: "hidden" });
          pagesBtn.addEventListener("click", async () => {
            strip.hidden = !strip.hidden;
            if (strip.hidden) return;
            if (!strip.childElementCount) {
              try {
                const bytes = new Uint8Array(await f.blob.arrayBuffer());
                await pdfPageThumbs(bytes, (canvas, i) => {
                  strip.appendChild(
                    el("div", { class: "output-page" }, [canvas, el("span", { class: "output-page__no" }, [String(i)])])
                  );
                });
              } catch {
                strip.appendChild(el("p", { class: "muted" }, ["Could not render page previews."]));
              }
            }
          });
          fileRow.appendChild(pagesBtn);
          row.appendChild(strip);
          // auto-show the strip so pages are visible right away
          pagesBtn.click();
        }

        // multi-level send-to menu (oper file): filtered by mime, no self-loop
        const sendToMenu = createSendToMenu(f, cur, sourceFeatureId);
        fileRow.appendChild(sendToMenu);

        return row;
      })
    );
    panel.hidden = false;
  };

const openPreview = (f: OutputFile, url: string) => {
    // modal preview — acts like a page: browser Back also closes it.
    const overlay = el("div", { class: "preview-overlay", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "preview-card" }, [
        el("div", { class: "preview-card__head" }, [
          el("span", { class: "preview-card__name", title: f.name }, [f.name]),
          el("div", { class: "row" }, [
            el("button", { class: "btn btn--sm", type: "button", "data-close": "" }, [
              el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["arrow_back"]),
              "Back"
            ]),
            el("button", { class: "btn btn--sm btn--ghost", type: "button", "data-download": "" }, [
              el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
              "Download"
            ])
          ])
        ]),
        el("div", { class: "preview-card__body" }, [previewBody(f, url)])
      ])
    ]);
    history.pushState({ utiliboxPreview: true }, "");
    const onPop = () => {
      if (!overlay.isConnected) return;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
    window.addEventListener("popstate", onPop);
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      if (history.state?.utiliboxPreview) history.back();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    overlay.querySelector("[data-close]")!.addEventListener("click", close);
    overlay.querySelector("[data-download]")!.addEventListener("click", () => {
      downloadBlob(f.blob, f.name);
      toast("Download started", "success");
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  };

  const previewBody = (f: OutputFile, url: string): HTMLElement => {
    if (f.mime === "application/pdf") {
      const frame = el("iframe", { class: "preview-frame", title: "PDF preview" }) as HTMLIFrameElement;
      frame.src = url;
      return frame;
    }
    if (f.mime.startsWith("image/")) {
      const img = el("img", { class: "preview-image", alt: f.name }) as HTMLImageElement;
      img.src = url;
      return img;
    }
    if (f.mime.startsWith("video/")) {
      const v = el("video", { class: "preview-video", controls: "controls", autoplay: "" }) as HTMLVideoElement;
      v.src = url;
      return v;
    }
    if (f.mime.startsWith("audio/")) {
      const a = el("audio", { class: "preview-audio", controls: "controls", autoplay: "" }) as HTMLAudioElement;
      a.src = url;
      return a;
    }
    if (f.mime.startsWith("text/") || f.mime.includes("json")) {
      const pre = el("pre", { class: "preview-text mono" });
      void fetch(url).then((r) => r.text()).then((t) => (pre.textContent = t.slice(0, 50_000)));
      return pre;
    }
    return el("p", { class: "muted" }, ["No inline preview for this type — use Download."]);
  };

  const clear = () => {
    clearOld();
    list.replaceChildren();
    panel.hidden = true;
  };

  return { node: panel, show, clear, SAME_TOOL_EVENT };
};

// shared event name export for tools
export { SAME_TOOL_EVENT, CLOSE_RESULT_EVENT, RESTORE_SNAPSHOT_EVENT };