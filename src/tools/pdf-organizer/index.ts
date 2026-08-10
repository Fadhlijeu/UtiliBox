import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { createHistoryBar, type HistoryBarApi } from "../../components/history-bar";
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
  originalData: Uint8Array;
  pages: number; // current page count
  originalPages: number;
  order: number[]; // 1-based page order
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

const withScrollPreserved = (fn: () => void): void => {
  const scrollY = window.scrollY;
  fn();
  window.scrollTo({ top: scrollY, behavior: "instant" });
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
        const raw = new Uint8Array(await readFileAsArrayBuffer(f));
        entries.push({
          file: f,
          data: raw,
          originalData: raw.slice(),
          pages: 1,
          originalPages: 1,
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
        originalData: data.slice(),
        pages,
        originalPages: pages,
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

// ── shared list / grid helpers ────────────────────────────
const fileListEl = (): HTMLElement => {
  const container = el("div", { class: "file-list-container" });
  const list = el("ul", { class: "file-list" });
  const header = el("div", { class: "file-list__head" });

  const render = () => {
    if (!entries.length) {
      container.replaceChildren();
      return;
    }

    const deleteAllBtn = el(
      "button",
      { class: "btn btn--sm btn--danger", type: "button" },
      [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete_forever"]),
        "Delete all files"
      ]
    );
    deleteAllBtn.addEventListener("click", () => {
      entries.length = 0;
      emitChange();
      toast("All files deleted", "info");
    });

    header.replaceChildren(
      el("span", { class: "muted file-list__summary" }, [
        `${entries.length} file(s) · ${formatBytes(totalSize())}`
      ]),
      deleteAllBtn
    );

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

    container.replaceChildren(header, list);
  };

  list.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (btn) removeEntry(Number(btn.dataset.remove));
  });

  onEntriesChange(render);
  render();
  return container;
};

const dropzoneEl = (ctx: FeatureCtx, hint: string): HTMLElement =>
  dropzone({
    label: "Add PDFs & images",
    hint,
    multiple: true,
    accept: ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg",
    onFiles: (fs) => void addFiles(fs, ctx)
  });

// ── drag & drop + live DOM reorder (NO re-render on move) ───

interface GridState {
  from: number;
  suppressUntil: number; // ignore clicks right after a drag ends
}

const liveIndex = (grid: HTMLElement, cell: HTMLElement): number =>
  Array.from(grid.children).indexOf(cell);

const reorderDom = (grid: HTMLElement, cell: HTMLElement, to: number): number => {
  const kids = Array.from(grid.children);
  const from = kids.indexOf(cell);
  if (from < 0 || to < 0 || to >= kids.length || from === to) return -1;
  const [moved] = kids.splice(from, 1);
  kids.splice(to, 0, moved);
  grid.replaceChildren(...(kids as HTMLElement[]));
  return from;
};

const refreshPositions = (grid: HTMLElement): void => {
  grid.querySelectorAll<HTMLElement>(".page-cell").forEach((c, i) => {
    const badge = c.querySelector<HTMLElement>(".page-cell__no, .page-cell__pos");
    if (badge) badge.textContent = String(i + 1);
  });
};

let activeDragFromIndex = -1;

const bindDnd = (
  cell: HTMLElement,
  grid: HTMLElement,
  state: GridState,
  onDrop: (from: number, to: number) => void
): void => {
  cell.draggable = true;
  cell.addEventListener("dragstart", (e) => {
    activeDragFromIndex = liveIndex(grid, cell);
    state.from = activeDragFromIndex;
    cell.classList.add("page-cell--dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(activeDragFromIndex));
    }
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("page-cell--dragging");
    grid
      .querySelectorAll(".page-cell--drop")
      .forEach((c) => c.classList.remove("page-cell--drop"));
    state.from = -1;
    state.suppressUntil = Date.now() + 350;
    setTimeout(() => {
      activeDragFromIndex = -1;
    }, 100);
  });
  cell.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    cell.classList.add("page-cell--drop");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("page-cell--drop"));
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("page-cell--drop");
    let from = activeDragFromIndex >= 0 ? activeDragFromIndex : state.from;
    if (from < 0 && e.dataTransfer) {
      const val = e.dataTransfer.getData("text/plain");
      if (val) from = Number(val);
    }
    const to = liveIndex(grid, cell);
    state.from = -1;
    state.suppressUntil = Date.now() + 350;
    if (from >= 0 && to >= 0 && from !== to) {
      onDrop(from, to);
    }
  });
};

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

// ── Feature: Merge (flat combined preview, live drag reorder) ──

interface MergeItem {
  entryIdx: number;
  page: number | null; // null → image
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
    const state: GridState = { from: -1, suppressUntil: 0 };
    const itemCache = new Map<string, MergeItem>();
    let items: MergeItem[] = [];
    let cellByItem = new Map<MergeItem, HTMLElement>();

    const getItem = (entryIdx: number, page: number | null): MergeItem => {
      const key = `${entryIdx}:${page ?? "img"}`;
      let it = itemCache.get(key);
      if (!it) {
        it = { entryIdx, page };
        itemCache.set(key, it);
      }
      return it;
    };

    const syncItems = () => {
      items = [];
      entries.forEach((e, entryIdx) => {
        if (e.kind === "image") items.push(getItem(entryIdx, null));
        else for (let p = 1; p <= e.pages; p++) items.push(getItem(entryIdx, p));
      });
    };
    const cloneItems = (): MergeItem[] => [...items];

    const relayoutFromCache = () => {
      withScrollPreserved(() => {
        grid.replaceChildren(...items.map((it) => cellByItem.get(it)).filter((c): c is HTMLElement => !!c));
        refreshPositions(grid);
      });
    };

    const mergeHistory = createHistoryBar({
      baselineLabel: "Original order",
      onReset: () => {
        syncItems();
        relayoutFromCache();
      }
    });

    const applyMove = (from: number, to: number) => {
      const kids = Array.from(grid.children);
      if (from < 0 || to < 0 || from === to || from >= kids.length || to >= kids.length) return;
      const cell = kids[from] as HTMLElement;
      withScrollPreserved(() => {
        const actualFrom = reorderDom(grid, cell, to);
        if (actualFrom < 0) return;
        const before = cloneItems();
        const copy = [...items];
        const [moved] = copy.splice(from, 1);
        copy.splice(to, 0, moved);
        items = copy;
        const after = cloneItems();
        const movedItem = items[to];
        const pageLabel = movedItem?.page !== null ? `page ${movedItem.page}` : "image";
        mergeHistory.pushHistory({
          label: `Moved ${pageLabel} to position ${to + 1}`,
          undo: () => {
            items = before;
            relayoutFromCache();
          },
          redo: () => {
            items = after;
            relayoutFromCache();
          }
        });
      });
    };

    const render = async () => {
      syncItems();
      const n = entries.length;
      status.textContent = n
        ? `${n} file(s) · ${formatBytes(totalSize())} · ${items.length} pages`
        : "";
      mergeBtn.disabled = n < 2;
      grid.replaceChildren();
      if (!n) {
        cellByItem = new Map();
        return;
      }
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
        cellByItem = new Map();
        for (const item of items) {
          const e = entries[item.entryIdx];
          const thumb =
            item.page !== null ? thumbs.get(`${item.entryIdx}:${item.page}`) : imgNodes.get(item.entryIdx);
          const cell = el("div", { class: "page-cell page-cell--merge", tabindex: "0", role: "button" }, [
            thumb ?? el("span", { class: "muted" }, ["…"])
          ]);
          cell.appendChild(
            el("div", { class: "page-cell__tags" }, [
              el("span", { class: "page-cell__pos" }, ["1"]),
              el("span", { class: "page-cell__tag" }, [short(e.file.name)]),
              item.page !== null
                ? el("span", { class: "page-cell__tag" }, [`p${item.page}`])
                : el("span", { class: "page-cell__tag page-cell__tag--img" }, ["IMG"])
            ])
          );
          bindDnd(cell, grid, state, (from, to) => applyMove(from, to));
          moveButtons(cell, (delta) => {
            const kids = Array.from(grid.children);
            const from = kids.indexOf(cell);
            applyMove(from, from + delta);
          });
          cellByItem.set(item, cell);
        }
        relayoutFromCache();
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
        ctx.showResult(
          [
            {
              name: `merged-${entries.length}-files.pdf`,
              blob: blobFromBytes(out, "application/pdf"),
              mime: "application/pdf",
              sourceFeatureId: "merge",
              sourceLabel: "Merge"
            }
          ],
          "merge",
          "Merge"
        );
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
      mergeHistory.node,
      grid,
      el("div", { class: "row" }, [mergeBtn])
    );
  }
};

// ── shared per-file preview section (Split & Organize) ─────────

interface PdfSectionApi {
  grid: HTMLElement;
  selected: Set<number>; // page numbers (1-based)
  historyBar: HistoryBarApi;
  renderGrid: () => Promise<void>;
  relayoutFromOrder: () => void;
  clearSelection: () => void;
}

interface SectionOpts {
  hint: string;
  topRows?: Node[];
  bottomRows: Node[]; // extra rows below grid (actions / selection bar)
  onReset?: () => void;
  onSelectionChange?: () => void;
  onOrderChange?: () => void;
}

const buildPdfSection = (
  pdf: Entry,
  fileIdx: number,
  opts: SectionOpts,
  ctx: Pick<FeatureCtx, "busy">
): { section: HTMLElement; api: PdfSectionApi } => {
  const grid = el("div", { class: "page-grid" });
  const cellByPage = new Map<number, HTMLElement>();
  const selected = new Set<number>();
  const state: GridState = { from: -1, suppressUntil: 0 };
  let lastSelectedPage: number | null = null;

  const historyBar = createHistoryBar({
    baselineLabel: pdf.file.name,
    onReset: opts.onReset
  });

  const syncSelectionClasses = () => {
    grid.querySelectorAll<HTMLElement>(".page-cell").forEach((c) => {
      const p = Number(c.dataset.page);
      c.classList.toggle("page-cell--selected", selected.has(p));
    });
  };

  const relayoutFromOrder = () => {
    withScrollPreserved(() => {
      grid.replaceChildren(
        ...pdf.order.map((p) => cellByPage.get(p)).filter((c): c is HTMLElement => !!c)
      );
      refreshPositions(grid);
      syncSelectionClasses();
    });
  };

  const togglePageSelection = (pageNum: number, isShift: boolean) => {
    if (isShift && lastSelectedPage !== null && lastSelectedPage !== pageNum) {
      const idxA = pdf.order.indexOf(lastSelectedPage);
      const idxB = pdf.order.indexOf(pageNum);
      if (idxA >= 0 && idxB >= 0) {
        const min = Math.min(idxA, idxB);
        const max = Math.max(idxA, idxB);
        const range = pdf.order.slice(min, max + 1);
        const shouldSelect = !selected.has(pageNum);
        for (const p of range) {
          if (shouldSelect) selected.add(p);
          else selected.delete(p);
        }
      }
    } else {
      if (selected.has(pageNum)) selected.delete(pageNum);
      else selected.add(pageNum);
    }
    lastSelectedPage = pageNum;
    syncSelectionClasses();
    opts.onSelectionChange?.();
  };

  const applyOrderMove = (from: number, to: number) => {
    const kids = Array.from(grid.children);
    if (from < 0 || to < 0 || from === to || from >= kids.length || to >= kids.length) return;
    const cell = kids[from] as HTMLElement;
    const fromPage = pdf.order[from];
    withScrollPreserved(() => {
      const actualFrom = reorderDom(grid, cell, to);
      if (actualFrom < 0) return;
      const before = [...pdf.order];
      const copy = [...before];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      pdf.order = copy;
      const after = [...pdf.order];
      refreshPositions(grid);
      opts.onOrderChange?.();
      historyBar.pushHistory({
        label: `Moved page ${fromPage} to position ${to + 1}`,
        undo: () => {
          pdf.order = before;
          relayoutFromOrder();
          opts.onOrderChange?.();
        },
        redo: () => {
          pdf.order = after;
          relayoutFromOrder();
          opts.onOrderChange?.();
        }
      });
    });
  };

  const renderGrid = async () => {
    grid.replaceChildren();
    if (!pdf.pages) return;
    ctx.busy.spin(`Rendering pages (${pdf.file.name})…`);
    try {
      cellByPage.clear();
      await pdfPageThumbs(pdf.data, (canvas, pageNum) => {
        const cell = el("div", { class: "page-cell", tabindex: "0", role: "button" }, [canvas]);
        cell.dataset.page = String(pageNum);
        cell.appendChild(el("span", { class: "page-cell__no" }, ["1"]));
        cell.appendChild(
          el("span", { class: "page-cell__check" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["check"])
          ])
        );
        cell.addEventListener("click", (e) => {
          if (state.from >= 0 || Date.now() < state.suppressUntil) return;
          togglePageSelection(pageNum, e.shiftKey);
        });
        cell.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          if (state.from >= 0 || Date.now() < state.suppressUntil) return;
          togglePageSelection(pageNum, true);
        });
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            togglePageSelection(pageNum, e.shiftKey);
          }
        });
        bindDnd(cell, grid, state, (from, to) => applyOrderMove(from, to));
        moveButtons(cell, (delta) => {
          const kids = Array.from(grid.children);
          const from = kids.indexOf(cell);
          applyOrderMove(from, from + delta);
        });
        cellByPage.set(pageNum, cell);
      });
      relayoutFromOrder();
    } catch {
      grid.replaceChildren(el("p", { class: "muted" }, ["Failed to render page previews."]));
    } finally {
      ctx.busy.done();
    }
  };

  const section = el("section", { class: "file-section" }, [
    el("div", { class: "file-section__head" }, [
      el("span", { class: "file-section__idx" }, [`File ${fileIdx + 1}`]),
      el("strong", { class: "file-section__name" }, [pdf.file.name]),
      el("span", { class: "muted" }, [`${pdf.pages} pages · ${formatBytes(pdf.file.size)}`])
    ]),
    el("p", { class: "muted file-section__hint" }, [opts.hint]),
    historyBar.node,
    ...(opts.topRows ?? []),
    grid,
    ...opts.bottomRows
  ]);

  const api: PdfSectionApi = {
    grid,
    selected,
    historyBar,
    renderGrid,
    relayoutFromOrder,
    clearSelection: () => {
      selected.clear();
      syncSelectionClasses();
      opts.onSelectionChange?.();
    }
  };

  return { section, api };
};

const buildSplitSection = (
  pdf: Entry,
  fileIdx: number,
  host: HTMLElement,
  ctx: Pick<FeatureCtx, "busy">,
  opts: {
    rangeInput: HTMLInputElement;
    splitBtn: HTMLButtonElement;
  }
): PdfSectionApi => {
  const syncFromSelection = (sel: Set<number>) => {
    const pos = [...sel]
      .map((p) => pdf.order.indexOf(p) + 1)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    opts.rangeInput.value = pos.length ? pos.join(", ") : `1-${pdf.pages}`;
  };

  const built = buildPdfSection(
    pdf,
    fileIdx,
    {
      hint: "Drag pages to reorder (ranges follow the shown order) · click pages to pick ranges",
      topRows: [],
      bottomRows: [
        el("div", { class: "row" }, [
          el("span", { class: "muted" }, ["Split by"]),
          opts.rangeInput,
          opts.splitBtn
        ])
      ],
      onReset: () => {
        pdf.order = Array.from({ length: pdf.pages }, (_, i) => i + 1);
        built.api.relayoutFromOrder();
        syncFromSelection(built.api.selected);
      },
      onSelectionChange: () => syncFromSelection(built.api.selected),
      onOrderChange: () => syncFromSelection(built.api.selected)
    },
    ctx
  );
  host.appendChild(built.section);
  return built.api;
};

// ── Feature: Split ─────────────────────────────────────────────
const splitFeature: Feature = {
  id: "split",
  label: "Split",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });
    const rangeByPdf = new Map<Entry, string>();

    const splitAllBtn = el("button", { class: "btn", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
      "Split all files"
    ]);

    const runSplit = async (pdf: Entry, ranges: string, fileIdx: number) => {
      const parts = await splitPdfByOrderRanges(pdf.data, pdf.order, ranges);
      if (!parts.length) return;
      const base = pdf.file.name.replace(/\.pdf$/i, "");
      ctx.showResult(
        parts.map((p, i) => ({
          name: parts.length > 1 ? `${base}-part-${i + 1}.pdf` : `${base}.pdf`,
          blob: blobFromBytes(p, "application/pdf"),
          mime: "application/pdf",
          sourceFeatureId: "split",
          sourceLabel: "Split"
        })),
        "split",
        "Split"
      );
      toast(`File ${fileIdx + 1} — ${parts.length} part(s) ready`, "success");
    };

    const renderSections = () => {
      sectionsHost.replaceChildren();
      const list = pdfs();
      splitAllBtn.disabled = list.length < 2;
      if (!list.length) {
        sectionsHost.appendChild(
          el("div", { class: "file-empty" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
            "Add PDFs to split them by page ranges."
          ])
        );
        return;
      }
      list.forEach((pdf, fileIdx) => {
        const rangeInput = el("input", {
          type: "text",
          class: "input",
          placeholder: "e.g. 1-3,5,8-9",
          value: rangeByPdf.get(pdf) ?? `1-${pdf.pages}`
        });
        rangeInput.addEventListener("input", () => rangeByPdf.set(pdf, rangeInput.value));
        const splitBtn = el("button", { class: "btn", type: "button" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
          "Split"
        ]);
        const api = buildSplitSection(pdf, fileIdx, sectionsHost, ctx, {
          rangeInput,
          splitBtn
        });
        const doSplit = async () => {
          splitBtn.disabled = true;
          ctx.busy.spin(`Splitting (${pdf.file.name})…`);
          try {
            await runSplit(pdf, rangeInput.value, fileIdx);
          } catch (e) {
            toast(`Split failed: ${e instanceof Error ? e.message : e}`, "error");
          } finally {
            splitBtn.disabled = false;
            ctx.busy.done();
          }
        };
        splitBtn.addEventListener("click", () => void doSplit());
        void api.renderGrid();
      });
    };

    splitAllBtn.addEventListener("click", async () => {
      const list = pdfs();
      if (list.length < 2) return toast("Add 2+ PDFs to split all", "error");
      splitAllBtn.disabled = true;
      ctx.busy.spin("Splitting all files…");
      try {
        const out: Array<{ name: string; blob: Blob; mime: string; sourceFeatureId?: string; sourceLabel?: string }> = [];
        for (let i = 0; i < list.length; i++) {
          const pdf = list[i];
          ctx.busy.progress(i / list.length, `File ${i + 1}/${list.length}`);
          const ranges = rangeByPdf.get(pdf) ?? `1-${pdf.pages}`;
          const parts = await splitPdfByOrderRanges(pdf.data, pdf.order, ranges);
          const base = pdf.file.name.replace(/\.pdf$/i, "");
          parts.forEach((p, j) =>
            out.push({
              name: parts.length > 1 ? `${base}-part-${j + 1}.pdf` : `${base}.pdf`,
              blob: blobFromBytes(p, "application/pdf"),
              mime: "application/pdf",
              sourceFeatureId: "split",
              sourceLabel: "Split"
            })
          );
        }
        ctx.showResult(out, "split", "Split");
        toast(`Split all — ${out.length} part(s) ready`, "success");
      } catch (e) {
        toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        splitAllBtn.disabled = pdfs().length < 2;
        ctx.busy.done();
      }
    });

    onEntriesChange(renderSections);
    renderSections();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Per-file page previews — drag & move to reorder; ranges follow the shown order."
      ]),
      dropzoneEl(ctx, "PDF files — split applies per file"),
      fileListEl(),
      sectionsHost,
      el("div", { class: "row" }, [splitAllBtn])
    );
  }
};

// ── Feature: Organize (per file, full control) ─────────────────
const organizeFeature: Feature = {
  id: "organize",
  label: "Organize",
  mount(host, ctx) {
    const sectionsHost = el("div", { class: "file-sections" });

    const organizeAllBtn = el("button", { class: "btn", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["folder_zip"]),
      "Organize all files"
    ]);

    const buildOrganizeSection = (pdf: Entry, fileIdx: number): PdfSectionApi => {
      const count = el("span", { class: "selection-bar__count" }, ["0 selected"]);
      const clearBtn = el("button", { class: "btn btn--sm btn--ghost", type: "button", disabled: "disabled" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["close"]),
        "Clear"
      ]);
      const deleteBtn = el("button", { class: "btn btn--sm btn--danger", type: "button", disabled: "disabled" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["delete"]),
        "Delete selected"
      ]);
      const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, [
        el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["download"]),
        "Save this PDF"
      ]);
      const bar = el("div", { class: "selection-bar" }, [count, clearBtn, deleteBtn]);

      const refreshBar = (sel: Set<number>) => {
        count.textContent = `${sel.size} selected`;
        clearBtn.disabled = sel.size === 0;
        deleteBtn.disabled = sel.size === 0;
      };

      const built = buildPdfSection(
        pdf,
        fileIdx,
        {
          hint: "Drag pages to reorder · click to select · Undo/Redo anytime",
          topRows: [bar],
          bottomRows: [el("div", { class: "row file-section__actions" }, [saveBtn])],
          onReset: () => {
            pdf.data = pdf.originalData.slice();
            pdf.pages = pdf.originalPages;
            pdf.order = Array.from({ length: pdf.pages }, (_, i) => i + 1);
            built.api.clearSelection();
            void built.api.renderGrid();
          },
          onSelectionChange: () => refreshBar(built.api.selected)
        },
        ctx
      );
      const api = built.api;
      sectionsHost.appendChild(built.section);
      refreshBar(api.selected);

      clearBtn.addEventListener("click", () => {
        api.clearSelection();
        refreshBar(api.selected);
      });

      deleteBtn.addEventListener("click", async () => {
        const doomed = [...api.selected].filter((p) => pdf.order.includes(p));
        if (!doomed.length) return toast("Select pages to delete first", "error");
        const keep = pdf.order.filter((p) => !doomed.includes(p));
        if (!keep.length) return toast("Cannot delete every page", "error");
        const beforeData = pdf.data;
        const beforeOrder = [...pdf.order];
        const beforePages = pdf.pages;
        const afterData = await extractPages(pdf.data, keep.map((p) => p - 1));
        const afterOrder = [...keep];
        api.historyBar.pushHistory({
          label: `Removed ${doomed.length} page(s) (${doomed.sort((a, b) => a - b).join(", ")})`,
          undo: () => {
            pdf.data = beforeData;
            pdf.order = beforeOrder;
            pdf.pages = beforePages;
            void api.renderGrid();
          },
          redo: () => {
            pdf.data = afterData;
            pdf.order = afterOrder;
            pdf.pages = afterOrder.length;
            void api.renderGrid();
          }
        });
        pdf.data = afterData;
        pdf.order = afterOrder;
        pdf.pages = afterOrder.length;
        api.clearSelection();
        refreshBar(api.selected);
        toast(`Deleted ${doomed.length} page(s) — Undo available`, "success");
        void api.renderGrid();
      });

      saveBtn.addEventListener("click", async () => {
        ctx.busy.spin(`Saving (${pdf.file.name})…`);
        try {
          const out = await extractPages(pdf.data, pdf.order.map((p) => p - 1));
          ctx.showResult(
            [
              {
                name: pdf.file.name.replace(/\.pdf$/i, "-organized.pdf"),
                blob: blobFromBytes(out, "application/pdf"),
                mime: "application/pdf",
                sourceFeatureId: "organize",
                sourceLabel: "Organize"
              }
            ],
            "organize",
            "Organize"
          );
          toast("Organized PDF ready", "success");
        } catch (e) {
          toast(`Save failed: ${e instanceof Error ? e.message : e}`, "error");
        } finally {
          saveBtn.disabled = false;
          ctx.busy.done();
        }
      });

      void api.renderGrid();
      return api;
    };

    const renderSections = () => {
      sectionsHost.replaceChildren();
      const list = pdfs();
      organizeAllBtn.disabled = list.length < 2;
      if (!list.length) {
        sectionsHost.appendChild(
          el("div", { class: "file-empty" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["grid_view"]),
            "Add one or more PDFs — drag pages to reorder and delete selected ones."
          ])
        );
        return;
      }
      list.forEach((pdf, i) => buildOrganizeSection(pdf, i));
    };

    organizeAllBtn.addEventListener("click", async () => {
      const list = pdfs();
      if (list.length < 2) return toast("Add 2+ PDFs to organize all", "error");
      organizeAllBtn.disabled = true;
      ctx.busy.spin("Organizing all files…");
      try {
        const out: Array<{ name: string; blob: Blob; mime: string; sourceFeatureId?: string; sourceLabel?: string }> = [];
        for (let i = 0; i < list.length; i++) {
          const pdf = list[i];
          ctx.busy.progress(i / list.length, `File ${i + 1}/${list.length}`);
          const data = await extractPages(pdf.data, pdf.order.map((p) => p - 1));
          out.push({
            name: pdf.file.name.replace(/\.pdf$/i, "-organized.pdf"),
            blob: blobFromBytes(data, "application/pdf"),
            mime: "application/pdf",
            sourceFeatureId: "organize",
            sourceLabel: "Organize"
          });
        }
        ctx.showResult(out, "organize", "Organize");
        toast(`Organized ${out.length} file(s)`, "success");
      } catch (e) {
        toast(`Failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        organizeAllBtn.disabled = pdfs().length < 2;
        ctx.busy.done();
      }
    });

    onEntriesChange(renderSections);
    renderSections();
    host.append(
      el("p", { class: "tool-desc" }, [
        "Dry-run before saving: drag to reorder, select & delete, Undo/Redo anytime."
      ]),
      dropzoneEl(ctx, "PDF files — organize applies per file"),
      fileListEl(),
      sectionsHost,
      el("div", { class: "row" }, [organizeAllBtn])
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
    if (featureId) {
      shell.activate(featureId);
      const incoming = takeHandoff("pdf-organizer");
      if (incoming.length) {
        void addFiles(incoming, { busy: noopBusy() });
        toast(`${incoming.length} file(s) handed off — switch to a feature to use them`, "success");
      }
    }
  });

  const incoming = takeHandoff("pdf-organizer");
  if (incoming.length) {
    void addFiles(incoming, { busy: noopBusy() });
    toast(`${incoming.length} file(s) handed off — switch to a feature to use them`, "success");
  }
};