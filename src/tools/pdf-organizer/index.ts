import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { fileThumb, pdfPageThumbs } from "../../lib/thumb";
import { formatBytes, blobFromBytes } from "../../lib/files";
import {
  mergePdfs,
  splitPdfByOrderRanges,
  extractPages,
  validatePdf,
  imageToPdf
} from "../../lib/pdf-core";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";

type Kind = "pdf" | "image";

interface Entry {
  file: File;
  data: Uint8Array;
  pages: number; // current page count (mutated by organize)
  order: number[]; // 1-based page order (organize/split reorder this)
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
const short = (s: string, n = 10): string => (s.length > n ? `${s.slice(0, n)}…` : s);

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

// ── shared drag & drop ────────────────────────────────────
interface DragState {
  from: number;
  justClick: boolean;
}

const newDragState = (): DragState => ({ from: -1, justClick: false });

/**
 * Attach HTML5 drag to a page cell. `getPos()` reads current index of this
 * cell's item; `onDrop(targetIndex)` runs the actual move. Both dragend and
 * drop reset `from` and swallow the browser's click-after-drag.
 */
const bindDnd = (
  cell: HTMLElement,
  grid: HTMLElement,
  state: DragState,
  getPos: () => number,
  onDrop: (to: number) => void
): void => {
  cell.addEventListener("dragstart", () => {
    state.from = getPos();
    cell.classList.add("page-cell--dragging");
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("page-cell--dragging");
    grid
      .querySelectorAll(".page-cell--drop")
      .forEach((c) => c.classList.remove("page-cell--drop"));
    state.from = -1;
    state.justClick = true;
  });
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    cell.classList.add("page-cell--drop");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("page-cell--drop"));
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("page-cell--drop");
    if (state.from < 0) return;
    const to = getPos();
    if (to !== state.from) onDrop(to);
    state.from = -1;
    state.justClick = true;
  });
};

/** True when a normal click may proceed (i.e. not right after a drag). */
const isCleanClick = (state: DragState): boolean => {
  if (state.justClick) {
    state.justClick = false;
    return false;
  }
  return state.from < 0;
};

/** Small ◀/▶ buttons under every cell — touch-friendly reordering. */
const moveButtons = (cell: HTMLElement, onMove: (delta: -1 | 1) => void): void => {
  const prev = el("button", { class: "page-cell__move", type: "button", "aria-label": "Move left" }, [
    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["chevron_left"])
  ]);
  const next = el("button", { class: "page-cell__move", type: "button", "aria-label": "Move right" }, [
    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["chevron_right"])
  ]);
  prev.addEventListener("click", (e) => {
    e.stopPropagation();
    onMove(-1);
  });
  next.addEventListener("click", (e) => {
    e.stopPropagation();
    onMove(1);
  });
  cell.appendChild(el("div", { class: "page-cell__moves" }, [prev, next]));
};

// ── shared UI bits ────────────────────────────────────────

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

// ── Feature: Merge ─────────────────────────────────────────────
// One flat preview grid of EVERY page (all files); drag to order pages.
interface MergeItem {
  entryIdx: number;
  page: number | null;
}

const mergeFeature: Feature = {
  id: "merge",
  label: "Merge",
  mount(host, ctx) {
    const status = el("span", { class: "muted" });
    const grid = el("div", { class: "page-grid page-grid--merge" });
    const mergeBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["merge"]),
      "Merge in this order"
    ]);
    const state = newDragState();
    let items: MergeItem[] = [];

    const syncItems = () => {
      items = [];
      entries.forEach((e, entryIdx) => {
        if (e.kind === "image") items.push({ entryIdx, page: null });
        else for (let p = 1; p <= e.pages; p++) items.push({ entryIdx, page: p });
      });
    };
    const copyItems = (): MergeItem[] => items.map((i) => ({ ...i }));
    const posOf = (item: MergeItem): number => items.indexOf(item);

    const applyMove = (from: number, to: number) => {
      if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return;
      const before = copyItems();
      const copy = [...items];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      items = copy;
      const after = copyItems();
      ctx.pushHistory({
        label: "reordered pages",
        undo: () => {
          items = before;
          void render();
        },
        redo: () => {
          items = after;
          void render();
        }
      });
      void render();
    };

    const render = async () => {
      syncItems();
      const n = entries.length;
      status.textContent = n
        ? `${n} file(s) · ${formatBytes(totalSize())} · ${items.length} pages`
        : "";
      mergeBtn.disabled = n < 2;
      grid.replaceChildren();
      if (!n) return;
      ctx.busy.spin("Rendering combined preview…");
      try {
        const thumbs = new Map<string, HTMLElement>();
        const imgNodes = new Map<number, HTMLElement>();
        for (let idx = 0; idx < entries.length; idx++) {
          const e = entries[idx];
          if (e.kind === "image") {
            void fileThumb(e.file).then((t) => imgNodes.set(idx, t.node));
          } else {
            await pdfPageThumbs(e.data, (canvas, pageNum) =>
              thumbs.set(`${idx}:${pageNum}`, canvas)
            );
          }
        }
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const e = entries[item.entryIdx];
          const thumb =
            item.page !== null ? thumbs.get(`${item.entryIdx}:${item.page}`) : imgNodes.get(item.entryIdx);
          const cell = el("button", { class: "page-cell page-cell--merge", type: "button" }, [
            thumb ?? el("span", { class: "muted" }, ["…"])
          ]);
          cell.appendChild(
            el("div", { class: "page-cell__tags" }, [
              el("span", { class: "page-cell__tag page-cell__pos" }, [String(i + 1)]),
              el("span", { class: "page-cell__tag" }, [short(e.file.name)]),
              item.page !== null
                ? el("span", { class: "page-cell__tag" }, [`p${item.page}`])
                : el("span", { class: "page-cell__tag page-cell__tag--img" }, ["IMG"])
            ])
          );
          cell.addEventListener("click", () => void isCleanClick(state));
          bindDnd(cell, grid, state, () => posOf(item), (to) => applyMove(posOf(item), to));
          moveButtons(cell, (delta) => applyMove(posOf(item), posOf(item) + delta));
          grid.appendChild(cell);
        }
      } catch {
        grid.replaceChildren(el("p", { class: "muted" }, ["Failed to render page previews."]));
      } finally {
        ctx.busy.done();
      }
    };

    mergeBtn.addEventListener("click", async () => {
      if (entries.length < 2) return toast("Merge needs at least 2 files", "error");
      mergeBtn.disabled = true;
      ctx.busy.spin("Merging…");
      try {
        const parts: Uint8Array[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const e = entries[item.entryIdx];
          ctx.busy.progress(i / items.length, `Preparing ${i + 1}/${items.length}`);
          parts.push(
            item.page !== null ? await extractPages(e.data, [item.page - 1]) : await imageToPdf(e.data)
          );
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
        toast(`Merge ready — ${items.length} page(s)`, "success");
      } catch (e) {
        toast(`Merge failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        mergeBtn.disabled = entries.length < 2;
        ctx.busy.done();
      }
    });

    onEntriesChange(() => void render());
    void render();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Combined preview of every page — drag any page (also across files) to set merge order."
      ]),
      dropzoneEl(ctx, "2+ files — PDF, PNG, JPG"),
      fileListEl(),
      status,
      grid,
      el("div", { class: "row" }, [mergeBtn])
    );
  }
};

// ── Feature: Split ─────────────────────────────────────────────
const splitFeature: Feature = {
  id: "split",
  label: "Split",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });

    const renderSections = () => {
      if (!sectionsHost.isConnected) return;
      sectionsHost.replaceChildren();
      const list = pdfs();
      if (!list.length) {
        sectionsHost.appendChild(
          el("div", { class: "file-empty" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
            "Add a PDF to split it by page ranges."
          ])
        );
        return;
      }
      list.forEach((pdf, fileIdx) => {
        const gridWrap = el("div", { class: "page-grid" });
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
        const state = newDragState();
        const selected = new Set<number>();

        const buildRangesFromSelection = () => {
          const pos = [...selected].sort((a, b) => a - b).map((p) => `${p}`);
          rangeInput.value = pos.length ? pos.join(", ") : `1-${pdf.pages}`;
        };
        const renderGrid = async () => {
          gridWrap.replaceChildren();
          ctx.busy.spin(`Rendering pages (${pdf.file.name})…`);
          try {
            const cells = new Map<number, HTMLElement>();
            await pdfPageThumbs(pdf.data, (canvas, pageNum) => {
              const cell = el("button", { class: "page-cell", type: "button" }, [canvas]);
              cell.appendChild(el("span", { class: "page-cell__no" }, [String(pdf.order.indexOf(pageNum) + 1)]));
              cell.addEventListener("click", () => {
                if (!isCleanClick(state)) return;
                const pos = pdf.order.indexOf(pageNum);
                if (selected.has(pos)) selected.delete(pos);
                else selected.add(pos);
                cell.classList.toggle("page-cell--selected", selected.has(pos));
                buildRangesFromSelection();
              });
              bindDnd(cell, gridWrap, state, () => pdf.order.indexOf(pageNum), (to) => {
                const before = [...pdf.order];
                const copy = [...pdf.order];
                const [moved] = copy.splice(pdf.order.indexOf(pageNum), 1);
                copy.splice(to, 0, moved);
                pdf.order = copy;
                const after = [...pdf.order];
                ctx.pushHistory({
                  label: "reordered pages",
                  undo: () => { pdf.order = before; void renderGrid(); },
                  redo: () => { pdf.order = after; void renderGrid(); }
                });
                void renderGrid();
              });
              moveButtons(cell, (delta) => {
                const pos = pdf.order.indexOf(pageNum);
                const to = pos + delta;
                if (to < 0 || to >= pdf.order.length || to === pos) return;
                const before = [...pdf.order];
                const copy = [...pdf.order];
                const [moved] = copy.splice(pos, 1);
                copy.splice(to, 0, moved);
                pdf.order = copy;
                const after = [...pdf.order];
                ctx.pushHistory({
                  label: "reordered pages",
                  undo: () => { pdf.order = before; void renderGrid(); },
                  redo: () => { pdf.order = after; void renderGrid(); }
                });
                void renderGrid();
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

        splitBtn.addEventListener("click", async () => {
          if (!entries.includes(pdf)) return;
          splitBtn.disabled = true;
          ctx.busy.spin("Splitting…");
          try {
            const parts = await splitPdfByOrderRanges(pdf.data, pdf.order, rangeInput.value);
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
            el("p", { class: "muted file-section__hint" }, [
              "Drag pages to reorder (ranges follow the shown order) · click pages to pick ranges"
            ]),
            gridWrap,
            el("div", { class: "row" }, [
              el("span", { class: "muted" }, ["Split by"]),
              rangeInput,
              splitBtn
            ])
          ])
        );
        void renderGrid();
      });
    };

    onEntriesChange(renderSections);
    renderSections();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Preview each file's pages, reorder with drag & drop, then split per file."
      ]),
      dropzoneEl(ctx, "PDF files — split applies per file"),
      fileListEl(),
      sectionsHost
    );
  }
};

// ── Feature: Organize (per-file) ──────────────────────────────────
const organizeFeature: Feature = {
  id: "organize",
  label: "Organize",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });

    const buildSection = (pdf: Entry, fileIdx: number): void => {
      const gridWrap = el("div", { class: "page-grid" });
      const selected = new Set<number>();
      const state = newDragState();
      const count = el("span", { class: "selection-bar__count" }, ["0 selected"]);
      const clearBtn = el("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: "" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["close"]),
        "Clear"
      ]);
      const deleteBtn = el("button", { class: "btn btn--sm btn--danger", type: "button", disabled: "" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete"]),
        "Delete selected"
      ]);
      const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
        "Save this PDF"
      ]);
      const selectionBar = el("div", { class: "selection-bar" }, [count, clearBtn, deleteBtn]);
      const section = el("section", { class: "file-section" }, [
        el("div", { class: "file-section__head" }, [
          el("span", { class: "file-section__idx" }, [`File ${fileIdx + 1}`]),
          el("strong", { class: "file-section__name" }, [pdf.file.name]),
          el("span", { class: "muted" }, [`${pdf.pages} pages · ${formatBytes(pdf.file.size)}`])
        ]),
        el("p", { class: "muted file-section__hint" }, [
          "Drag pages to reorder · click to select · Undo/Redo anytime"
        ]),
        gridWrap,
        selectionBar,
        el("div", { class: "row file-section__actions" }, [saveBtn])
      ]);
      sectionsHost.appendChild(section);

      const refreshSelectionBar = () => {
        count.textContent = `${selected.size} selected`;
        clearBtn.disabled = selected.size === 0;
        deleteBtn.disabled = selected.size === 0;
      };
      void selectionBar;

      const snapshot = () => ({ data: pdf.data, order: [...pdf.order], pages: pdf.pages });
      const restore = (s: { data: Uint8Array; order: number[]; pages: number }) => {
        pdf.data = s.data;
        pdf.order = s.order;
        pdf.pages = s.pages;
        void renderGrid();
      };

      const renderGrid = async () => {
        selected.clear();
        refreshSelectionBar();
        gridWrap.replaceChildren();
        if (!pdf.pages) return;
        ctx.busy.spin(`Rendering pages (${pdf.file.name})…`);
        try {
          const cells = new Map<number, HTMLElement>();
          await pdfPageThumbs(pdf.data, (canvas, pageNum) => {
            const cell = el("button", { class: "page-cell", type: "button" }, [canvas]);
            cell.appendChild(el("span", { class: "page-cell__no" }, [String(pdf.order.indexOf(pageNum) + 1)]));
            cell.appendChild(el("span", { class: "page-cell__check" }, [
              el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["check"])
            ]));
            cell.addEventListener("click", () => {
              if (!isCleanClick(state)) return;
              if (selected.has(pageNum)) selected.delete(pageNum);
              else selected.add(pageNum);
              cell.classList.toggle("page-cell--selected", selected.has(pageNum));
              refreshSelectionBar();
            });
            bindDnd(cell, gridWrap, state, () => pdf.order.indexOf(pageNum), (to) => {
              const before = [...pdf.order];
              const copy = [...pdf.order];
              const [moved] = copy.splice(pdf.order.indexOf(pageNum), 1);
              copy.splice(to, 0, moved);
              pdf.order = copy;
              const after = [...pdf.order];
              ctx.pushHistory({
                label: "reordered pages",
                undo: () => { pdf.order = before; void renderGrid(); },
                redo: () => { pdf.order = after; void renderGrid(); }
              });
              void renderGrid();
            });
            moveButtons(cell, (delta) => {
              const pos = pdf.order.indexOf(pageNum);
              const to = pos + delta;
              if (to < 0 || to >= pdf.order.length || to === pos) return;
              const before = [...pdf.order];
              const copy = [...pdf.order];
              const [moved] = copy.splice(pos, 1);
              copy.splice(to, 0, moved);
              pdf.order = copy;
              const after = [...pdf.order];
              ctx.pushHistory({
                label: "reordered pages",
                undo: () => { pdf.order = before; void renderGrid(); },
                redo: () => { pdf.order = after; void renderGrid(); }
              });
              void renderGrid();
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

      clearBtn.addEventListener("click", () => {
        selected.clear();
        refreshSelectionBar();
        void renderGrid();
      });

      deleteBtn.addEventListener("click", async () => {
        const doomed = [...selected].filter((p) => pdf.order.includes(p));
        if (!doomed.length) return toast("Select pages to delete first", "error");
        const before = snapshot();
        const keep = pdf.order.filter((p) => !doomed.includes(p));
        if (!keep.length) return toast("Cannot delete every page", "error");
        ctx.busy.spin("Deleting pages…");
        try {
          pdf.data = await extractPages(pdf.data, keep.map((p) => p - 1));
          pdf.order = keep;
          pdf.pages = keep.length;
          const after = snapshot();
          ctx.pushHistory({
            label: `deleted ${doomed.length} page(s)`,
            undo: () => restore(before),
            redo: () => restore(after)
          });
          toast(`Deleted ${doomed.length} page(s) — Undo available`, "success");
        } catch (e) {
          toast(`Delete failed: ${e instanceof Error ? e.message : e}`, "error");
        } finally {
          ctx.busy.done();
          void renderGrid();
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
    };

    const renderSections = () => {
      if (!sectionsHost.isConnected) return;
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
    { onReset: () => (entries.length = 0) }
  );
  notifyActivity = shell.activity;
  root.append(shell.node);

  window.addEventListener(SAME_TOOL_EVENT, (e) => {
    const featureId = (e as CustomEvent<{ featureId?: string }>).detail?.featureId;
    if (featureId) shell.activate(featureId);
  });

  const incoming = takeHandoff("pdf-organizer");
  if (incoming.length) {
    void addFiles(incoming, { busy: noopBusy() });
    toast(`${incoming.length} file(s) handed off — switch to a feature to use them`, "success");
  }
};