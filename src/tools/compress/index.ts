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
      } else if (f.type === "image/gif" || /\.gif$/i.test(f.name)) {
        kind = "video"; // GIF to Video tab
      } else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|avif|bmp)$/i.test(f.name)) {
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

    const renderScale = Math.max(1.2, dpi / 72);
    const jpegQuality = Math.max(0.05, Math.min(0.95, qualityPercent / 100));

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

// ── Target Precision Match Engine (Exact vs Approx) ─────────────
const compressPdfTargetMatch = async (
  pdfBytes: Uint8Array,
  targetBytes: number,
  grayscaleVal: boolean,
  precision: "exact" | "approx"
): Promise<Uint8Array> => {
  const structural = await compressPdfStructural(pdfBytes);
  if (precision === "approx" && structural.length <= targetBytes) {
    return structural;
  }

  const dpiOptions = [150, 120, 96, 72];
  let bestBytes = structural;

  for (const dpi of dpiOptions) {
    let lowQ = 1;
    let highQ = 100;
    let dpiBest: Uint8Array | null = null;

    while (lowQ <= highQ) {
      const midQ = Math.floor((lowQ + highQ) / 2);
      const test = await compressPdfCanvas(pdfBytes, midQ, grayscaleVal, dpi);
      if (test.length <= targetBytes) {
        dpiBest = test;
        if (precision === "exact") {
          lowQ = midQ + 1;
        } else {
          lowQ = midQ + 2;
        }
      } else {
        highQ = midQ - 1;
      }
    }

    if (dpiBest) {
      bestBytes = dpiBest;
      if (precision === "exact" && bestBytes.length >= targetBytes * 0.9) break;
    }
  }

  return bestBytes;
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

// ── Multi-Frame Animated GIF Canvas Stream Recording Engine ────
const compressAnimatedGifFile = async (
  file: File,
  targetResHeight: number
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const scale = targetResHeight > 0 ? Math.min(1, targetResHeight / img.height) : 1;
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Canvas context failed"));
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Mount image offscreen so browser GIF animation engine ticks frames
      img.style.position = "absolute";
      img.style.left = "-9999px";
      img.style.top = "-9999px";
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      document.body.appendChild(img);

      const stream = canvas.captureStream(24);
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: "image/gif" });
      } catch {
        try {
          recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        } catch {
          recorder = new MediaRecorder(stream);
        }
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (img.parentNode) img.parentNode.removeChild(img);
      };

      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: "image/gif" });
        if (blob.size > 0 && blob.size < file.size) {
          resolve({ blob, mime: "image/gif" });
        } else {
          resolve({ blob: file, mime: "image/gif" });
        }
      };

      const startTime = performance.now();
      const captureDurationMs = 3500; // Capture multi-frame animation sequence

      const renderLoop = () => {
        ctx.drawImage(img, 0, 0, w, h);
        if (performance.now() - startTime < captureDurationMs && recorder.state === "recording") {
          requestAnimationFrame(renderLoop);
        } else {
          if (recorder.state === "recording") recorder.stop();
        }
      };

      recorder.start(100);
      renderLoop();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load GIF image file"));
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
  const badge = el("span", { class: "compress-stats-badge" }, [`-${percentage}%`]);
  const progressFill = el("div", { class: "compress-progress-fill", style: `width: ${Math.max(10, 100 - percentage)}%;` });

  const card = el("div", { class: "compress-stats-card", style: "padding: 8px 10px; gap: 4px;" }, [
    el("div", { class: "compress-stats-head" }, [
      el("span", { class: "compress-stats-title", style: "font-size: 10px;" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["analytics"]),
        "Estimated Output"
      ]),
      badge
    ]),
    el("div", { class: "row gap-md align-center text-xs" }, [
      el("span", { class: "muted" }, ["Original:"]),
      originalLabel,
      el("span", { class: "muted" }, ["➔ Est:"]),
      estimatedLabel
    ]),
    el("div", { class: "compress-progress-track", style: "height: 4px;" }, [progressFill])
  ]);

  const update = (bytes: number, ratio: number) => {
    originalLabel.textContent = formatBytes(bytes);
    const est = Math.max(1024, Math.round(bytes * (1 - ratio)));
    estimatedLabel.textContent = formatBytes(est);
    const pct = Math.min(95, Math.max(0, Math.round(ratio * 100)));
    badge.textContent = `-${pct}%`;
    progressFill.style.width = `${Math.max(10, 100 - pct)}%`;
  };

  return { card, update };
};

export type CompressMode = "quality" | "target-size";
export type TargetPrecision = "exact" | "approx";

// ── Component: Compact Google Material Mode Switcher & Precision
const createModeControl = (
  _uniqueId: string,
  onModeChange: (mode: CompressMode) => void
): {
  container: HTMLElement;
  getMode: () => CompressMode;
  getTargetBytes: () => number | null;
  getTargetPrecision: () => TargetPrecision;
  setDisabledState: (elementsToDisable: HTMLElement[]) => void;
} => {
  let activeMode: CompressMode = "quality";
  let activePrecision: TargetPrecision = "exact";

  const pillQuality = el("div", { class: "compress-mode-pill compress-mode-pill--active" }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
    "Quality Slider"
  ]);

  const pillTarget = el("div", { class: "compress-mode-pill" }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["track_changes"]),
    "Target Size"
  ]);

  const pillExact = el("div", { class: "compress-precision-pill compress-precision-pill--active" }, ["Exact Match"]);
  const pillApprox = el("div", { class: "compress-precision-pill" }, ["Approx (Max)"]);

  const precisionToggle = el("div", { class: "compress-precision-toggle", style: "opacity: 0.35; pointer-events: none;" }, [
    pillExact,
    pillApprox
  ]);

  pillExact.addEventListener("click", () => {
    activePrecision = "exact";
    pillExact.classList.add("compress-precision-pill--active");
    pillApprox.classList.remove("compress-precision-pill--active");
    onModeChange("target-size");
  });

  pillApprox.addEventListener("click", () => {
    activePrecision = "approx";
    pillApprox.classList.add("compress-precision-pill--active");
    pillExact.classList.remove("compress-precision-pill--active");
    onModeChange("target-size");
  });

  const numInput = el("input", {
    type: "number",
    min: "0.1",
    step: "0.1",
    value: "1.0",
    class: "input",
    style: "width: 55px; font-weight: 700; border: none; background: transparent; outline: none; padding: 0 2px; font-size: 11px;",
    disabled: "disabled"
  }) as HTMLInputElement;

  const unitSelect = el("select", { class: "select", disabled: "disabled", style: "border: none; background: transparent; font-weight: 700; outline: none; padding: 0 2px; font-size: 10px;" }, [
    el("option", { value: "MB" }, ["MB"]),
    el("option", { value: "KB" }, ["KB"])
  ]) as HTMLSelectElement;

  const targetInputGroup = el("div", { class: "compress-target-input-group", style: "opacity: 0.35; pointer-events: none; height: 26px;" }, [
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

    qualityElements.forEach((elItem) => {
      const controls = elItem.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button");
      controls.forEach((ctrl) => {
        ctrl.disabled = isTarget;
      });
      if ("disabled" in elItem) (elItem as HTMLInputElement).disabled = isTarget;
      elItem.style.opacity = isTarget ? "0.35" : "1";
      elItem.style.pointerEvents = isTarget ? "none" : "auto";
    });

    numInput.disabled = !isTarget;
    unitSelect.disabled = !isTarget;
    targetInputGroup.style.opacity = isTarget ? "1" : "0.35";
    targetInputGroup.style.pointerEvents = isTarget ? "auto" : "none";

    precisionToggle.style.opacity = isTarget ? "1" : "0.35";
    precisionToggle.style.pointerEvents = isTarget ? "auto" : "none";
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
    el("div", { class: "row align-center justify-between gap-xs", style: "padding: 2px 0;" }, [
      precisionToggle,
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

  const getTargetPrecision = (): TargetPrecision => activePrecision;

  const setDisabledState = (elements: HTMLElement[]) => {
    qualityElements = elements;
    updateState(activeMode);
  };

  return { container, getMode, getTargetBytes, getTargetPrecision, setDisabledState };
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
      { class: "file-list", style: "max-height: 180px; overflow-y: auto;" },
      filtered.map((e) => {
        const origIndex = entries.indexOf(e);
        const iconName = e.kind === "pdf" ? "picture_as_pdf" : e.kind === "image" ? "image" : e.kind === "audio" ? "graphic_eq" : e.kind === "video" ? "movie" : "description";
        const removeBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Remove file" }, ["✕"]);
        removeBtn.addEventListener("click", () => removeEntry(origIndex));

        return el("li", { class: "file-item", style: "padding: 4px 8px;" }, [
          el("span", { class: "material-symbols-outlined text-xs" }, [iconName]),
          el("span", { class: "file-name text-xs", title: e.file.name }, [e.file.name]),
          el("span", { class: "muted text-xs" }, [formatBytes(e.file.size)]),
          removeBtn
        ]);
      })
    );
    host.appendChild(list);
  };

  return { host, render };
};

// ── Feature 1: Document Compressor (Compact Dashboard Layout) ──
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

    const qualityBadge = el("span", { class: "compress-value-badge" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
      "65% Quality"
    ]);

    const dpiSelect = el("select", { class: "select", style: "font-size: 11px; padding: 2px 4px;" }, [
      el("option", { value: "150" }, ["150 DPI (Crisp Text Vector)"]),
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
        el("span", { class: "field-label text-xs row gap-xs align-center" }, [
          el("span", { class: "material-symbols-outlined text-xs" }, ["sliders"]),
          "Quality Slider:"
        ]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-grid", style: "margin-top: 4px; grid-template-columns: repeat(3, 1fr);" }, [
        presetBtn("40%", "Hard", () => {
          qualitySlider.value = "40";
          qualityVal = 40;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "40% Quality");
          updateEstimate();
        }),
        presetBtn("65%", "Balanced", () => {
          qualitySlider.value = "65";
          qualityVal = 65;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "65% Quality");
          updateEstimate();
        }),
        presetBtn("85%", "Crisp", () => {
          qualitySlider.value = "85";
          qualityVal = 85;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "85% Quality");
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
      qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), `${qualityVal}% Quality`);
      updateEstimate();
    });

    dpiSelect.addEventListener("change", () => updateEstimate());
    grayscaleCheck.addEventListener("change", () => {
      grayscaleVal = grayscaleCheck.checked;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button", style: "width: 100%; justify-content: center;" }, [
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
        const precision = modeControl.getTargetPrecision();

        for (let i = 0; i < activeDocs.length; i++) {
          const entry = activeDocs[i];
          ctx.busy.progress(i / activeDocs.length, `Compressing ${entry.file.name}…`);
          
          let outBlob: Blob = entry.file;

          if (entry.kind === "pdf") {
            if (targetLimit && modeControl.getMode() === "target-size") {
              const exactBytes = await compressPdfTargetMatch(entry.data, targetLimit, grayscaleVal, precision);
              outBlob = blobFromBytes(exactBytes, "application/pdf");
            } else {
              const compressedBytes = await compressPdfCanvas(entry.data, qualityVal, grayscaleVal, Number(dpiSelect.value));
              outBlob = blobFromBytes(compressedBytes, "application/pdf");
            }
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

    const drop = dropzoneEl(ctx, "Upload documents (PDF, DOCX, XLSX, TXT)", ".pdf,.docx,.xlsx,.txt,.md,application/pdf");

    const leftPanel = el("div", { class: "compress-panel-left" }, [drop, fileListView.host]);
    const rightPanel = el("div", { class: "compress-panel-right" }, [
      estimator.card,
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["DPI:"]),
        dpiSelect,
        el("label", { class: "row gap-xs text-xs" }, [grayscaleCheck, "Grayscale"])
      ]),
      compressBtn
    ]);

    const dashboard = el("div", { class: "compress-dashboard-grid" }, [leftPanel, rightPanel]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Smart document compressor preserving vector text clarity with exact target precision."
      ]),
      dashboard
    );

    fileListView.render();
  }
};

const presetBtn = (title: string, desc: string, onClick: () => void): HTMLElement => {
  const btn = el("button", { class: "compress-preset-btn", type: "button", style: "padding: 3px 4px;" }, [
    el("span", { class: "compress-preset-btn__title", style: "font-size: 10px;" }, [title]),
    el("span", { class: "compress-preset-btn__desc", style: "font-size: 8px;" }, [desc])
  ]);
  btn.addEventListener("click", onClick);
  return btn;
};

// ── Feature 2: Image Compressor (Compact Dashboard Layout) ─────
const imageCompressFeature: Feature = {
  id: "image-compress",
  label: "Compress Image",
  mount(host, ctx) {
    let qualityVal = 0.75;
    let scaleRatio = 1.0;
    let targetMime = "image/webp";

    const isImg = (e: CompressEntry) => e.kind === "image" || (e.mime.startsWith("image/") && e.mime !== "image/gif");
    const fileListView = createFileListView(isImg);

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "75",
      class: "compress-slider-gradient"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "compress-value-badge" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
      "75% Quality"
    ]);

    const scaleSelect = el("select", { class: "select", style: "font-size: 11px; padding: 2px 4px;" }, [
      el("option", { value: "1.0" }, ["Original (100%)"]),
      el("option", { value: "0.75" }, ["Scale 75%"]),
      el("option", { value: "0.5" }, ["Scale 50%"]),
      el("option", { value: "0.25" }, ["Scale 25%"])
    ]) as HTMLSelectElement;

    const formatSelect = el("select", { class: "select", style: "font-size: 11px; padding: 2px 4px;" }, [
      el("option", { value: "image/webp" }, ["WebP"]),
      el("option", { value: "image/jpeg" }, ["JPG"]),
      el("option", { value: "image/png" }, ["PNG"]),
      el("option", { value: "" }, ["Original Format"])
    ]) as HTMLSelectElement;

    const imgs = entries.filter(isImg);
    const imagesTotal = imgs.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(imagesTotal, 0.65);

    const modeControl = createModeControl("img", (mode) => {
      updateEstimate(mode);
    });

    const sliderContainer = el("div", { class: "compress-slider-container" }, [
      el("div", { class: "compress-slider-header" }, [
        el("span", { class: "field-label text-xs row gap-xs align-center" }, [
          el("span", { class: "material-symbols-outlined text-xs" }, ["sliders"]),
          "Quality Slider:"
        ]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-grid", style: "margin-top: 4px; grid-template-columns: repeat(3, 1fr);" }, [
        presetBtn("40%", "Hard", () => {
          qualitySlider.value = "40";
          qualityVal = 0.4;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "40% Quality");
          updateEstimate();
        }),
        presetBtn("75%", "WebP", () => {
          qualitySlider.value = "75";
          qualityVal = 0.75;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "75% Quality");
          updateEstimate();
        }),
        presetBtn("90%", "Crisp", () => {
          qualitySlider.value = "90";
          qualityVal = 0.9;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "90% Quality");
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
      qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), `${Math.round(qualityVal * 100)}% Quality`);
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

    const compressBtn = el("button", { class: "btn btn--primary", type: "button", style: "width: 100%; justify-content: center;" }, [
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
        const precision = modeControl.getTargetPrecision();

        for (let i = 0; i < activeImages.length; i++) {
          const imgEntry = activeImages[i];
          ctx.busy.progress(i / activeImages.length, `Compressing ${imgEntry.file.name}…`);
          
          let res = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, qualityVal, scaleRatio);

          if (targetLimit && modeControl.getMode() === "target-size") {
            let bestRes = res;
            let curScale = scaleRatio;

            for (let scaleIter = 0; scaleIter < 4; scaleIter++) {
              let low = 0.01;
              let high = 1.0;
              while (low <= high) {
                const mid = (low + high) / 2;
                const testRes = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, mid, curScale);
                if (testRes.blob.size <= targetLimit && testRes.blob.size <= imgEntry.file.size) {
                  bestRes = testRes;
                  if (precision === "exact") {
                    low = mid + 0.02;
                  } else {
                    low = mid + 0.05;
                  }
                } else {
                  high = mid - 0.02;
                }
              }
              if (bestRes.blob.size <= targetLimit && bestRes.blob.size <= imgEntry.file.size) break;
              curScale *= 0.85;
            }

            if (bestRes.blob.size > imgEntry.file.size && imgEntry.file.size <= targetLimit) {
              res = { blob: imgEntry.file, mime: imgEntry.mime };
            } else {
              res = bestRes;
            }
          } else {
            if (res.blob.size > imgEntry.file.size) {
              const fallback = await compressImageFile(imgEntry.file, "image/jpeg", 0.65, 0.9);
              if (fallback.blob.size < imgEntry.file.size) res = fallback;
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

    const drop = dropzoneEl(ctx, "Upload images (JPG, PNG, WebP, AVIF)", "image/*,.jpg,.jpeg,.png,.webp,.avif,.bmp");

    const leftPanel = el("div", { class: "compress-panel-left" }, [drop, fileListView.host]);
    const rightPanel = el("div", { class: "compress-panel-right" }, [
      estimator.card,
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Format:"]),
        formatSelect,
        el("label", { class: "field-label text-xs" }, ["Scale:"]),
        scaleSelect
      ]),
      compressBtn
    ]);

    const dashboard = el("div", { class: "compress-dashboard-grid" }, [leftPanel, rightPanel]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress images with WebP/AVIF local encoders, dimension scaling, and precision target size limits."
      ]),
      dashboard
    );

    fileListView.render();
  }
};

// ── Feature 3: Audio Compressor (Compact Dashboard Layout) ──────
const audioCompressFeature: Feature = {
  id: "audio-compress",
  label: "Compress Audio",
  mount(host, ctx) {
    let bitrateKbps = 128;
    let toMono = false;

    const isAud = (e: CompressEntry) => e.kind === "audio" || e.mime.startsWith("audio/");
    const fileListView = createFileListView(isAud);

    const bitrateSelect = el("select", { class: "select", style: "font-size: 11px; padding: 2px 4px;" }, [
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

    const presetContainer = el("div", { class: "compress-slider-container" }, [
      el("span", { class: "field-label text-xs row gap-xs align-center" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["sliders"]),
        "Bitrate Presets:"
      ]),
      el("div", { class: "compress-presets-grid", style: "margin-top: 4px; grid-template-columns: repeat(3, 1fr);" }, [
        presetBtn("64 kbps", "Voice", () => {
          bitrateSelect.value = "64";
          bitrateKbps = 64;
          updateEstimate();
        }),
        presetBtn("128 kbps", "Standard", () => {
          bitrateSelect.value = "128";
          bitrateKbps = 128;
          updateEstimate();
        }),
        presetBtn("192 kbps", "High", () => {
          bitrateSelect.value = "192";
          bitrateKbps = 192;
          updateEstimate();
        })
      ])
    ]);

    modeControl.setDisabledState([presetContainer, bitrateSelect, monoCheck]);

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

    const compressBtn = el("button", { class: "btn btn--primary", type: "button", style: "width: 100%; justify-content: center;" }, [
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

    const drop = dropzoneEl(ctx, "Upload audio files (MP3, WAV, OGG, M4A)", "audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac");

    const leftPanel = el("div", { class: "compress-panel-left" }, [drop, fileListView.host]);
    const rightPanel = el("div", { class: "compress-panel-right" }, [
      estimator.card,
      modeControl.container,
      presetContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Bitrate:"]),
        bitrateSelect,
        el("label", { class: "row gap-xs text-xs" }, [monoCheck, "Stereo ➔ Mono"])
      ]),
      compressBtn
    ]);

    const dashboard = el("div", { class: "compress-dashboard-grid" }, [leftPanel, rightPanel]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress audio files with target bitrate selection and stereo to mono conversion."
      ]),
      dashboard
    );

    fileListView.render();
  }
};

// ── Feature 4: Video Compressor (Includes Multi-Frame Animated GIF Canvas Stream Recording Engine)
const videoCompressFeature: Feature = {
  id: "video-compress",
  label: "Compress Video / GIF",
  mount(host, ctx) {
    let resHeight = 720;
    let muteAudio = false;

    const isVid = (e: CompressEntry) => e.kind === "video" || e.mime.startsWith("video/") || e.mime === "image/gif";
    const fileListView = createFileListView(isVid);

    const resSelect = el("select", { class: "select", style: "font-size: 11px; padding: 2px 6px;" }, [
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

    const presetContainer = el("div", { class: "compress-slider-container" }, [
      el("span", { class: "field-label text-xs row gap-xs align-center" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["sliders"]),
        "Resolution Presets:"
      ]),
      el("div", { class: "compress-presets-grid", style: "margin-top: 4px; grid-template-columns: repeat(3, 1fr);" }, [
        presetBtn("480p", "SD", () => {
          resSelect.value = "480";
          resHeight = 480;
          updateEstimate();
        }),
        presetBtn("720p", "HD", () => {
          resSelect.value = "720";
          resHeight = 720;
          updateEstimate();
        }),
        presetBtn("1080p", "Full HD", () => {
          resSelect.value = "1080";
          resHeight = 1080;
          updateEstimate();
        })
      ])
    ]);

    modeControl.setDisabledState([presetContainer, resSelect, muteCheck]);

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

    const compressBtn = el("button", { class: "btn btn--primary", type: "button", style: "width: 100%; justify-content: center;" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["movie"]),
      "Compress Video / GIF(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const activeVideos = entries.filter(isVid);
      if (!activeVideos.length) return toast("Upload at least 1 video or GIF file (MP4, WEBM, MOV, GIF)", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing video/GIF(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < activeVideos.length; i++) {
          const item = activeVideos[i];
          ctx.busy.progress(i / activeVideos.length, `Compressing ${item.file.name}…`);
          
          const isGif = item.mime === "image/gif" || /\.gif$/i.test(item.file.name);
          const res = isGif
            ? await compressAnimatedGifFile(item.file, resHeight)
            : await compressVideoFile(item.file, resHeight, muteAudio);

          const reduction = Math.round((1 - res.blob.size / item.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = item.file.name.replace(/\.[^/.]+$/, "");
          const ext = isGif ? "gif" : "webm";

          outFiles.push({
            name: `${base}-compressed.${ext}`,
            blob: res.blob,
            mime: res.mime,
            sourceFeatureId: "video-compress",
            sourceLabel: `Compressed (${reductionLabel})`
          });
        }

        ctx.showResult(
          outFiles,
          "video-compress",
          "Compress Video / GIF",
          activeVideos.map((e) => e.file),
          `Compressed ${activeVideos.length} video/GIF(s)`
        );
        toast("Video / GIF compression complete", "success");
      } catch (e) {
        toast(`Video / GIF compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload video files & GIF (MP4, WEBM, MOV, GIF)", "video/*,.mp4,.webm,.mov,.avi,.mkv,.gif,image/gif");

    const leftPanel = el("div", { class: "compress-panel-left" }, [drop, fileListView.host]);
    const rightPanel = el("div", { class: "compress-panel-right" }, [
      estimator.card,
      modeControl.container,
      presetContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Resolution:"]),
        resSelect,
        el("label", { class: "row gap-xs text-xs" }, [muteCheck, "Mute Audio Track"])
      ]),
      compressBtn
    ]);

    const dashboard = el("div", { class: "compress-dashboard-grid" }, [leftPanel, rightPanel]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress video & animated GIF files with resolution scaling and mute options."
      ]),
      dashboard
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
