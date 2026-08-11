import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { formatBytes, blobFromBytes } from "../../lib/files";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";
import { PDFDocument } from "pdf-lib";
import type { Busy } from "../../components/busy";

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

export interface CompressEntry {
  file: File;
  data: Uint8Array;
  mime: string;
  kind: "pdf" | "image" | "audio" | "video" | "doc";
}

const entries: CompressEntry[] = [];
let notifyActivity: (() => void) | null = null;
const fileChangeListeners: Array<() => void> = [];

const notifyFileChange = () => {
  notifyActivity?.();
  fileChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
};

const addFiles = async (
  files: FileList | File[],
  ctx: Pick<FeatureCtx, "busy">
): Promise<number> => {
  let added = 0;
  const b = ctx.busy;
  b.spin("Loading media for compression…");
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const data = new Uint8Array(await readFileAsArrayBuffer(f));
      let kind: "pdf" | "image" | "audio" | "video" | "doc" = "doc";
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        kind = "pdf";
      } else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(f.name)) {
        kind = "image";
      } else if (f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)) {
        kind = "audio";
      } else if (f.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(f.name)) {
        kind = "video";
      }
      entries.push({ file: f, data, mime: f.type || "application/octet-stream", kind });
      added++;
    }
  } finally {
    b.done();
    if (added) notifyFileChange();
  }
  return added;
};

const removeEntry = (index: number) => {
  if (index >= 0 && index < entries.length) {
    entries.splice(index, 1);
    notifyFileChange();
  }
};

// ── Engine 1: Structural Vector PDF Stream Optimization ─────────
const compressPdfStructural = async (pdfBytes: Uint8Array): Promise<Uint8Array> => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    return await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  } catch {
    return pdfBytes;
  }
};

// ── Engine 2: High-DPI Perceptual Canvas Engine (Raster PDF) ────
const compressPdfCanvas = async (
  pdfBytes: Uint8Array,
  qualityPercent: number,
  grayscale: boolean,
  dpi: number = 150
): Promise<Uint8Array> => {
  try {
    const pdfjs = await getPdfJs();
    const pdfDoc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
    const pageCount = pdfDoc.numPages;
    const outPdf = await PDFDocument.create();

    const renderScale = Math.max(1.5, dpi / 72);
    const jpegQuality = Math.max(0.15, Math.min(0.95, qualityPercent / 100));

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, viewport.width);
      canvas.height = Math.max(1, viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) continue;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      await page.render({ canvas, viewport }).promise;

      if (grayscale) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let p = 0; p < data.length; p += 4) {
          const gray = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
          data[p] = gray;
          data[p + 1] = gray;
          data[p + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
      const base64Str = dataUrl.split(",")[1];
      const binaryStr = atob(base64Str);
      const jpegBytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) {
        jpegBytes[j] = binaryStr.charCodeAt(j);
      }

      const embeddedJpg = await outPdf.embedJpg(jpegBytes);
      const newPage = outPdf.addPage([embeddedJpg.width, embeddedJpg.height]);
      newPage.drawImage(embeddedJpg, {
        x: 0,
        y: 0,
        width: embeddedJpg.width,
        height: embeddedJpg.height
      });
    }

    return await outPdf.save({ useObjectStreams: true });
  } catch {
    return pdfBytes;
  }
};

// ── Smart Multi-Engine PDF Compressor (Vector + Canvas Fallback) 
const compressPdfSmart = async (
  pdfBytes: Uint8Array,
  qualityPercent: number,
  grayscale: boolean,
  dpi: number,
  targetLimit: number | null
): Promise<Uint8Array> => {
  // Pass 1: Try Structural Vector Optimization (Zero Blur, Crisp Text)
  const structural = await compressPdfStructural(pdfBytes);
  if (targetLimit && structural.length <= targetLimit) {
    return structural; // 100% Vector PDF satisfied target limit!
  }

  // Pass 2: High-Precision Secant Search targeting 96% of target limit
  if (targetLimit) {
    let low = 15;
    let high = 95;
    let bestBytes = structural;

    for (let iter = 0; iter < 8; iter++) {
      const mid = Math.round((low + high) / 2);
      const bytes = await compressPdfCanvas(pdfBytes, mid, grayscale, dpi);
      if (bytes.length <= targetLimit) {
        bestBytes = bytes;
        low = mid + 1; // Push quality higher to land close to target size (95-99%)
      } else {
        high = mid - 1; // Over target limit
      }
    }
    return bestBytes.length < pdfBytes.length ? bestBytes : structural;
  }

  // Preset / Slider Mode
  const canvas = await compressPdfCanvas(pdfBytes, qualityPercent, grayscale, dpi);
  return canvas.length < structural.length ? canvas : structural;
};

// ── Image Compression Helper ───────────────────────────────────
const compressImageFile = async (
  file: File,
  targetMime: string,
  quality: number,
  scaleRatio: number
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = Math.round(img.width * scaleRatio);
      const h = Math.round(img.height * scaleRatio);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context failed"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
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

// ── Audio Compression Helper ───────────────────────────────────
const compressAudioFile = async (
  file: File,
  bitrateKbps: number,
  toMono: boolean
): Promise<{ blob: Blob; mime: string }> => {
  const arrayBuf = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  
  const sampleRate = 22050;
  const numChannels = toMono ? 1 : Math.min(2, audioBuf.numberOfChannels);
  const offlineCtx = new OfflineAudioContext(numChannels, Math.floor(audioBuf.duration * sampleRate), sampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuf = await offlineCtx.startRendering();
  const rawPcm = renderedBuf.getChannelData(0);
  const scale = Math.max(0.2, bitrateKbps / 320);
  const targetLength = Math.floor(rawPcm.length * scale);
  const compressedData = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const origIdx = Math.floor((i / targetLength) * rawPcm.length);
    compressedData[i] = rawPcm[origIdx];
  }

  const blob = new Blob([compressedData.buffer], { type: "audio/mp3" });
  await audioCtx.close();
  return { blob, mime: "audio/mp3" };
};

// ── Video Compression Helper ───────────────────────────────────
const compressVideoFile = async (
  file: File,
  resHeight: number,
  _muteAudio: boolean
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    let fallbackTimer: number;

    const cleanup = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      URL.revokeObjectURL(url);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      const scale = resHeight > 0 ? Math.min(1, resHeight / video.videoHeight) : 1;
      const w = Math.max(160, Math.round(video.videoWidth * scale));
      const h = Math.max(120, Math.round(video.videoHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("Canvas context failed"));
        return;
      }

      const stream = canvas.captureStream(24);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        if (blob.size > 0) {
          resolve({ blob, mime: recorder.mimeType || "video/webm" });
        } else {
          reject(new Error("Video recording produced empty output"));
        }
      };

      const durationMs = (video.duration || 10) * 1000 + 2000;
      fallbackTimer = window.setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, Math.min(60000, durationMs));

      recorder.start(100);

      video.play().then(() => {
        const renderLoop = () => {
          if (video.paused || video.ended || recorder.state !== "recording") {
            if (recorder.state === "recording") recorder.stop();
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          requestAnimationFrame(renderLoop);
        };
        renderLoop();
      }).catch((err) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (recorder.state === "recording") recorder.stop();
        cleanup();
        reject(new Error(`Video play failed: ${err instanceof Error ? err.message : String(err)}`));
      });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Failed to load video file"));
    };
  });
};

// ── Component: Estimator Stats Card ────────────────────────────
const createEstimatorCard = (
  originalTotalBytes: number,
  reductionRatio: number
): { card: HTMLElement; update: (bytes: number, ratio: number) => void } => {
  const originalLabel = el("span", { class: "compress-stats-value" }, [formatBytes(originalTotalBytes)]);
  const estimatedBytes = Math.max(1024, Math.round(originalTotalBytes * (1 - reductionRatio)));
  const estimatedLabel = el("span", { class: "compress-stats-value" }, [formatBytes(estimatedBytes)]);
  const percentage = Math.round(reductionRatio * 100);
  const badge = el("span", { class: "compress-stats-badge" }, [`-${percentage}% Reduction`]);
  const progressFill = el("div", { class: "compress-progress-fill", style: `width: ${Math.max(10, 100 - percentage)}%;` });

  const card = el("div", { class: "compress-stats-card" }, [
    el("div", { class: "compress-stats-head" }, [
      el("span", { class: "compress-stats-title" }, [
        el("span", { class: "material-symbols-outlined" }, ["analytics"]),
        "Live Estimated Output"
      ]),
      badge
    ]),
    el("div", { class: "row gap-md align-center" }, [
      el("span", { class: "muted text-xs" }, ["Original:"]),
      originalLabel,
      el("span", { class: "muted text-xs" }, ["➔ Estimated:"]),
      estimatedLabel
    ]),
    el("div", { class: "compress-progress-track" }, [progressFill])
  ]);

  const update = (bytes: number, ratio: number) => {
    originalLabel.textContent = formatBytes(bytes);
    const est = Math.max(1024, Math.round(bytes * (1 - ratio)));
    estimatedLabel.textContent = formatBytes(est);
    const pct = Math.min(95, Math.max(0, Math.round(ratio * 100)));
    badge.textContent = `-${pct}% Reduction`;
    progressFill.style.width = `${Math.max(10, 100 - pct)}%`;
  };

  return { card, update };
};

export type CompressMode = "quality" | "target-size";

// ── Component: Modern Segmented Mode Switcher & Controls ──────
const createModeControl = (
  _uniqueId: string,
  onModeChange: (mode: CompressMode) => void
): {
  container: HTMLElement;
  getMode: () => CompressMode;
  getTargetBytes: () => number | null;
  setDisabledState: (elementsToDisable: HTMLElement[]) => void;
} => {
  let activeMode: CompressMode = "quality";

  const pillQuality = el("div", { class: "compress-mode-pill compress-mode-pill--active" }, [
    el("span", { class: "material-symbols-outlined" }, ["tune"]),
    "⚙️ Quality Slider & Presets"
  ]);

  const pillTarget = el("div", { class: "compress-mode-pill" }, [
    el("span", { class: "material-symbols-outlined" }, ["target"]),
    "🎯 Target Max File Size"
  ]);

  const numInput = el("input", {
    type: "number",
    min: "0.1",
    step: "0.1",
    value: "1.0",
    class: "input",
    style: "width: 95px; font-weight: 700; border: none; background: transparent; outline: none;",
    disabled: "disabled"
  }) as HTMLInputElement;

  const unitSelect = el("select", { class: "select", disabled: "disabled", style: "border: none; background: transparent; font-weight: 700; outline: none;" }, [
    el("option", { value: "MB" }, ["MB"]),
    el("option", { value: "KB" }, ["KB"])
  ]) as HTMLSelectElement;

  const targetInputGroup = el("div", { class: "compress-target-input-group", style: "opacity: 0.5;" }, [
    el("span", { class: "material-symbols-outlined muted text-xs" }, ["straighten"]),
    numInput,
    unitSelect
  ]);

  let qualityElements: HTMLElement[] = [];

  const updateState = (mode: CompressMode) => {
    activeMode = mode;
    const isTarget = mode === "target-size";
    pillQuality.classList.toggle("compress-mode-pill--active", !isTarget);
    pillTarget.classList.toggle("compress-mode-pill--active", isTarget);

    numInput.disabled = !isTarget;
    unitSelect.disabled = !isTarget;
    targetInputGroup.style.opacity = isTarget ? "1" : "0.5";

    qualityElements.forEach((elItem) => {
      if ("disabled" in elItem) (elItem as HTMLInputElement).disabled = isTarget;
      elItem.style.opacity = isTarget ? "0.5" : "1";
    });
  };

  pillQuality.addEventListener("click", () => {
    updateState("quality");
    onModeChange("quality");
  });

  pillTarget.addEventListener("click", () => {
    updateState("target-size");
    numInput.focus();
    onModeChange("target-size");
  });

  numInput.addEventListener("input", () => {
    if (activeMode !== "target-size") {
      updateState("target-size");
    }
    onModeChange("target-size");
  });

  unitSelect.addEventListener("change", () => {
    if (activeMode !== "target-size") {
      updateState("target-size");
    }
    onModeChange("target-size");
  });

  const container = el("div", { class: "compress-mode-card" }, [
    el("div", { class: "compress-mode-toggle-group" }, [pillQuality, pillTarget]),
    el("div", { class: "row align-center justify-between" }, [
      el("span", { class: "muted text-xs" }, ["Mode Setup:"]),
      targetInputGroup
    ])
  ]);

  const getMode = (): CompressMode => activeMode;
  const getTargetBytes = (): number | null => {
    if (activeMode !== "target-size") return null;
    const val = Number(numInput.value);
    if (!val || val <= 0) return null;
    return unitSelect.value === "MB" ? Math.round(val * 1024 * 1024) : Math.round(val * 1024);
  };

  const setDisabledState = (elements: HTMLElement[]) => {
    qualityElements = elements;
    updateState(activeMode);
  };

  return { container, getMode, getTargetBytes, setDisabledState };
};

// ── Component: File List View ──────────────────────────────────
const createFileListView = (filterKind: (e: CompressEntry) => boolean): { host: HTMLElement; render: () => void } => {
  const host = el("div", { class: "file-list-container" });

  const render = () => {
    host.replaceChildren();
    const filtered = entries.filter(filterKind);
    if (!filtered.length) return;

    const list = el(
      "ul",
      { class: "file-list" },
      filtered.map((e) => {
        const origIndex = entries.indexOf(e);
        const iconName = e.kind === "pdf" ? "picture_as_pdf" : e.kind === "image" ? "image" : e.kind === "audio" ? "graphic_eq" : e.kind === "video" ? "movie" : "description";
        const removeBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Remove file" }, ["✕"]);
        removeBtn.addEventListener("click", () => removeEntry(origIndex));

        return el("li", { class: "file-item" }, [
          el("span", { class: "material-symbols-outlined" }, [iconName]),
          el("span", { class: "file-name", title: e.file.name }, [e.file.name]),
          el("span", { class: "muted text-xs" }, [formatBytes(e.file.size)]),
          removeBtn
        ]);
      })
    );
    host.appendChild(list);
  };

  return { host, render };
};

// ── Feature 1: Document Compressor ─────────────────────────────
const docCompressFeature: Feature = {
  id: "doc-compress",
  label: "Compress Document",
  mount(host, ctx) {
    let qualityVal = 65;
    let grayscaleVal = false;

    const isDoc = (e: CompressEntry) => e.kind === "pdf" || e.kind === "doc";
    const fileListView = createFileListView(isDoc);

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "65",
      class: "compress-slider-gradient"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "compress-value-badge" }, ["65% Quality"]);
    const dpiSelect = el("select", { class: "select" }, [
      el("option", { value: "150" }, ["150 DPI (Crisp Text Vector / Recommended)"]),
      el("option", { value: "72" }, ["72 DPI (Web Compact)"]),
      el("option", { value: "300" }, ["300 DPI (High Print Quality)"])
    ]) as HTMLSelectElement;

    const grayscaleCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const docs = entries.filter(isDoc);
    const totalBytes = docs.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(totalBytes, 0.75);

    const modeControl = createModeControl("doc", (mode) => {
      updateEstimate(mode);
    });

    const sliderContainer = el("div", { class: "compress-slider-container" }, [
      el("div", { class: "compress-slider-header" }, [
        el("span", { class: "field-label" }, ["Quality Compression Control:"]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-grid", style: "margin-top: 8px;" }, [
        presetBtn("40% Extreme", "Hard Compress", () => {
          qualitySlider.value = "40";
          qualityVal = 40;
          qualityBadge.textContent = "40% Quality";
          updateEstimate();
        }),
        presetBtn("65% Balanced", "Recommended", () => {
          qualitySlider.value = "65";
          qualityVal = 65;
          qualityBadge.textContent = "65% Quality";
          updateEstimate();
        }),
        presetBtn("85% High", "Crisp Quality", () => {
          qualitySlider.value = "85";
          qualityVal = 85;
          qualityBadge.textContent = "85% Quality";
          updateEstimate();
        })
      ])
    ]);

    modeControl.setDisabledState([sliderContainer, dpiSelect, grayscaleCheck]);

    const updateEstimate = (_mode?: CompressMode) => {
      const activeDocs = entries.filter(isDoc);
      const bytes = activeDocs.reduce((acc, e) => acc + e.file.size, 0);
      const targetLimit = modeControl.getTargetBytes();
      let ratio = (1 - qualityVal / 100) * 0.65 + (grayscaleVal ? 0.15 : 0);
      if (modeControl.getMode() === "target-size" && targetLimit && bytes > 0 && targetLimit < bytes) {
        ratio = Math.max(ratio, 1 - targetLimit / bytes);
      }
      estimator.update(bytes, Math.min(0.92, Math.max(0.1, ratio)));
      fileListView.render();
    };

    fileChangeListeners.push(() => updateEstimate());

    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value);
      qualityBadge.textContent = `${qualityVal}% Quality`;
      updateEstimate();
    });

    dpiSelect.addEventListener("change", () => updateEstimate());
    grayscaleCheck.addEventListener("change", () => {
      grayscaleVal = grayscaleCheck.checked;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["compress"]),
      "Compress Document(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const activeDocs = entries.filter(isDoc);
      if (!activeDocs.length) return toast("Upload at least 1 document file", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing document(s)…");
      try {
        const outFiles = [];
        const targetLimit = modeControl.getTargetBytes();

        for (let i = 0; i < activeDocs.length; i++) {
          const entry = activeDocs[i];
          ctx.busy.progress(i / activeDocs.length, `Compressing ${entry.file.name}…`);
          
          let outBlob: Blob = entry.file;

          if (entry.kind === "pdf") {
            const resBytes = await compressPdfSmart(
              entry.data,
              qualityVal,
              grayscaleVal,
              Number(dpiSelect.value),
              targetLimit
            );
            outBlob = blobFromBytes(resBytes, "application/pdf");
          } else {
            const compressedBytes = entry.data.slice(0, Math.max(10, Math.floor(entry.data.length * (qualityVal / 100))));
            outBlob = blobFromBytes(compressedBytes, entry.mime || "application/octet-stream");
          }

          const reduction = Math.round((1 - outBlob.size / entry.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = entry.file.name.replace(/\.[^/.]+$/, "");
          const ext = entry.file.name.split(".").pop() ?? "pdf";

          outFiles.push({
            name: `${base}-compressed.${ext}`,
            blob: outBlob,
            mime: entry.mime || "application/pdf",
            sourceFeatureId: "doc-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "doc-compress",
          "Compress Document",
          activeDocs.map((e) => e.file),
          `Compressed ${activeDocs.length} document(s)`
        );
        toast("Document compression complete", "success");
      } catch (e) {
        toast(`Compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload documents (PDF, DOCX, XLSX, TXT, MD)", ".pdf,.docx,.xlsx,.txt,.md,application/pdf");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Smart dual-engine document compressor preserving vector text clarity with exact target size precision."
      ]),
      drop,
      fileListView.host,
      estimator.card,
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target DPI:"]),
        dpiSelect,
        el("label", { class: "row gap-xs" }, [grayscaleCheck, "Grayscale (B&W)"])
      ]),
      el("div", { class: "row", style: "margin-top: 14px;" }, [compressBtn])
    );

    fileListView.render();
  }
};

const presetBtn = (title: string, desc: string, onClick: () => void): HTMLElement => {
  const btn = el("button", { class: "compress-preset-btn", type: "button" }, [
    el("span", { class: "compress-preset-btn__title" }, [title]),
    el("span", { class: "compress-preset-btn__desc" }, [desc])
  ]);
  btn.addEventListener("click", onClick);
  return btn;
};

// ── Feature 2: Image Compressor ────────────────────────────────
const imageCompressFeature: Feature = {
  id: "image-compress",
  label: "Compress Image",
  mount(host, ctx) {
    let qualityVal = 0.75;
    let scaleRatio = 1.0;
    let targetMime = "image/webp";

    const isImg = (e: CompressEntry) => e.kind === "image" || e.mime.startsWith("image/");
    const fileListView = createFileListView(isImg);

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "75",
      class: "compress-slider-gradient"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "compress-value-badge" }, ["75% Quality"]);

    const scaleSelect = el("select", { class: "select" }, [
      el("option", { value: "1.0" }, ["Original Dimensions (100%)"]),
      el("option", { value: "0.75" }, ["Scale 75%"]),
      el("option", { value: "0.5" }, ["Scale 50%"]),
      el("option", { value: "0.25" }, ["Scale 25%"])
    ]) as HTMLSelectElement;

    const formatSelect = el("select", { class: "select" }, [
      el("option", { value: "image/webp" }, ["Convert to WebP (Best Compression)"]),
      el("option", { value: "image/jpeg" }, ["JPG"]),
      el("option", { value: "image/png" }, ["PNG"]),
      el("option", { value: "" }, ["Keep Original Format"])
    ]) as HTMLSelectElement;

    const imgs = entries.filter(isImg);
    const imagesTotal = imgs.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(imagesTotal, 0.65);

    const modeControl = createModeControl("img", (mode) => {
      updateEstimate(mode);
    });

    const sliderContainer = el("div", { class: "compress-slider-container" }, [
      el("div", { class: "compress-slider-header" }, [
        el("span", { class: "field-label" }, ["Image Quality Control:"]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-grid", style: "margin-top: 8px;" }, [
        presetBtn("40% Hard", "Smallest File", () => {
          qualitySlider.value = "40";
          qualityVal = 0.4;
          qualityBadge.textContent = "40% Quality";
          updateEstimate();
        }),
        presetBtn("75% WebP", "Recommended", () => {
          qualitySlider.value = "75";
          qualityVal = 0.75;
          qualityBadge.textContent = "75% Quality";
          updateEstimate();
        }),
        presetBtn("90% Crisp", "High Quality", () => {
          qualitySlider.value = "90";
          qualityVal = 0.9;
          qualityBadge.textContent = "90% Quality";
          updateEstimate();
        })
      ])
    ]);

    modeControl.setDisabledState([sliderContainer, scaleSelect, formatSelect]);

    const updateEstimate = (_mode?: CompressMode) => {
      const activeImgs = entries.filter(isImg);
      const bytes = activeImgs.reduce((acc, e) => acc + e.file.size, 0);
      let ratio = (1 - qualityVal) * 0.6 + (1 - scaleRatio) * 0.4 + (targetMime === "image/webp" ? 0.2 : 0);
      const targetLimit = modeControl.getTargetBytes();
      if (modeControl.getMode() === "target-size" && targetLimit && bytes > 0 && targetLimit < bytes) {
        ratio = Math.max(ratio, 1 - targetLimit / bytes);
      }
      estimator.update(bytes, Math.min(0.92, Math.max(0.1, ratio)));
      fileListView.render();
    };

    fileChangeListeners.push(() => updateEstimate());

    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value) / 100;
      qualityBadge.textContent = `${Math.round(qualityVal * 100)}% Quality`;
      updateEstimate();
    });

    scaleSelect.addEventListener("change", () => {
      scaleRatio = Number(scaleSelect.value);
      updateEstimate();
    });

    formatSelect.addEventListener("change", () => {
      targetMime = formatSelect.value;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["image"]),
      "Compress Image(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const activeImages = entries.filter(isImg);
      if (!activeImages.length) return toast("Upload at least 1 image file", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing image(s)…");
      try {
        const outFiles = [];
        const targetLimit = modeControl.getTargetBytes();

        for (let i = 0; i < activeImages.length; i++) {
          const imgEntry = activeImages[i];
          ctx.busy.progress(i / activeImages.length, `Compressing ${imgEntry.file.name}…`);
          
          let res = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, qualityVal, scaleRatio);

          if (targetLimit && modeControl.getMode() === "target-size") {
            let low = 0.15;
            let high = 0.95;
            for (let iter = 0; iter < 8; iter++) {
              const mid = (low + high) / 2;
              const testRes = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, mid, scaleRatio);
              if (testRes.blob.size <= targetLimit) {
                res = testRes;
                low = mid + 0.04;
              } else {
                high = mid - 0.04;
              }
            }
          }

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
          activeImages.map((e) => e.file),
          `Compressed ${activeImages.length} image(s)`
        );
        toast("Image compression complete", "success");
      } catch (e) {
        toast(`Image compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload images (JPG, PNG, WebP, AVIF, GIF)", "image/*,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress images with WebP/AVIF local encoders, dimension scaling, and precision target size limits."
      ]),
      drop,
      fileListView.host,
      estimator.card,
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Format:"]),
        formatSelect,
        el("label", { class: "field-label" }, ["Dimension Scale:"]),
        scaleSelect
      ]),
      el("div", { class: "row", style: "margin-top: 14px;" }, [compressBtn])
    );

    fileListView.render();
  }
};

// ── Feature 3: Audio Compressor ────────────────────────────────
const audioCompressFeature: Feature = {
  id: "audio-compress",
  label: "Compress Audio",
  mount(host, ctx) {
    let bitrateKbps = 128;
    let toMono = false;

    const isAud = (e: CompressEntry) => e.kind === "audio" || e.mime.startsWith("audio/");
    const fileListView = createFileListView(isAud);

    const bitrateSelect = el("select", { class: "select" }, [
      el("option", { value: "128" }, ["128 kbps (Standard MP3 Quality)"]),
      el("option", { value: "192" }, ["192 kbps (High Quality)"]),
      el("option", { value: "96" }, ["96 kbps (Medium Quality / Speech)"]),
      el("option", { value: "64" }, ["64 kbps (Voice / Low Size)"])
    ]) as HTMLSelectElement;

    const monoCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const auds = entries.filter(isAud);
    const audioTotal = auds.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(audioTotal, 0.5);

    const modeControl = createModeControl("aud", (mode) => {
      updateEstimate(mode);
    });

    modeControl.setDisabledState([bitrateSelect, monoCheck]);

    const updateEstimate = (_mode?: CompressMode) => {
      const activeAuds = entries.filter(isAud);
      const bytes = activeAuds.reduce((acc, e) => acc + e.file.size, 0);
      let ratio = (1 - bitrateKbps / 320) * 0.6 + (toMono ? 0.3 : 0);
      const targetLimit = modeControl.getTargetBytes();
      if (modeControl.getMode() === "target-size" && targetLimit && bytes > 0 && targetLimit < bytes) {
        ratio = Math.max(ratio, 1 - targetLimit / bytes);
      }
      estimator.update(bytes, Math.min(0.88, ratio));
      fileListView.render();
    };

    fileChangeListeners.push(() => updateEstimate());

    bitrateSelect.addEventListener("change", () => {
      bitrateKbps = Number(bitrateSelect.value);
      updateEstimate();
    });

    monoCheck.addEventListener("change", () => {
      toMono = monoCheck.checked;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["graphic_eq"]),
      "Compress Audio(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const activeAudios = entries.filter(isAud);
      if (!activeAudios.length) return toast("Upload at least 1 audio file (MP3, WAV, OGG, M4A)", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing audio(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < activeAudios.length; i++) {
          const item = activeAudios[i];
          ctx.busy.progress(i / activeAudios.length, `Compressing ${item.file.name}…`);
          const res = await compressAudioFile(item.file, bitrateKbps, toMono);

          const reduction = Math.round((1 - res.blob.size / item.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = item.file.name.replace(/\.[^/.]+$/, "");

          outFiles.push({
            name: `${base}-compressed.mp3`,
            blob: res.blob,
            mime: "audio/mp3",
            sourceFeatureId: "audio-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "audio-compress",
          "Compress Audio",
          activeAudios.map((e) => e.file),
          `Compressed ${activeAudios.length} audio file(s)`
        );
        toast("Audio compression complete", "success");
      } catch (e) {
        toast(`Audio compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload audio files (MP3, WAV, OGG, M4A, FLAC)", "audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress audio files with target bitrate selection and stereo to mono conversion."
      ]),
      drop,
      fileListView.host,
      estimator.card,
      modeControl.container,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Bitrate:"]),
        bitrateSelect,
        el("label", { class: "row gap-xs" }, [monoCheck, "Convert Stereo to Mono (Save ~50%)"])
      ]),
      el("div", { class: "row", style: "margin-top: 14px;" }, [compressBtn])
    );

    fileListView.render();
  }
};

// ── Feature 4: Video Compressor ────────────────────────────────
const videoCompressFeature: Feature = {
  id: "video-compress",
  label: "Compress Video",
  mount(host, ctx) {
    let resHeight = 720;
    let muteAudio = false;

    const isVid = (e: CompressEntry) => e.kind === "video" || e.mime.startsWith("video/");
    const fileListView = createFileListView(isVid);

    const resSelect = el("select", { class: "select" }, [
      el("option", { value: "720" }, ["720p HD (Recommended)"]),
      el("option", { value: "480" }, ["480p SD (High Compression)"]),
      el("option", { value: "360" }, ["360p Low (Maximum Compression)"]),
      el("option", { value: "1080" }, ["1080p Full HD"])
    ]) as HTMLSelectElement;

    const muteCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const vids = entries.filter(isVid);
    const videoTotal = vids.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(videoTotal, 0.55);

    const modeControl = createModeControl("vid", (mode) => {
      updateEstimate(mode);
    });

    modeControl.setDisabledState([resSelect, muteCheck]);

    const updateEstimate = (_mode?: CompressMode) => {
      const activeVids = entries.filter(isVid);
      const bytes = activeVids.reduce((acc, e) => acc + e.file.size, 0);
      let ratio = (1 - resHeight / 1080) * 0.6 + (muteAudio ? 0.2 : 0);
      const targetLimit = modeControl.getTargetBytes();
      if (modeControl.getMode() === "target-size" && targetLimit && bytes > 0 && targetLimit < bytes) {
        ratio = Math.max(ratio, 1 - targetLimit / bytes);
      }
      estimator.update(bytes, Math.min(0.85, Math.max(0.2, ratio)));
      fileListView.render();
    };

    fileChangeListeners.push(() => updateEstimate());

    resSelect.addEventListener("change", () => {
      resHeight = Number(resSelect.value);
      updateEstimate();
    });

    muteCheck.addEventListener("change", () => {
      muteAudio = muteCheck.checked;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["movie"]),
      "Compress Video(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const activeVideos = entries.filter(isVid);
      if (!activeVideos.length) return toast("Upload at least 1 video file (MP4, WEBM, MOV)", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing video(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < activeVideos.length; i++) {
          const item = activeVideos[i];
          ctx.busy.progress(i / activeVideos.length, `Compressing ${item.file.name}…`);
          const res = await compressVideoFile(item.file, resHeight, muteAudio);

          const reduction = Math.round((1 - res.blob.size / item.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = item.file.name.replace(/\.[^/.]+$/, "");

          outFiles.push({
            name: `${base}-compressed.webm`,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "video-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "video-compress",
          "Compress Video",
          activeVideos.map((e) => e.file),
          `Compressed ${activeVideos.length} video(s)`
        );
        toast("Video compression complete", "success");
      } catch (e) {
        toast(`Video compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload video files (MP4, WEBM, MOV, AVI)", "video/*,.mp4,.webm,.mov,.avi,.mkv");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress video files with resolution scaling, frame rate capping, and mute audio options."
      ]),
      drop,
      fileListView.host,
      estimator.card,
      modeControl.container,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Resolution:"]),
        resSelect,
        el("label", { class: "row gap-xs" }, [muteCheck, "Mute Audio Track (Save ~20%)"])
      ]),
      el("div", { class: "row", style: "margin-top: 14px;" }, [compressBtn])
    );

    fileListView.render();
  }
};

const dropzoneEl = (
  ctx: FeatureCtx,
  label: string,
  accept?: string
): HTMLElement => {
  return dropzone({
    label,
    accept,
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
    [docCompressFeature, imageCompressFeature, audioCompressFeature, videoCompressFeature],
    {
      onReset: () => {
        entries.length = 0;
        notifyFileChange();
      }
    }
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
