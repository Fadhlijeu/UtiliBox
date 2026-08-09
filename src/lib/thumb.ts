// File preview thumbnails â€” every file tool gets a visual thumb.
// Images â†’ objectURL img. PDFs â†’ first page via pdfjs canvas. Else generic icon.

import { el } from "./dom";
import { readFileAsArrayBuffer } from "./dom";

export interface Thumb {
  node: HTMLElement;
  dispose: () => void;
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

const getPdfJs = (): Promise<typeof import("pdfjs-dist")> => {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return mod;
    });
  }
  return pdfjsPromise;
};

export const fileThumb = async (file: File): Promise<Thumb> => {
  // images
  if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
    const url = URL.createObjectURL(file);
    const img = el("img", { class: "thumb-img", alt: file.name }) as HTMLImageElement;
    img.src = url;
    return { node: img, dispose: () => URL.revokeObjectURL(url) };
  }
  // PDFs
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    try {
      const bytes = new Uint8Array(await readFileAsArrayBuffer(file));
      const pdfjs = await getPdfJs();
      // pdfjs TRANSFERS (detaches) the input buffer — MUST hand it a real copy
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      const page = await doc.getPage(1);
      const original = page.getViewport({ scale: 1 });
      const scale = 180 / original.width;
      const viewport = page.getViewport({ scale: scale > 2 ? 2 : scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "thumb-canvas";
      await page.render({ canvas, viewport }).promise;
      void doc.loadingTask.destroy();
      return { node: canvas, dispose: () => void 0 };
    } catch {
      return genericThumb("picture_as_pdf");
    }
  }
  // everything else
  const icon = file.type.startsWith("audio/")
    ? "music_note"
    : file.type.startsWith("video/")
      ? "movie"
      : file.type.startsWith("text/") || /\.(txt|md|json|log)$/i.test(file.name)
        ? "description"
        : "attachment";
  return genericThumb(icon);
};

export const genericThumb = (icon: string): Thumb => ({
  node: el("div", { class: "thumb-generic" }, [
    el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, [icon])
  ]),
  dispose: () => void 0
});

/** Render every page of a PDF into <canvas> thumbs, scaled to ~200px width. */
export const pdfPageThumbs = async (
  bytes: Uint8Array,
  onPage: (canvas: HTMLCanvasElement, index: number) => void
): Promise<void> => {
  const pdfjs = await getPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const maxW = 200;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const scale = Math.min(maxW / vp.width, 2);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = "page-thumb";
    await page.render({ canvas, viewport }).promise;
    onPage(canvas, i);
  }
  void doc.loadingTask.destroy();
};
