import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { fileThumb, pdfPageThumbs } from "../../lib/thumb";
import { formatBytes, blobFromBytes } from "../../lib/files";
import { mergePdfs, splitPdfByRanges, extractPages, validatePdf, imageToPdf } from "../../lib/pdf-core";
import { takeHandoff } from "../../lib/handoff";

type Kind = "pdf" | "image";

interface Entry {
  file: File;
  data: Uint8Array;
  pages: number;
  kind: Kind;
  dispose?: () => void;
}

const entries: Entry[] = [];
const listeners: Array<() => void> = [];

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

// ── shared entry helpers ─────────────────────────────
const addFiles = async (files: File[], ctx: Pick<FeatureCtx, "busy">): Promise<void> => {
  const b = ctx.busy;
  b.spin("Reading files…");
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      b.progress(i / files.length, `Reading ${i + 1}/${files.length}`);
      const kind = sniffKind(f);
      if (kind === "image") {
        entries.push({ file: f, data: new Uint8Array(await readFileAsArrayBuffer(f)), pages: 1, kind });
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
      entries.push({ file: f, data, pages: (await PDFDocument.load(data)).getPageCount(), kind });
    }
  } finally {
    b.done();
    emitChange();
  }
};

const removeEntry = (i: number): void => {
  entries[i].dispose?.();
  entries.splice(i, 1);
  emitChange();
};

const pdfEntry = (): Entry | undefined => entries.find((e) => e.kind === "pdf");
const pdfCount = (): number => entries.filter((e) => e.kind === "pdf").length;
const totalSize = (): number => entries.reduce((s, e) => s + e.file.size, 0);

const fileListEl = (): HTMLElement => {
  const list = el("ul", { class: "file-list" });
  const render = () => {
    list.replaceChildren(
      ...entries.map((e, i) => {
        const row = el("li", { class: "file-row" }, [
          el("span", { class: "file-row__thumb" }, ["…"]),
          el("span", { class: "file-row__name" }, [e.file.name]),
          el("span", { class: "muted" }, [
            `${e.kind === "image" ? "img → pdf" : `${e.pages} pg`} · ${formatBytes(e.file.size)}`
          ]),
          el("button", { class: "btn btn--ghost btn--sm", "data-remove": String(i) }, ["x"])
        ]);
        const slot = row.querySelector<HTMLElement>(".file-row__thumb")!;
        void fileThumb(e.file).then((t) => {
          e.dispose = t.dispose;
          slot.replaceChildren(t.node);
        });
        return row;
      })
    );
    if (!entries.length) {
      list.appendChild(
        el("p", { class: "muted" }, ["No files yet — drop files below."])
      );
    }
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
      status.textContent = n
        ? `${n} file(s) · ${formatBytes(totalSize())}`
        : "No files yet — merge needs 2+";
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
            name: `${entries.length === 1 ? entries[0].file.name.replace(/\.(pdf|png|jpe?g)$/i, "") : "merged"}.pdf`,
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
      dropzoneEl(ctx, "2+ files needed — PDF, PNG, JPG"),
      fileListEl(),
      status,
      el("div", { class: "row gap" }, [mergeBtn])
    );
  }
};

const splitFeature: Feature = {
  id: "split",
  label: "Split",
  mount(host, ctx) {
    const rangeInput = el("input", { type: "text", class: "input", placeholder: "e.g. 1-3,5,8" });
    const splitBtn = el("button", { class: "btn", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["content_cut"]),
      "Split PDF"
    ]);
    const pdf = pdfEntry();
    if (pdf) rangeInput.value = `1-${pdf.pages}`;

    const sync = () => {
      const one = pdfCount() === 1;
      splitBtn.disabled = !one;
    };

    splitBtn.addEventListener("click", async () => {
      const pdf = pdfEntry();
      if (!pdf) return toast("Split needs exactly one PDF", "error");
      splitBtn.disabled = true;
      ctx.busy.spin("Splitting…");
      try {
        const parts = await splitPdfByRanges(pdf.data, rangeInput.value);
        const base = pdf.file.name.replace(/\.pdf$/i, "");
        ctx.showResult(
          parts.map((p, i) => ({
            name: `${base}-part-${i + 1}.pdf`,
            blob: blobFromBytes(p, "application/pdf"),
            mime: "application/pdf"
          }))
        );
        toast(`${parts.length} part(s) ready`, "success");
      } catch (e) {
        toast(`Split failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        sync();
        ctx.busy.done();
      }
    });

    onEntriesChange(sync);
    sync();
    host.append(
      el("p", { class: "tool-desc" }, ["Split one PDF by ranges, e.g. “1-3,5,8-9”."]),
      dropzoneEl(ctx, "exactly 1 PDF"),
      fileListEl(),
      el("div", { class: "row gap" }, [el("span", { class: "muted" }, ["Split by"]), rangeInput, splitBtn])
    );
  }
};

const organizeFeature: Feature = {
  id: "organize",
  label: "Organize",
  mount(host, ctx) {
    const gridWrap = el("div", { class: "page-grid" });
    const selected = new Set<number>();
    const deleteBtn = el("button", { class: "btn btn--danger", type: "button", disabled: "" }, [
      "Delete selected pages"
    ]);
    const saveBtn = el("button", { class: "btn btn--primary", type: "button", disabled: "" }, [
      "Save organized PDF"
    ]);

    const renderGrid = async () => {
      selected.clear();
      deleteBtn.disabled = true;
      const pdf = pdfEntry();
      if (!pdf) {
        gridWrap.replaceChildren(
          el("div", { class: "page-grid__placeholder" }, [
            el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["preview"]),
            el("p", {}, ["Add exactly one PDF to organize its pages."])
          ])
        );
        saveBtn.disabled = true;
        return;
      }
      saveBtn.disabled = false;
      ctx.busy.spin("Rendering page thumbnails…");
      try {
        gridWrap.replaceChildren();
        await pdfPageThumbs(pdf.data, (canvas, index) => {
          const box = el("button", { class: "page-cell", type: "button", "data-page": String(index) }, [canvas]);
          box.appendChild(el("span", { class: "page-cell__no" }, [String(index)]));
          box.addEventListener("click", () => {
            if (selected.has(index)) selected.delete(index);
            else selected.add(index);
            box.classList.toggle("page-cell--selected", selected.has(index));
            deleteBtn.disabled = selected.size === 0;
          });
          gridWrap.appendChild(box);
        });
      } catch {
        gridWrap.replaceChildren(el("p", { class: "muted" }, ["Failed to render page previews."]));
      } finally {
        ctx.busy.done();
      }
    };

    deleteBtn.addEventListener("click", async () => {
      const pdf = pdfEntry();
      if (!pdf || !selected.size) return;
      const deleted = [...selected].sort((a, b) => a - b);
      const keep = Array.from({ length: pdf.pages }, (_, i) => i + 1).filter((p) => !selected.has(p));
      if (!keep.length) return toast("Cannot delete every page", "error");

      const before: { data: Uint8Array; pages: number } = { data: pdf.data, pages: pdf.pages };
      const after: { data: Uint8Array; pages: number } = {
        data: await extractPages(pdf.data, keep.map((p) => p - 1)),
        pages: keep.length
      };
      ctx.busy.spin("Deleting pages…");
      try {
        pdf.data = after.data;
        pdf.pages = after.pages;
        ctx.pushHistory({
          label: `deleted ${deleted.length} page(s)`,
          undo: () => {
            pdf.data = before.data;
            pdf.pages = before.pages;
            void renderGrid();
          },
          redo: () => {
            pdf.data = after.data;
            pdf.pages = after.pages;
            void renderGrid();
          }
        });
        toast(`Deleted ${deleted.length} page(s) — undo available`, "success");
      } finally {
        ctx.busy.done();
        void renderGrid();
      }
    });

    saveBtn.addEventListener("click", () => {
      const pdf = pdfEntry();
      if (!pdf) return toast("No PDF to save", "error");
      ctx.showResult([
        {
          name: pdf.file.name.replace(/\.pdf$/i, "-organized.pdf"),
          blob: blobFromBytes(pdf.data, "application/pdf"),
          mime: "application/pdf"
        }
      ]);
    });

    onEntriesChange(() => void renderGrid());
    host.append(
      el("p", { class: "tool-desc" }, [
        "Click pages to select, delete them (Undo/Redo in top bar), then Save the result."
      ]),
      dropzoneEl(ctx, "exactly 1 PDF"),
      fileListEl(),
      gridWrap,
      el("div", { class: "row gap" }, [deleteBtn, saveBtn])
    );
    void renderGrid();
  }
};

// ── Tool entry ────────────────────────────────────────

export const mount = (root: HTMLElement): void => {
  clear(root);
  const shell = ToolShell(
    "Merge & Split",
    [mergeFeature, splitFeature, organizeFeature],
    {
      onReset: () => {
        entries.forEach((e) => e.dispose?.());
        entries.length = 0;
      }
    }
  );
  root.append(shell.node);

  // handoff intake (oper file dari tool lain) — langsung masuk ke daftar file
  const incoming = takeHandoff("pdf-organizer");
  if (incoming.length) {
    void addFiles(incoming, { busy: noopBusy() });
    toast(`${incoming.length} file(s) handed off from another tool`, "success");
  }
};