import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { fileThumb, pdfPageThumbs } from "../../lib/thumb";
import { formatBytes, blobFromBytes } from "../../lib/files";
import { mergePdfs, splitPdfByRanges, extractPages, validatePdf, imageToPdf } from "../../lib/pdf-core";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";

type Kind = "pdf" | "image";

interface Entry {
  file: File;
  data: Uint8Array;
  pages: number; // current page count (mutated by organize)
  order: number[]; // 1-based page order (organize reorders this)
  kind: Kind;
}

const entries: Entry[] = [];
const listeners: Array<() => void> = [];
let notifyActivity: (() => void) | null = null;

const noopBusy = (): FeatureCtx["busy"] => ({
  node: el("div"),
  spin: () => void 0,
  progress: () => void 0,
  done: () => void 0
});

const isImage = (f: File): boolean => /\.(png|jpe?g)$/i.test(f.name);
const sniffKind = (f: File): Kind => (isImage(f) ? "image" : "pdf");
const pdflib = (): Promise<typeof import("pdf-lib")> => import("pdf-lib");

const emitChange = () => listeners.forEach((l) => l());
const onEntriesChange = (l: () => void): void => {
  listeners.push(l);
};

const addFiles = async (files: File[], ctx: Pick<FeatureCtx, "busy">): Promise<number> => {
  const b = ctx.busy;
  let added = 0;
  b.spin("Reading files…");
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      b.progress(i / files.length, `Reading ${i + 1}/${files.length}`);
      const kind = sniffKind(f);
      if (kind === "image") {
        entries.push({
          file: f,
          data: new Uint8Array(await readFileAsArrayBuffer(f)),
          pages: 1,
          order: [1],
          kind
        });
        added++;
        continue;
      }
      if (!/\.pdf$/i.test(f.name)) {
        toast(`Skipped (not PDF/image): ${f.name}`, "error");
        continue;
      }
      const data = new Uint8Array(await readFileAsArrayBuffer(f));
      if (!(await validatePdf(data))) {
        toast(`Invalid PDF: ${f.name}`, "error");
        continue;
      }
      const { PDFDocument } = await pdflib();
      const pages = (await PDFDocument.load(data)).getPageCount();
      entries.push({
        file: f,
        data,
        pages,
        order: Array.from({ length: pages }, (_, i) => i + 1),
        kind
      });
      added++;
    }
  } finally {
    b.done();
    if (added) notifyActivity?.();
    emitChange();
  }
  return added;
};

const removeEntry = (i: number): void => {
  entries.splice(i, 1);
  emitChange();
};

const pdfs = (): Entry[] => entries.filter((e) => e.kind === "pdf");
const totalSize = (): number => entries.reduce((s, e) => s + e.file.size, 0);

// ── compact file list (merge & split) ────────────────
const fileListEl = (): HTMLElement => {
  const list = el("ul", { class: "file-list" });
  const render = () => {
    list.replaceChildren(
      ...entries.map((e, i) => {
        const thumbSlot = el("span", { class: "file-row__thumb" });
        void fileThumb(e.file).then((t) => thumbSlot.replaceChildren(t.node));
        return el("li", { class: "file-row" }, [
          thumbSlot,
          el("span", { class: "file-row__name" }, [e.file.name]),
          el("span", { class: "muted file-row__meta" }, [
            `${e.kind === "image" ? "img → pdf" : `${e.pages} pg`} · ${formatBytes(e.file.size)}`
          ]),
          el("button", { class: "btn btn--ghost btn--sm", type: "button", "data-remove": String(i) }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete"])
          ])
        ]);
      })
    );
  };
  list.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (btn) removeEntry(Number(btn.dataset.remove));
  });
  onEntriesChange(render);
  render();
  return list;
};

const dropzoneEl = (ctx: FeatureCtx, hint: string): HTMLElement =>
  dropzone({
    label: "Add PDFs & images",
    hint,
    multiple: true,
    accept: ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg",
    onFiles: (fs) => void addFiles(fs, ctx)
  });

// ── Features ──────────────────────────────────────────

const mergeFeature: Feature = {
  id: "merge",
  label: "Merge",
  mount(host, ctx) {
    const status = el("span", { class: "muted" });
    const mergeBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["merge"]),
      "Merge into one PDF"
    ]);
    const sync = () => {
      const n = entries.length;
      status.textContent = n ? `${n} file(s) · ${formatBytes(totalSize())}` : "";
      mergeBtn.disabled = n < 2;
    };

    mergeBtn.addEventListener("click", async () => {
      if (entries.length < 2) return toast("Merge needs at least 2 files", "error");
      mergeBtn.disabled = true;
      ctx.busy.spin("Merging…");
      try {
        const parts: Uint8Array[] = [];
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          ctx.busy.progress(i / entries.length, `Preparing ${i + 1}/${entries.length}`);
          parts.push(e.kind === "pdf" ? e.data : await imageToPdf(e.data));
        }
        ctx.busy.progress(0.95, "Assembling PDF");
        const out = await mergePdfs(parts);
        ctx.showResult([
          {
            name: `merged-${entries.length}-files.pdf`,
            blob: blobFromBytes(out, "application/pdf"),
            mime: "application/pdf"
          }
        ]);
        toast("Merge ready — preview below", "success");
      } catch (e) {
        toast(`Merge failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        mergeBtn.disabled = entries.length < 2;
        ctx.busy.done();
      }
    });

    onEntriesChange(sync);
    sync();
    host.append(
      el("p", { class: "tool-desc" }, ["Combine several PDFs & images into a single PDF."]),
      dropzoneEl(ctx, "2+ files — PDF, PNG, JPG"),
      fileListEl(),
      el("div", { class: "row gap" }, [mergeBtn, status])
    );
  }
};

// Single-input feature: applies per file — one section per PDF ("File 1", "File 2", …).
const splitFeature: Feature = {
  id: "split",
  label: "Split",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });

    const renderSections = () => {
      sectionsHost.replaceChildren();
      const list = pdfs();
      if (!list.length) {
        sectionsHost.appendChild(
          el("div", { class: "file-empty" }, ["Add a PDF to split it by page ranges."])
        );
        return;
      }
      list.forEach((pdf, fileIdx) => {
        const rangeInput = el("input", {
          type: "text",
          class: "input",
          placeholder: "e.g. 1-3,5,8-9",
          value: `1-${pdf.pages}`
        });
        const splitBtn = el("button", { class: "btn", type: "button" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
          "Split"
        ]);
        splitBtn.addEventListener("click", async () => {
          if (!entries.includes(pdf)) return;
          splitBtn.disabled = true;
          ctx.busy.spin("Splitting…");
          try {
            const parts = await splitPdfByRanges(pdf.data, rangeInput.value);
            const base = pdf.file.name.replace(/\.pdf$/i, "");
            ctx.showResult(
              parts.map((p, i) => ({
                name: parts.length > 1 ? `${base}-part-${i + 1}.pdf` : `${base}.pdf`,
                blob: blobFromBytes(p, "application/pdf"),
                mime: "application/pdf"
              }))
            );
            toast(`File ${fileIdx + 1} — ${parts.length} part(s) ready`, "success");
          } catch (e) {
            toast(`Split failed: ${e instanceof Error ? e.message : e}`, "error");
          } finally {
            splitBtn.disabled = false;
            ctx.busy.done();
          }
        });
        sectionsHost.appendChild(
          el("section", { class: "file-section" }, [
            el("div", { class: "file-section__head" }, [
              el("span", { class: "file-section__idx" }, [`File ${fileIdx + 1}`]),
              el("strong", { class: "file-section__name" }, [pdf.file.name]),
              el("span", { class: "muted" }, [`${pdf.pages} pages · ${formatBytes(pdf.file.size)}`])
            ]),
            el("div", { class: "row" }, [
              el("span", { class: "muted" }, ["Split by"]),
              rangeInput,
              splitBtn
            ])
          ])
        );
      });
    };

    onEntriesChange(renderSections);
    renderSections();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Split one PDF at a time by ranges, e.g. “1-3,5,8-9”. With several files, split applies per file."
      ]),
      dropzoneEl(ctx, "PDF files — split applies per file"),
      fileListEl(),
      sectionsHost
    );
  }
};

// Organize: per-PDF page grid — drag & drop reorder, select + delete, Undo/Redo, Save.
const organizeFeature: Feature = {
  id: "organize",
  label: "Organize",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });

    const buildSection = (pdf: Entry, fileIdx: number): void => {
      const gridWrap = el("div", { class: "page-grid" });
      const selected = new Set<number>();
      const deleteBtn = el("button", { class: "btn btn--danger", type: "button", disabled: "" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete"]),
        "Delete selected pages"
      ]);
      const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
        "Save this PDF"
      ]);
      const section = el("section", { class: "file-section" }, [
        el("div", { class: "file-section__head" }, [
          el("span", { class: "file-section__idx" }, [`File ${fileIdx + 1}`]),
          el("strong", { class: "file-section__name" }, [pdf.file.name]),
          el("span", { class: "muted" }, [`${pdf.pages} pages · ${formatBytes(pdf.file.size)}`])
        ]),
        el("p", { class: "muted file-section__hint" }, [
          "Drag pages to reorder · click to select · Delete removes · Undo/Redo anytime"
        ]),
        gridWrap,
        el("div", { class: "row gap file-section__actions" }, [deleteBtn, saveBtn])
      ]);
      sectionsHost.appendChild(section);

      const snapshot = () => ({ data: pdf.data, order: [...pdf.order], pages: pdf.pages });
      const restore = (s: { data: Uint8Array; order: number[]; pages: number }) => {
        pdf.data = s.data;
        pdf.order = s.order;
        pdf.pages = s.pages;
        renderGrid();
      };
      const dragFrom = { pos: -1 };

      const renderGrid = async () => {
        selected.clear();
        deleteBtn.disabled = true;
        gridWrap.replaceChildren();
        if (!pdf.pages) return;
        ctx.busy.spin(`Rendering pages (${pdf.file.name})…`);
        try {
          const cells = new Map<number, HTMLElement>();
          await pdfPageThumbs(pdf.data, (canvas, pageNum) => {
            const cell = el("button", {
              class: "page-cell",
              type: "button",
              draggable: "true",
              "data-page": String(pageNum)
            }, [canvas]);
            cell.appendChild(el("span", { class: "page-cell__no" }, [String(pdf.order.indexOf(pageNum) + 1)]));
            cell.addEventListener("click", () => {
              if (dragFrom.pos >= 0) return;
              if (selected.has(pageNum)) selected.delete(pageNum);
              else selected.add(pageNum);
              cell.classList.toggle("page-cell--selected", selected.has(pageNum));
              deleteBtn.disabled = selected.size === 0;
            });
            cell.addEventListener("dragstart", () => {
              dragFrom.pos = pdf.order.indexOf(pageNum);
              cell.classList.add("page-cell--dragging");
            });
            cell.addEventListener("dragend", () => {
              cell.classList.remove("page-cell--dragging");
              gridWrap.querySelectorAll(".page-cell--drop").forEach((c) => c.classList.remove("page-cell--drop"));
            });
            cell.addEventListener("dragover", (e) => {
              e.preventDefault();
              cell.classList.add("page-cell--drop");
            });
            cell.addEventListener("dragleave", () => cell.classList.remove("page-cell--drop"));
            cell.addEventListener("drop", (e) => {
              e.preventDefault();
              cell.classList.remove("page-cell--drop");
              const to = pdf.order.indexOf(pageNum);
              if (dragFrom.pos < 0 || dragFrom.pos === to) return;
              const before = snapshot();
              const order = [...pdf.order];
              const [moved] = order.splice(dragFrom.pos, 1);
              order.splice(to, 0, moved);
              pdf.order = order;
              const after = snapshot();
              ctx.pushHistory({
                label: `moved page ${before.order[dragFrom.pos]} → position ${to + 1}`,
                undo: () => restore(before),
                redo: () => restore(after)
              });
              dragFrom.pos = -1;
              renderGrid();
            });
            cells.set(pageNum, cell);
          });
          for (const pageNum of pdf.order) {
            const c = cells.get(pageNum);
            if (c) gridWrap.appendChild(c);
          }
        } catch {
          gridWrap.replaceChildren(el("p", { class: "muted" }, ["Failed to render page previews."]));
        } finally {
          ctx.busy.done();
        }
      };

      deleteBtn.addEventListener("click", async () => {
        if (!selected.size) return;
        const before = snapshot();
        const keep = pdf.order.filter((p) => !selected.has(p));
        if (!keep.length) return toast("Cannot delete every page", "error");
        ctx.busy.spin("Deleting pages…");
        try {
          pdf.data = await extractPages(pdf.data, keep.map((p) => p - 1));
          pdf.order = keep;
          pdf.pages = keep.length;
          const after = snapshot();
          ctx.pushHistory({
            label: `deleted ${selected.size} page(s)`,
            undo: () => restore(before),
            redo: () => restore(after)
          });
          toast(`Deleted ${selected.size} page(s) — Undo available`, "success");
        } catch (e) {
          toast(`Delete failed: ${e instanceof Error ? e.message : e}`, "error");
        } finally {
          ctx.busy.done();
          renderGrid();
        }
      });

      saveBtn.addEventListener("click", async () => {
        ctx.busy.spin("Saving organized PDF…");
        try {
          const out = await extractPages(pdf.data, pdf.order.map((p) => p - 1));
          ctx.showResult([
            {
              name: pdf.file.name.replace(/\.pdf$/i, "-organized.pdf"),
              blob: blobFromBytes(out, "application/pdf"),
              mime: "application/pdf"
            }
          ]);
        } catch (e) {
          toast(`Save failed: ${e instanceof Error ? e.message : e}`, "error");
        } finally {
          ctx.busy.done();
        }
      });

      renderGrid();
    };

    const renderSections = () => {
      sectionsHost.replaceChildren();
      const list = pdfs();
      if (!list.length) {
        sectionsHost.appendChild(
          el("div", { class: "file-empty" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["grid_view"]),
            "Add one or more PDFs — drag pages to reorder and delete selected ones."
          ])
        );
        return;
      }
      list.forEach(buildSection);
    };

    onEntriesChange(renderSections);
    renderSections();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Dry-run before saving: drag to reorder, select & delete, Undo/Redo anytime."
      ]),
      dropzoneEl(ctx, "PDF — organize applies per file"),
      fileListEl(),
      sectionsHost
    );
  }
};

// ── Tool entry ────────────────────────────────────────

export const mount = (root: HTMLElement): void => {
  clear(root);
  const shell = ToolShell(
    "Merge & Split",
    [mergeFeature, splitFeature, organizeFeature],
    { onReset: () => entries.length = 0 }
  );
  notifyActivity = shell.activity;
  root.append(shell.node);

  // handoff ke fitur tool yang sama (event dari output-panel Send-to)
  window.addEventListener(SAME_TOOL_EVENT, (e) => {
    const featureId = (e as CustomEvent<{ featureId?: string }>).detail?.featureId;
    if (featureId) shell.activate(featureId);
  });

  // handoff intake (oper file dari tool lain) — masuk langsung ke daftar file
  const incoming = takeHandoff("pdf-organizer");
  if (incoming.length) {
    void addFiles(incoming, { busy: noopBusy() });
    toast(`${incoming.length} file(s) handed off — switch to a feature to use them`, "success");
  }
};