import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { downloadBytes, formatBytes } from "../../lib/files";
import { mergePdfs, splitPdfByRanges, validatePdf } from "../../lib/pdf-core";

interface Entry {
  file: File;
  data: Uint8Array;
  pages: number;
}

const entries: Entry[] = [];

export const mount = (root: HTMLElement): void => {
  clear(root);

  const list = el("ul", { class: "file-list" });
  const status = el("span", { class: "muted" });
  const rangeInput = el("input", {
    type: "text",
    class: "input",
    placeholder: "e.g. 1-3,5,8",
    value: "1-100"
  });

  const zebra = () => {
    const count = entries.length;
    status.textContent = count ? `${count} file(s) Â· ${formatBytes(entries.reduce((s, e) => s + e.file.size, 0))}` : "";
    list.replaceChildren(
      ...entries.map((e, i) =>
        el("li", { class: "file-row" }, [
          el("span", { class: "file-row__name" }, [e.file.name]),
          el("span", { class: "muted" }, [`${e.pages} pg ${formatBytes(e.file.size)}`]),
          el("button", { class: "btn btn--ghost btn--sm", "data-remove": String(i) }, ["x"])
        ])
      )
    );
  };

  list.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (btn) {
      entries.splice(Number(btn.dataset.remove), 1);
      zebra();
    }
  });

  const addFiles = async (files: File[]) => {
    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        toast(`Skipped (not PDF): ${f.name}`, "error");
        continue;
      }
      const buf = new Uint8Array(await readFileAsArrayBuffer(f));
      if (!(await validatePdf(buf))) {
        toast(`Invalid PDF: ${f.name}`, "error");
        continue;
      }
      const { PDFDocument } = await import("pdf-lib");
      entries.push({ file: f, data: buf, pages: (await PDFDocument.load(buf)).getPageCount() });
    }
    zebra();
  };

  const runMerge = async () => {
    if (!entries.length) return toast("Add at least one PDF", "error");
    const btn = root.querySelector<HTMLButtonElement>("#do-merge")!;
    btn.disabled = true;
    try {
      const out = await mergePdfs(entries.map((e) => e.data));
      const name = entries.length === 1 ? entries[0].file.name.replace(/\.pdf$/i, "") : "merged";
      downloadBytes(out, `${name}-merged.pdf`);
      toast("Merge ready", "success");
    } catch (e) {
      toast(`Merge failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      btn.disabled = false;
    }
  };

  const runSplit = async () => {
    if (entries.length !== 1) return toast("Split needs exactly one PDF", "error");
    const btn = root.querySelector<HTMLButtonElement>("#do-split")!;
    btn.disabled = true;
    try {
      const parts = await splitPdfByRanges(entries[0].data, rangeInput.value);
      parts.forEach((p, i) => {
        downloadBytes(p, `${entries[0].file.name.replace(/\.pdf$/i, "")}-part-${i + 1}.pdf`);
      });
      toast(`${parts.length} file(s) saved`, "success");
    } catch (e) {
      toast(`Split failed: ${e instanceof Error ? e.message : e}`, "error");
    } finally {
      btn.disabled = false;
    }
  };

  root.append(
    el("h2", { class: "tool-title" }, ["Merge & Split PDF"]),
    el("p", { class: "tool-desc" }, [
      "Combine multiple PDFs into one, or split a document by page range. Works fully in your browser."
    ]),
    dropzone({
      label: "Add PDF files",
      hint: "drag & drop or browse â€” can be mixed types later",
      multiple: true,
      accept: ".pdf,application/pdf",
      onFiles: (files) => void addFiles(files)
    }),
    list,
    status,
    el("div", { class: "row gap" }, [
      el("button", { class: "btn btn--primary", id: "do-merge" }, ["Merge into one PDF"]),
      el("span", { class: "muted" }, ["Split by range"]),
      rangeInput
    ]),
    el("div", { class: "row gap" }, [
      el("button", { class: "btn", id: "do-split" }, ["Split each range into separate PDF"]),
      el("button", { class: "btn btn--ghost", id: "do-toimage" }, ["Extract pages â€¦ (coming soon)"])
    ])
  );
  const toImage = root.querySelector<HTMLButtonElement>("#do-toimage")!;
  toImage.addEventListener("click", () => toast("Page â†’ image extraction is on the roadmap (M3).", "info"));

  root.querySelector<HTMLButtonElement>("#do-merge")!.addEventListener("click", () => void runMerge());
  root.querySelector<HTMLButtonElement>("#do-split")!.addEventListener("click", () => void runSplit());
  zebra();
};
