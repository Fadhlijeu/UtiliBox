import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { busy } from "../../components/busy";
import { outputPanel } from "../../components/output-panel";
import { blobFromBytes, formatBytes } from "../../lib/files";
import { fileThumb, pdfPageThumbs } from "../../lib/thumb";
import { mergePdfs, splitPdfByRanges, extractPages, validatePdf, imageToPdf } from "../../lib/pdf-core";

type Kind = "pdf" | "image";

interface Entry {
  file: File;
  data: Uint8Array;
  pages: number;
  kind: Kind;
  dispose?: () => void;
}

const entries: Entry[] = [];

const isImage = (f: File): boolean => /\.(png|jpe?g)$/i.test(f.name);
const pdfLib = (): Promise<typeof import("pdf-lib")> => import("pdf-lib");
const sniffKind = (f: File): Kind => (isImage(f) ? "image" : "pdf");

export const mount = (root: HTMLElement): void => {
  clear(root);

  const list = el("ul", { class: "file-list" });
  const status = el("span", { class: "muted" });
  const rangeInput = el("input", { type: "text", class: "input", placeholder: "e.g. 1-3,5,8" });
  const progress = busy();
  const out = outputPanel();

  // ── page grid (single PDF view) ──────────────────
  const gridWrap = el("div", { class: "page-grid" });
  const selected = new Set<number>();

  const refreshGrid = async () => {
    selected.clear();
    const pdfEntry = entries.find((e) => e.kind === "pdf");
    if (!pdfEntry) {
      gridWrap.replaceChildren(
        el("div", { class: "page-grid__placeholder" }, [
          el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["preview"]),
          el("p", {}, ["Add a single PDF to see page thumbnails, delete pages & split."])
        ])
      );
      return;
    }
    gridWrap.replaceChildren();
    rangeInput.value = `1-${pdfEntry.pages}`;
    progress.spin("Rendering page thumbnails…");
    try {
      await pdfPageThumbs(pdfEntry.data, (canvas, index) => {
        const box = el("button", { class: "page-cell", type: "button", "data-page": String(index) }, [canvas]);
        box.appendChild(el("span", { class: "page-cell__no" }, [String(index)]));
        box.addEventListener("click", () => {
          if (selected.has(index)) selected.delete(index);
          else selected.add(index);
          box.classList.toggle("page-cell--selected", selected.has(index));
        });
        gridWrap.appendChild(box);
      });
    } catch {
      gridWrap.replaceChildren(el("p", { class: "muted" }, ["Failed to render page previews."]));
    } finally {
      progress.done();
    }
  };

  const deleteSelected = async () => {
    const pdfEntry = entries.find((e) => e.kind === "pdf");
    if (!pdfEntry || !selected.size) return;
    const keep = Array.from({ length: pdfEntry.pages }, (_, i) => i + 1).filter((p) => !selected.has(p));
    if (!keep.length) return toast("Cannot delete every page", "error");
    progress.spin("Deleting pages…");
    try {
      pdfEntry.data = await extractPages(pdfEntry.data, keep.map((p) => p - 1));
      pdfEntry.pages = keep.length;
      out.clear();
      await refreshGrid();
      zebra();
      toast(`Deleted ${selected.size} page(s)`, "success");
    } catch (err) {
      toast(`Delete failed: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      progress.done();
    }
  };

  // ── file list ────────────────────────────────────
  const zebra = () => {
    const count = entries.length;
    status.textContent = count
      ? `${count} file(s) · ${formatBytes(entries.reduce((s, e) => s + e.file.size, 0))}`
      : "No files yet";
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
    void refreshGrid();
  };

  list.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (!btn) return;
    const i = Number(btn.dataset.remove);
    entries[i].dispose?.();
    entries.splice(i, 1);
    zebra();
  });

  // ── add files ────────────────────────────────────
  const addFiles = async (files: File[]) => {
    progress.spin("Reading files…");
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress.progress(i / files.length, `Reading ${i + 1}/${files.length}`);
        const kind = sniffKind(f);
        if (kind === "image") {
          entries.push({ file: f, data: new Uint8Array(await readFileAsArrayBuffer(f)), pages: 1, kind });
          continue;
        }
        if (!f.name.toLowerCase().endsWith(".pdf")) {
          toast(`Skipped (not PDF/image): ${f.name}`, "error");
          continue;
        }
        const data = new Uint8Array(await readFileAsArrayBuffer(f));
        if (!(await validatePdf(data))) {
          toast(`Invalid PDF: ${f.name}`, "error");
          continue;
        }
        const { PDFDocument } = await pdfLib();
        entries.push({ file: f, data, pages: (await PDFDocument.load(data)).getPageCount(), kind });
      }
    } finally {
      progress.done();
      zebra();
    }
  };

  // ── actions ──────────────────────────────────────
  const runMerge = async () => {
    if (!entries.length) return toast("Add at least one file", "error");
    const btn = root.querySelector<HTMLButtonElement>("#do-merge")!;
    btn.disabled = true;
    progress.spin("Merging…");
    try {
      const parts: Uint8Array[] = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        progress.progress(i / entries.length, `Preparing ${i + 1}/${entries.length}`);
        parts.push(e.kind === "pdf" ? e.data : await imageToPdf(e.data));
      }
      progress.progress(0.95, "Assembling PDF");
      const outBytes = await mergePdfs(parts);
      const name = entries.length === 1 ? entries[0].file.name.replace(/\.(pdf|png|jpe?g)$/i, "") : "merged";
      out.show([{ name: `${name}.pdf`, blob: blobFromBytes(outBytes, "application/pdf"), mime: "application/pdf" }]);
      toast("Merge ready — preview & download below", "success");
    } catch (err) {
      toast(`Merge failed: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      btn.disabled = false;
      progress.done();
    }
  };

  const runSplit = async () => {
    const pdfEntry = entries.find((e) => e.kind === "pdf");
    if (!pdfEntry) return toast("Split needs exactly one PDF (add a single PDF)", "error");
    const btn = root.querySelector<HTMLButtonElement>("#do-split")!;
    btn.disabled = true;
    progress.spin("Splitting…");
    try {
      const parts = await splitPdfByRanges(pdfEntry.data, rangeInput.value);
      const base = pdfEntry.file.name.replace(/\.pdf$/i, "");
      out.show(
        parts.map((p, i) => ({
          name: `${base}-part-${i + 1}.pdf`,
          blob: blobFromBytes(p, "application/pdf"),
          mime: "application/pdf"
        }))
      );
      toast(`${parts.length} part(s) ready — preview & download below`, "success");
    } catch (err) {
      toast(`Split failed: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      btn.disabled = false;
      progress.done();
    }
  };

  root.append(
    el("h2", { class: "tool-title" }, ["Merge & Split"]),
    el("p", { class: "tool-desc" }, [
      "Combine PDFs & images into one document, split PDFs by range, or remove pages visually. Every step shows progress; results can be previewed before download."
    ]),
    dropzone({
      label: "Add PDFs & images",
      hint: "drop or browse — PNG/JPEG become PDF pages",
      multiple: true,
      accept: ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg",
      onFiles: (files) => void addFiles(files)
    }),
    list,
    status,
    gridWrap,
    el("div", { class: "row gap" }, [
      el("button", { class: "btn btn--danger", id: "do-delete" }, ["Delete selected pages"]),
      el("span", { class: "muted" }, ["Split by"]),
      rangeInput,
      el("button", { class: "btn", id: "do-split" }, ["Split"])
    ]),
    el("div", { class: "row gap" }, [
      el("button", { class: "btn btn--primary", id: "do-merge" }, ["Merge into one PDF"])
    ]),
    progress.node,
    out.node
  );

  root.querySelector<HTMLButtonElement>("#do-merge")!.addEventListener("click", () => void runMerge());
  root.querySelector<HTMLButtonElement>("#do-split")!.addEventListener("click", () => void runSplit());
  root.querySelector<HTMLButtonElement>("#do-delete")!.addEventListener("click", () => void deleteSelected());

  zebra();
};
