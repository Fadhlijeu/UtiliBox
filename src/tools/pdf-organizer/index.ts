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
  order: number[]; // 1-based page order (shared reorder state)
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

// ── shared list / grid helpers ────────────────────────────
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

// ── drag & drop + live DOM reorder (NO re-render on move) ───

interface GridState {
  from: number;
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

const bindDnd = (
  cell: HTMLElement,
  grid: HTMLElement,
  state: { from: number },
  onDrop: (to: number) => void
): void => {
  cell.addEventListener("dragstart", () => {
    state.from = liveIndex(grid, cell);
    cell.classList.add("page-cell--dragging");
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("page-cell--dragging");
    grid
      .querySelectorAll(".page-cell--drop")
      .forEach((c) => c.classList.remove("page-cell--drop"));
    state.from = -1;
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
    state.from = -1;
    onDrop(liveIndex(grid, cell));
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
    const state = { from: -1 };
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
      grid.replaceChildren(...items.map((it) => cellByItem.get(it)).filter((c): c is HTMLElement => !!c));
      refreshPositions(grid);
    };

    const applyMove = (cell: HTMLElement, to: number) => {
      const from = reorderDom(grid, cell, to);
      if (from < 0) return;
      const before = cloneItems();
      const copy = [...items];
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      items = copy;
      const after = cloneItems();
      ctx.pushHistory({
        label: "reordered pages",
        undo: () => {
          items = before;
          relayoutFromCache();
        },
        redo: () => {
          items = after;
          relayoutFromCache();
        }
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
          const cell = el("button", { class: "page-cell page-cell--merge", type: "button" }, [
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
          cell.addEventListener("click", () => void 0);
          bindDnd(cell, grid, state, (to) => applyMove(cell, to));
          moveButtons(cell, (delta) => {
            const to = liveIndex(grid, cell) + delta;
            applyMove(cell, to);
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

// ── shared per-file preview section (Split & Organize) ─────────

interface PdfSectionApi {
  grid: HTMLElement;
  selected: Set<number>; // page numbers (1-based)
  renderGrid: () => Promise<void>;
  relayoutFromOrder: () => void;
  clearSelection: () => void;
}

interface SectionOpts {
  hint: string;
  rows: Node[]; // extra rows below the grid (actions / selection bar)
  onSelectionChange?: () => void;
  onOrderChange?: () => void;
}

const buildPdfSection = (
  pdf: Entry,
  fileIdx: number,
  opts: SectionOpts,
  ctx: Pick<FeatureCtx, "pushHistory" | "busy">
): PdfSectionApi => {
  const grid = el("div", { class: "page-grid" });
  const cellByPage = new Map<number, HTMLElement>();
  const selected = new Set<number>();
  const state = { from: -1 };

  const syncSelectionClasses = () => {
    grid.querySelectorAll<HTMLElement>(".page-cell").forEach((c) => {
      const p = Number(c.dataset.page);
      c.classList.toggle("page-cell--selected", selected.has(p));
    });
  };

  const relayoutFromOrder = () => {
    grid.replaceChildren(
      ...pdf.order.map((p) => cellByPage.get(p)).filter((c): c is HTMLElement => !!c)
    );
    refreshPositions(grid);
    syncSelectionClasses();
  };

  const applyOrderMove = (cell: HTMLElement, to: number) => {
    const kids = Array.from(grid.children);
    const from = kids.indexOf(cell);
    if (from < 0 || to < 0 || to >= kids.length || from === to) return;
    const before = [...pdf.order];
    const copy = [...before];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    pdf.order = copy;
    const after = [...pdf.order];
    grid.insertBefore(cell, grid.children[to < from ? to : to + 1]);
    refreshPositions(grid);
    opts.onOrderChange?.();
    ctx.pushHistory({
      label: "reordered pages",
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
  };

  const renderGrid = async () => {
    grid.replaceChildren();
    if (!pdf.pages) return;
    ctx.busy.spin(`Rendering pages (${pdf.file.name})…`);
    try {
      cellByPage.clear();
      await pdfPageThumbs(pdf.data, (canvas, pageNum) => {
        const cell = el("button", { class: "page-cell", type: "button" }, [canvas]);
        cell.dataset.page = String(pageNum);
        cell.appendChild(el("span", { class: "page-cell__no" }, ["1"]));
        cell.appendChild(
          el("span", { class: "page-cell__check" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["check"])
          ])
        );
        cell.addEventListener("click", () => {
          if (state.from >= 0) return;
          if (selected.has(pageNum)) selected.delete(pageNum);
          else selected.add(pageNum);
          cell.classList.toggle("page-cell--selected", selected.has(pageNum));
          opts.onSelectionChange?.();
        });
        bindDnd(cell, grid, state, (to) => applyOrderMove(cell, to));
        moveButtons(cell, (delta) => {
          const kids = Array.from(grid.children);
          applyOrderMove(cell, kids.indexOf(cell) + delta);
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
    grid,
    ...opts.rows
  ]);

  const api: PdfSectionApi = {
    grid,
    selected,
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
  ctx: Pick<FeatureCtx, "pushHistory" | "busy">,
  opts: {
    rangeInput: HTMLInputElement;
    splitBtn: HTMLButtonElement;
    onSplit: () => Promise<void>;
  }
): void => {
  const syncFromSelection = () => {
    const pos = [...opts.rangeInputSelection]
      .map((p) => pdf.order.indexOf(p) + 1)
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    opts.rangeInput.value = pos.length ? pos.join(", ") : `1-${pdf.pages}`;
  };
  const { clearSelection } = buildPdfSection(
    pdf,
    fileIdx,
    {
      hint: "Drag pages to reorder (ranges follow the shown order) · click pages to pick ranges",
      rows: [
        el("div", { class: "row" }, [
          el("span", { class: "muted" }, ["Split by"]),
          opts.rangeInput,
          opts.splitBtn
        ])
      ],
      onSelectionChange: syncFromSelection,
      onOrderChange: syncFromSelection
    },
    ctx
  );
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
          mime: "application/pdf"
        }))
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
        const { section, api } = buildSplitSection(pdf, fileIdx, sectionsHost, ctx, {
          rangeInput,
          splitBtn,
          ...
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
        const out: Array<{ name: string; blob: Blob; mime: string }> = [];
        for (let i = 0; i < list.length; i++) {
          const pdf = list[i];
          ctx.busy.progress(i / list.length, `File ${i + 1}/${list.length}`);
          const ranges = rangeByMdf.get(pdf) ?? `1-${pdf.pages}`;
          const parts = await splitPdfByOrderRanges(pdf.data, pdf.order, ranges);
          const base = pdf.file.name.replace(/\.pdf$/i, "");
          parts.forEach((p, j) =>
            out.push({
              name: parts.length > 1 ? `${base}-part-${j + 1}.pdf` : `${base}.pdf`,
              blob: blobFromBytes(p, "application/pdf"),
              mime: "application/pdf"
            })
          );
        }
        ctx.showResult(out);
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
      el("div", { class: "row" }, [splitAllBtn]),
      sectionsHost
    );
  }
};