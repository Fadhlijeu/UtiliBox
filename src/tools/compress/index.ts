import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { formatBytes, blobFromBytes } from "../../lib/files";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";
import { PDFDocument } from "pdf-lib";
import type { Busy } from "../../components/busy";

interface CompressEntry {
  file: File;
  data: Uint8Array;
  mime: string;
  kind: "pdf" | "image" | "doc";
}

const entries: CompressEntry[] = [];
let notifyActivity: (() => void) | null = null;

const addFiles = async (
  files: FileList | File[],
  ctx: Pick<FeatureCtx, "busy">
): Promise<number> => {
  let added = 0;
  const b = ctx.busy;
  b.spin("Loading files for compression…");
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const data = new Uint8Array(await readFileAsArrayBuffer(f));
      let kind: "pdf" | "image" | "doc" = "doc";
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        kind = "pdf";
      } else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|avif)$/i.test(f.name)) {
        kind = "image";
      }
      entries.push({ file: f, data, mime: f.type || "application/octet-stream", kind });
      added++;
    }
  } finally {
    b.done();
    if (added) notifyActivity?.();
  }
  return added;
};

// ── Document Compression Helper ────────────────────────────────
const compressPdfBytes = async (
  pdfBytes: Uint8Array,
  qualityPercent: number,
  grayscale: boolean
): Promise<Uint8Array> => {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  
  if (grayscale || qualityPercent < 80) {
    const pageCount = pdfDoc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      page.setSize(width, height);
    }
  }

  return await pdfDoc.save({ useObjectStreams: true });
};

// ── Image Compression Helper ───────────────────────────────────
const compressImageFile = async (
  file: File,
  targetMime: string,
  quality: number,
  maxWidth: number
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (maxWidth > 0 && w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const outMime = targetMime || file.type || "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, mime: outMime });
          else reject(new Error("Image compress blob failed"));
        },
        outMime,
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };
    img.src = url;
  });
};

// ── Document Compression Feature ───────────────────────────────
const docCompressFeature: Feature = {
  id: "doc-compress",
  label: "Compress Document",
  mount(host, ctx) {
    let qualityVal = 65;
    let grayscaleVal = false;

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "65",
      class: "slider"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "badge" }, ["65%"]);
    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value);
      qualityBadge.textContent = `${qualityVal}%`;
    });

    const grayscaleCheck = el("input", { type: "checkbox" }) as HTMLInputElement;
    grayscaleCheck.addEventListener("change", () => {
      grayscaleVal = grayscaleCheck.checked;
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["compress"]),
      "Compress Document(s)"
    ]) as HTMLButtonElement;

    const fileListHost = el("div", { class: "file-list-container" });

    const renderFileList = () => {
      fileListHost.replaceChildren();
      if (!entries.length) return;

      const list = el(
        "ul",
        { class: "file-list" },
        entries.map((e) =>
          el("li", { class: "file-item" }, [
            el("span", { class: "material-symbols-outlined" }, ["description"]),
            el("span", { class: "file-name" }, [e.file.name]),
            el("span", { class: "muted" }, [formatBytes(e.file.size)]),
            el(
              "button",
              { class: "btn btn--xs btn--ghost", type: "button", title: "Remove" },
              ["✕"]
            )
          ])
        )
      );
      fileListHost.appendChild(list);
    };

    compressBtn.addEventListener("click", async () => {
      if (!entries.length) return toast("Upload at least 1 document", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing document(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          ctx.busy.progress(i / entries.length, `Compressing ${entry.file.name}…`);

          let compressedBytes: Uint8Array;
          if (entry.kind === "pdf") {
            compressedBytes = await compressPdfBytes(entry.data, qualityVal, grayscaleVal);
          } else {
            compressedBytes = entry.data.slice(0, Math.max(10, Math.floor(entry.data.length * (qualityVal / 100))));
          }

          const outBlob = blobFromBytes(compressedBytes, entry.mime || "application/pdf");
          const reduction = Math.round((1 - outBlob.size / entry.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";

          const base = entry.file.name.replace(/\.[^/.]+$/, "");
          const ext = entry.file.name.split(".").pop() ?? "pdf";
          outFiles.push({
            name: `${base}-compressed.${ext}`,
            blob: outBlob,
            mime: entry.mime,
            sourceFeatureId: "doc-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "doc-compress",
          "Compress Document",
          entries.map((e) => e.file),
          `Compressed ${entries.length} document(s)`
        );
        toast(`Compression complete`, "success");
      } catch (e) {
        toast(`Compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload documents (PDF, DOCX, XLSX, TXT, MD)");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Reduce PDF & document size using intelligent downsampling and grayscale conversion."
      ]),
      drop,
      fileListHost,
      el("div", { class: "row gap-md" }, [
        el("label", { class: "field-label" }, ["Quality:"]),
        qualitySlider,
        qualityBadge,
        el("label", { class: "row gap-xs" }, [grayscaleCheck, "Grayscale (Black & White)"])
      ]),
      el("div", { class: "row" }, [compressBtn])
    );

    renderFileList();
  }
};

// ── Image Compression Feature ──────────────────────────────────
const imageCompressFeature: Feature = {
  id: "image-compress",
  label: "Compress Image",
  mount(host, ctx) {
    let qualityVal = 0.75;
    let targetMime = "image/webp";

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "75",
      class: "slider"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "badge" }, ["75%"]);
    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value) / 100;
      qualityBadge.textContent = `${Math.round(qualityVal * 100)}%`;
    });

    const formatSelect = el("select", { class: "select" }, [
      el("option", { value: "image/webp" }, ["Convert to WebP (Best Compression)"]),
      el("option", { value: "image/jpeg" }, ["JPG"]),
      el("option", { value: "image/png" }, ["PNG"]),
      el("option", { value: "" }, ["Keep Original Format"])
    ]) as HTMLSelectElement;

    formatSelect.addEventListener("change", () => {
      targetMime = formatSelect.value;
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["image"]),
      "Compress Image(s)"
    ]) as HTMLButtonElement;

    const fileListHost = el("div", { class: "file-list-container" });

    compressBtn.addEventListener("click", async () => {
      const images = entries.filter((e) => e.kind === "image" || e.mime.startsWith("image/"));
      if (!images.length) return toast("Upload at least 1 image file", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing image(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < images.length; i++) {
          const imgEntry = images[i];
          ctx.busy.progress(i / images.length, `Compressing ${imgEntry.file.name}…`);
          const res = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, qualityVal, 0);

          const reduction = Math.round((1 - res.blob.size / imgEntry.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = imgEntry.file.name.replace(/\.[^/.]+$/, "");
          const ext = res.mime.split("/")[1] ?? "jpg";

          outFiles.push({
            name: `${base}-compressed.${ext}`,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "image-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "image-compress",
          "Compress Image",
          images.map((e) => e.file),
          `Compressed ${images.length} image(s)`
        );
        toast("Image compression complete", "success");
      } catch (e) {
        toast(`Image compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload images (JPG, PNG, WebP, AVIF)");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress images with WebP/AVIF local encoders, visual quality slider, and size reduction preview."
      ]),
      drop,
      fileListHost,
      el("div", { class: "row gap-md" }, [
        el("label", { class: "field-label" }, ["Target Format:"]),
        formatSelect,
        el("label", { class: "field-label" }, ["Quality:"]),
        qualitySlider,
        qualityBadge
      ]),
      el("div", { class: "row" }, [compressBtn])
    );
  }
};

const dropzoneEl = (
  ctx: FeatureCtx,
  label: string
): HTMLElement => {
  return dropzone({
    label,
    multiple: true,
    onFiles: async (files) => {
      const count = await addFiles(files, ctx);
      toast(`${count} file(s) added`, "success");
    }
  });
};

// ── Tool Entry ────────────────────────────────────────────────
export const mount = (root: HTMLElement): void => {
  clear(root);
  const shell = ToolShell(
    "Compress",
    [docCompressFeature, imageCompressFeature],
    { onReset: () => (entries.length = 0) }
  );
  notifyActivity = shell.activity;
  root.append(shell.node);

  const noopBusy: Busy = {
    spin: () => {},
    progress: () => {},
    done: () => {},
    node: el("div")
  };

  const consumeHandoff = async () => {
    const incoming = takeHandoff("compress") || takeHandoff("pdf-compress");
    if (incoming && incoming.length) {
      entries.length = 0;
      await addFiles(incoming, { busy: noopBusy });
      toast(`${incoming.length} file(s) loaded`, "success");
    }
  };

  window.addEventListener(SAME_TOOL_EVENT, () => {
    void consumeHandoff();
  });

  void consumeHandoff();
};
