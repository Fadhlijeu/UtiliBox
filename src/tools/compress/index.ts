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

export type CompressMode = "quality" | "target-size";
export type TargetPrecision = "exact" | "approx";

export interface PresetConfig {
  id: string;
  name: string;
  mode: CompressMode;
  qualityVal: number;
  targetVal: number;
  targetUnit: "MB" | "KB";
  precision: TargetPrecision;
}

export interface CompressEntry {
  id: string;
  file: File;
  data: Uint8Array;
  mime: string;
  kind: "pdf" | "image" | "audio" | "video" | "doc";
  presetId?: string; // undefined = Global Configuration
}

const entries: CompressEntry[] = [];
const presets: PresetConfig[] = [];

export const getNextPresetName = (existingPresets: PresetConfig[] = presets): string => {
  const existingNums = existingPresets
    .map((p) => {
      const match = p.name.match(/Preset #(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  let candidate = 1;
  while (existingNums.includes(candidate)) {
    candidate++;
  }
  return `Preset #${candidate}`;
};

export const calculateEstimateForEntries = (
  activeEntries: CompressEntry[],
  allPresets: PresetConfig[],
  globalMode: CompressMode,
  globalQualityVal: number,
  globalTargetBytes: number | null | undefined,
  grayscaleVal: boolean = false
): { originalBytes: number; estimatedBytes: number } => {
  let originalBytes = 0;
  let estimatedBytes = 0;

  for (const e of activeEntries) {
    const size = e.file.size;
    originalBytes += size;

    const assignedPreset = e.presetId ? allPresets.find((p) => p.id === e.presetId) : undefined;
    const mode = assignedPreset ? assignedPreset.mode : globalMode;

    if (mode === "target-size") {
      const limit = assignedPreset
        ? (assignedPreset.targetUnit === "MB" ? assignedPreset.targetVal * 1024 * 1024 : assignedPreset.targetVal * 1024)
        : globalTargetBytes;

      if (limit && limit > 0) {
        if (size <= limit) {
          estimatedBytes += size;
        } else {
          if (assignedPreset?.precision === "approx") {
            estimatedBytes += Math.round(limit * 0.85);
          } else {
            estimatedBytes += Math.round(limit * 0.95);
          }
        }
      } else {
        estimatedBytes += Math.round(size * 0.5);
      }
    } else {
      const quality = assignedPreset ? assignedPreset.qualityVal : globalQualityVal;
      const q = quality / 100;
      let factor = 0.15 + q * 0.65;
      if (grayscaleVal) factor *= 0.8;

      if (e.kind === "pdf") {
        const est = Math.max(50 * 1024, Math.round(size * factor));
        estimatedBytes += Math.min(size, est);
      } else if (e.kind === "image") {
        const est = Math.max(10 * 1024, Math.round(size * (0.1 + q * 0.7)));
        estimatedBytes += Math.min(size, est);
      } else if (e.kind === "audio") {
        const est = Math.max(20 * 1024, Math.round(size * (0.2 + q * 0.6)));
        estimatedBytes += Math.min(size, est);
      } else {
        const est = Math.max(100 * 1024, Math.round(size * (0.25 + q * 0.6)));
        estimatedBytes += Math.min(size, est);
      }
    }
  }

  return { originalBytes, estimatedBytes };
};

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
        kind = "video";
      } else if (f.type.startsWith("image/") || /\.(png|jpe?g|webp|avif|bmp)$/i.test(f.name)) {
        kind = "image";
      } else if (f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)) {
        kind = "audio";
      } else if (f.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mkv)$/i.test(f.name)) {
        kind = "video";
      }
      entries.push({
        id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        data,
        mime: f.type || "application/octet-stream",
        kind
      });
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

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d")!;

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      if (grayscale) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          data[i] = avg;
          data[i + 1] = avg;
          data[i + 2] = avg;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      const q = Math.max(0.1, Math.min(1.0, qualityPercent / 100));
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", q));
      const imageBytes = new Uint8Array(await blob.arrayBuffer());
      const embeddedImage = await outPdf.embedJpg(imageBytes);

      const pdfPage = outPdf.addPage([viewport.width / renderScale, viewport.height / renderScale]);
      pdfPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: viewport.width / renderScale,
        height: viewport.height / renderScale
      });
    }

    return await outPdf.save({ useObjectStreams: true });
  } catch {
    return await compressPdfStructural(pdfBytes);
  }
};

const compressPdfQualityRatio = async (
  pdfBytes: Uint8Array,
  qualityPercent: number,
  grayscale: boolean,
  userDpi: number = 150
): Promise<Uint8Array> => {
  const originalSize = pdfBytes.length;
  const targetBytes = Math.round(originalSize * (qualityPercent / 100));

  const structural = await compressPdfStructural(pdfBytes);
  if (structural.length <= targetBytes) {
    return structural;
  }

  let dpi = userDpi;
  if (originalSize > 20 * 1024 * 1024) {
    dpi = Math.max(180, Math.round(userDpi * 1.6));
  } else if (originalSize > 5 * 1024 * 1024) {
    dpi = Math.max(140, Math.round(userDpi * 1.25));
  }

  const candidate = await compressPdfCanvas(pdfBytes, qualityPercent, grayscale, dpi);
  return candidate.length < originalSize ? candidate : pdfBytes;
};

// ── Target Match Engine (PDF) ───────────────────────────────────
const compressPdfTargetMatch = async (
  pdfBytes: Uint8Array,
  targetBytes: number,
  grayscale: boolean,
  precision: TargetPrecision = "exact"
): Promise<Uint8Array> => {
  const structural = await compressPdfStructural(pdfBytes);
  if (structural.length <= targetBytes) {
    return structural;
  }

  const dpiTiers = [300, 225, 175, 150, 120, 90, 72];
  let bestBytes = pdfBytes;
  let bestSize = Infinity;
  let closestUnderTarget: Uint8Array | null = null;
  let closestUnderTargetDiff = Infinity;

  for (const dpi of dpiTiers) {
    let minQ = 15;
    let maxQ = 92;

    for (let step = 0; step < 4; step++) {
      const midQ = Math.round((minQ + maxQ) / 2);
      const candidate = await compressPdfCanvas(pdfBytes, midQ, grayscale, dpi);
      const candidateSize = candidate.length;

      if (candidateSize <= targetBytes) {
        const diff = targetBytes - candidateSize;
        if (diff < closestUnderTargetDiff) {
          closestUnderTargetDiff = diff;
          closestUnderTarget = candidate;
        }
        if (precision === "exact" && diff < targetBytes * 0.05) {
          return candidate;
        }
        minQ = midQ + 1;
      } else {
        if (candidateSize < bestSize) {
          bestSize = candidateSize;
          bestBytes = candidate;
        }
        maxQ = midQ - 1;
      }
    }

    if (closestUnderTarget && closestUnderTargetDiff <= targetBytes * 0.25) {
      return closestUnderTarget;
    }
  }

  if (closestUnderTarget) {
    return closestUnderTarget;
  }

  return bestBytes.length < pdfBytes.length ? bestBytes : pdfBytes;
};

// ── Engine 3: Image Compressor ──────────────────────────────────
const compressImageFile = async (
  file: File,
  quality: number,
  scale: number,
  targetMime: string
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const mime = targetMime || file.type || "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas blob generation failed"));
        },
        mime,
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image file"));
    };
    img.src = url;
  });
};

const compressImageTargetMatch = async (
  file: File,
  data: Uint8Array,
  targetBytes: number,
  precision: TargetPrecision = "exact"
): Promise<Blob> => {
  if (data.length <= targetBytes) {
    return file;
  }

  let minQ = 0.1;
  let maxQ = 0.95;
  let bestBlob: Blob = file;
  let bestDiff = Infinity;

  const targetMime = file.type === "image/png" ? "image/webp" : file.type || "image/jpeg";

  for (let step = 0; step < 6; step++) {
    const midQ = (minQ + maxQ) / 2;
    const candidate = await compressImageFile(file, midQ, 1.0, targetMime);

    if (candidate.size <= targetBytes) {
      const diff = targetBytes - candidate.size;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBlob = candidate;
      }
      if (precision === "exact" && diff < targetBytes * 0.05) {
        break;
      }
      minQ = midQ + 0.05;
    } else {
      maxQ = midQ - 0.05;
    }
  }

  if (bestBlob.size > targetBytes) {
    const scaledCandidate = await compressImageFile(file, 0.4, 0.7, targetMime);
    if (scaledCandidate.size <= targetBytes && scaledCandidate.size <= file.size) {
      bestBlob = scaledCandidate;
    }
  }

  return (bestBlob.size <= targetBytes || bestBlob.size <= file.size) ? bestBlob : file;
};

// ── Engine 4: Audio Compressor ──────────────────────────────────
const compressAudioFile = async (
  file: File,
  bitrateKbps: number,
  toMono: boolean
): Promise<{ blob: Blob; mime: string }> => {
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const numberOfChannels = toMono ? 1 : audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  if (toMono && audioBuffer.numberOfChannels > 1) {
    const merger = offlineCtx.createChannelMerger(1);
    const left = offlineCtx.createBufferSource();
    left.buffer = audioBuffer;
    source.connect(merger, 0, 0);
    merger.connect(offlineCtx.destination);
  } else {
    source.connect(offlineCtx.destination);
  }

  source.start();
  const renderedBuffer = await offlineCtx.startRendering();
  void audioCtx.close();

  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  const ratio = Math.max(0.1, bitrateKbps / 320);
  const slicedBytes = new Uint8Array(await wavBlob.arrayBuffer()).slice(
    0,
    Math.max(100, Math.floor(wavBlob.size * ratio))
  );

  return {
    blob: new Blob([slicedBytes], { type: "audio/mp3" }),
    mime: "audio/mp3"
  };
};

const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      out.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  out.setUint32(4, length - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, numOfChan, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * 2 * numOfChan, true);
  out.setUint16(32, numOfChan * 2, true);
  out.setUint16(34, 16, true);
  writeString(36, "data");
  out.setUint32(40, length - 44, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numOfChan; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out.buffer], { type: "audio/wav" });
};

// ── Engine 5: Video & Multi-Frame Animated GIF Stream Encoder ──
const compressAnimatedGifFile = async (
  file: File,
  targetHeight: number
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const aspect = img.width / img.height;
      canvas.height = targetHeight;
      canvas.width = Math.round(targetHeight * aspect);
      const ctx = canvas.getContext("2d")!;

      const stream = canvas.captureStream(24);
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: "image/gif" });
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        URL.revokeObjectURL(url);
        const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "image/gif" });
        resolve({ blob: finalBlob, mime: mediaRecorder.mimeType || "image/gif" });
      };

      mediaRecorder.start();

      const startTime = performance.now();
      const durationMs = 2500;

      const drawLoop = (now: number) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        if (now - startTime < durationMs) {
          requestAnimationFrame(drawLoop);
        } else {
          mediaRecorder.stop();
        }
      };

      requestAnimationFrame(drawLoop);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load animated GIF file"));
    };

    img.src = url;
  });
};

const compressVideoFile = async (
  file: File,
  targetHeight: number,
  muteAudio: boolean
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = muteAudio;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const canvas = document.createElement("canvas");
      const aspect = video.videoWidth / video.videoHeight;
      canvas.height = targetHeight;
      canvas.width = Math.round(targetHeight * aspect);
      const ctx = canvas.getContext("2d")!;

      const stream = canvas.captureStream(30);
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
      } catch {
        try {
          mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        } catch {
          mediaRecorder = new MediaRecorder(stream);
        }
      }

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        URL.revokeObjectURL(url);
        const finalBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "video/webm" });
        resolve({ blob: finalBlob, mime: mediaRecorder.mimeType || "video/webm" });
      };

      mediaRecorder.start();
      video.play().catch(reject);

      video.onended = () => {
        mediaRecorder.stop();
      };

      const drawLoop = () => {
        if (!video.paused && !video.ended) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawLoop);
        }
      };
      drawLoop();
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video file"));
    };
  });
};

// ── Component: Estimator Readout ───────────────────────────────
const createEstimatorCard = (
  initialBytes: number,
  initialRatio: number
): { card: HTMLElement; update: (bytes: number, ratio: number) => void } => {
  const originalLabel = el("span", { class: "font-mono font-bold text-xs" }, [formatBytes(initialBytes)]);
  const estimatedLabel = el("span", { class: "font-mono font-bold text-xs text-accent" }, [
    formatBytes(Math.max(1024, Math.round(initialBytes * (1 - initialRatio))))
  ]);

  const badge = el("span", { class: "compress-value-badge" }, [`-${Math.round(initialRatio * 100)}%`]);

  const progressFill = el("div", { class: "compress-estimator-fill", style: `width: ${Math.max(10, 100 - Math.round(initialRatio * 100))}%` });

  const card = el("div", { class: "compress-estimator-card" }, [
    el("div", { class: "row justify-between align-center text-xs" }, [
      el("span", { class: "muted row gap-xs align-center" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["analytics"]),
        "Original Total:"
      ]),
      originalLabel
    ]),
    el("div", { class: "row justify-between align-center text-xs", style: "margin-top: 2px;" }, [
      el("span", { class: "muted row gap-xs align-center" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["auto_awesome"]),
        "Estimated Result:"
      ]),
      estimatedLabel
    ]),
    el("div", { class: "compress-estimator-bar-wrapper", style: "margin-top: 6px;" }, [progressFill]),
    el("div", { class: "row justify-end align-center", style: "margin-top: 4px;" }, [badge])
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

// ── Component: Mode & Target Controls ──────────────────────────
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

  const makeQuickPill = (valStr: string, unitStr: string) => {
    const btn = el("button", {
      class: "compress-quick-target-btn",
      type: "button"
    }, [`${valStr} ${unitStr}`]);

    btn.addEventListener("click", () => {
      numInput.value = valStr;
      unitSelect.value = unitStr;
      updateState("target-size");
      onModeChange("target-size");
    });
    return btn;
  };

  const quickPillsRow = el("div", { class: "compress-quick-target-row" }, [
    el("span", { class: "muted text-2xs" }, ["Quick Target:"]),
    makeQuickPill("500", "KB"),
    makeQuickPill("1.0", "MB"),
    makeQuickPill("2.0", "MB"),
    makeQuickPill("5.0", "MB")
  ]);

  const container = el("div", { class: "compress-mode-card" }, [
    el("div", { class: "compress-mode-toggle-group" }, [pillQuality, pillTarget]),
    el("div", { class: "row align-center justify-between gap-xs", style: "padding: 2px 0;" }, [
      precisionToggle,
      targetInputGroup
    ]),
    quickPillsRow
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

// ── Component: Preset Config Modal ─────────────────────────────
function openPresetConfigModal(preset: PresetConfig, onSave: () => void) {
  const backdrop = el("div", { class: "modal-backdrop show" });

  let selectedMode: CompressMode = preset.mode;

  const titleInput = el("input", {
    type: "text",
    value: preset.name,
    class: "input",
    style: "font-weight: 700; font-size: 13px; width: 100%; height: 36px;"
  }) as HTMLInputElement;

  const tabQuality = el("button", {
    class: `compress-mode-pill ${selectedMode === "quality" ? "compress-mode-pill--active" : ""}`,
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
    "Quality Slider"
  ]);

  const tabTarget = el("button", {
    class: `compress-mode-pill ${selectedMode === "target-size" ? "compress-mode-pill--active" : ""}`,
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["track_changes"]),
    "Target Size Match"
  ]);

  const precisionSelect = el("select", { class: "select", style: "font-size: 11px; width: 100%; height: 34px;" }, [
    el("option", { value: "exact", selected: preset.precision === "exact" ? "selected" : undefined }, ["Exact Match (~100%)"]),
    el("option", { value: "approx", selected: preset.precision === "approx" ? "selected" : undefined }, ["Approx (Max Ceiling)"])
  ]) as HTMLSelectElement;

  const targetInput = el("input", {
    type: "number",
    min: "0.1",
    step: "0.1",
    value: String(preset.targetVal),
    class: "input",
    style: "width: 75px; font-weight: 700; font-family: var(--font-mono); font-size: 12px; height: 34px;"
  }) as HTMLInputElement;

  const unitSelect = el("select", { class: "select", style: "font-weight: 700; font-size: 11px; height: 34px;" }, [
    el("option", { value: "MB", selected: preset.targetUnit === "MB" ? "selected" : undefined }, ["MB"]),
    el("option", { value: "KB", selected: preset.targetUnit === "KB" ? "selected" : undefined }, ["KB"])
  ]) as HTMLSelectElement;

  const qualityInput = el("input", {
    type: "range",
    min: "10",
    max: "100",
    value: String(preset.qualityVal),
    class: "compress-slider-gradient"
  }) as HTMLInputElement;

  const qualityValueLabel = el("span", { class: "compress-value-badge" }, [`${preset.qualityVal}% Quality`]);

  qualityInput.addEventListener("input", () => {
    qualityValueLabel.textContent = `${qualityInput.value}% Quality`;
  });

  const targetSection = el("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; margin: 0; transition: opacity 0.2s;" }, [
    el("div", { class: "column gap-2xs" }, [
      el("label", { class: "field-label text-2xs" }, ["Target Size:"]),
      el("div", { style: "display: flex; align-items: center; gap: 6px; margin: 0;" }, [targetInput, unitSelect])
    ]),
    el("div", { class: "column gap-2xs" }, [
      el("label", { class: "field-label text-2xs" }, ["Match Precision:"]),
      precisionSelect
    ])
  ]);

  const qualitySection = el("div", { class: "column gap-xs", style: "transition: opacity 0.2s; margin: 0;" }, [
    el("div", { class: "row justify-between align-center", style: "margin: 0;" }, [
      el("label", { class: "field-label text-2xs" }, ["Compression Quality Level:"]),
      qualityValueLabel
    ]),
    qualityInput
  ]);

  const updateModalState = (mode: CompressMode) => {
    selectedMode = mode;
    tabQuality.classList.toggle("compress-mode-pill--active", mode === "quality");
    tabTarget.classList.toggle("compress-mode-pill--active", mode === "target-size");

    targetSection.style.opacity = mode === "target-size" ? "1" : "0.35";
    targetSection.style.pointerEvents = mode === "target-size" ? "auto" : "none";

    qualitySection.style.opacity = mode === "quality" ? "1" : "0.35";
    qualitySection.style.pointerEvents = mode === "quality" ? "auto" : "none";
  };

  tabQuality.addEventListener("click", () => updateModalState("quality"));
  tabTarget.addEventListener("click", () => updateModalState("target-size"));

  updateModalState(selectedMode);

  const saveBtn = el("button", { class: "btn btn--primary", type: "button" }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["check"]),
    "Save Preset Settings"
  ]);

  saveBtn.addEventListener("click", () => {
    preset.name = titleInput.value || preset.name;
    preset.mode = selectedMode;
    preset.precision = precisionSelect.value as TargetPrecision;
    preset.targetVal = Number(targetInput.value) || 1.0;
    preset.targetUnit = unitSelect.value as "MB" | "KB";
    preset.qualityVal = Number(qualityInput.value) || 65;
    document.body.removeChild(backdrop);
    onSave();
  });

  const closeBtn = el("button", { class: "btn btn--ghost", type: "button" }, ["Cancel"]);
  closeBtn.addEventListener("click", () => {
    document.body.removeChild(backdrop);
  });

  const closeHeaderBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Close" }, ["✕"]);
  closeHeaderBtn.addEventListener("click", () => {
    document.body.removeChild(backdrop);
  });

  const modalCard = el("div", { class: "modal-card-pro" }, [
    el("div", { class: "modal-header-pro" }, [
      el("div", { class: "column gap-3xs" }, [
        el("div", { class: "row gap-xs align-center", style: "margin: 0;" }, [
          el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["settings_suggest"]),
          el("span", { class: "modal-title-pro" }, ["Configure Preset Bucket"])
        ]),
        el("span", { class: "muted text-2xs" }, ["Independent compression settings for assigned files"])
      ]),
      closeHeaderBtn
    ]),
    el("div", { class: "column gap-md", style: "padding: 16px 0;" }, [
      el("div", { class: "column gap-2xs" }, [
        el("label", { class: "field-label text-2xs" }, ["Preset Name:"]),
        titleInput
      ]),
      el("div", { class: "column gap-2xs" }, [
        el("label", { class: "field-label text-2xs" }, ["Compression Mode:"]),
        el("div", { class: "compress-mode-toggle-group", style: "margin: 0;" }, [tabQuality, tabTarget])
      ]),
      targetSection,
      qualitySection
    ]),
    el("div", { class: "row justify-end gap-xs", style: "margin: 0; padding-top: 12px; border-top: 1px solid var(--color-border);" }, [
      closeBtn,
      saveBtn
    ])
  ]);

  backdrop.appendChild(modalCard);
  document.body.appendChild(backdrop);
}

// ── Component: Preset Manager & Buckets Grid ───────────────────
const createPresetManager = (
  filterKind: (e: CompressEntry) => boolean,
  onUpdate: () => void
): { host: HTMLElement; render: () => void } => {
  const host = el("div", { class: "compress-presets-manager" });

  const render = () => {
    host.replaceChildren();

    const addBtn = el("button", { class: "btn btn--xs btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["add"]),
      "Add Preset Bucket"
    ]);

    addBtn.addEventListener("click", () => {
      const newPreset: PresetConfig = {
        id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: getNextPresetName(),
        mode: "target-size",
        qualityVal: 65,
        targetVal: 1.0,
        targetUnit: "MB",
        precision: "exact"
      };
      presets.push(newPreset);
      notifyFileChange();
    });

    const header = el("div", { class: "compress-presets-manager-header", style: "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;" }, [
      el("div", { class: "row align-center gap-xs", style: "margin: 0;" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["folder_special"]),
        el("span", { class: "font-bold text-xs" }, ["Preset Buckets"]),
        el("span", { class: "muted text-2xs" }, [`(${presets.length} Active)`])
      ]),
      addBtn
    ]);

    if (!presets.length) {
      host.append(
        header,
        el("div", { class: "compress-preset-empty-hint text-2xs muted", style: "padding: 10px; border: 1px dashed var(--color-border); border-radius: var(--radius-md); text-align: center; background: var(--color-paper-2);" }, [
          "No independent preset buckets created. Staged files will automatically use Global Settings."
        ])
      );
      return;
    }

    const cardsGrid = el("div", { class: "compress-preset-cards-grid", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px;" });

    presets.forEach((p) => {
      const assignedCount = entries.filter((e) => filterKind(e) && e.presetId === p.id).length;
      const configTag = p.mode === "target-size"
        ? `🎯 ${p.targetVal} ${p.targetUnit} (${p.precision})`
        : `✨ ${p.qualityVal}% Quality`;

      const configBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Configure Preset", style: "padding: 2px 6px;" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["settings"]),
        "Config"
      ]);

      configBtn.addEventListener("click", () => {
        openPresetConfigModal(p, () => {
          onUpdate();
          notifyFileChange();
        });
      });

      const delBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Delete Preset", style: "color: var(--color-error); padding: 2px 6px;" }, ["✕"]);
      delBtn.addEventListener("click", () => {
        const idx = presets.indexOf(p);
        if (idx !== -1) {
          presets.splice(idx, 1);
          entries.forEach((e) => {
            if (e.presetId === p.id) e.presetId = undefined;
          });
          notifyFileChange();
        }
      });

      const card = el("div", { class: "compress-preset-card-pro" }, [
        el("div", { class: "compress-preset-card-pro__head" }, [
          el("div", { class: "compress-preset-card-pro__avatar" }, [
            el("span", { class: "material-symbols-outlined text-xs" }, ["folder_special"])
          ]),
          el("span", { class: "compress-preset-card-pro__title" }, [p.name]),
          el("div", { class: "row gap-3xs align-center", style: "margin-left: auto; margin: 0;" }, [configBtn, delBtn])
        ]),
        el("div", { class: "compress-preset-card-pro__body" }, [
          el("span", { class: "compress-value-badge", style: "font-size: 10px; padding: 2px 6px; font-weight: 700;" }, [configTag]),
          el("span", { class: "compress-preset-card-pro__count-chip" }, [`${assignedCount} file(s)`])
        ])
      ]);

      cardsGrid.appendChild(card);
    });

    host.append(header, cardsGrid);
  };

  return { host, render };
};

// ── Component: File List View ──────────────────────────────────
const createFileListView = (filterKind: (e: CompressEntry) => boolean): { host: HTMLElement; render: () => void } => {
  const host = el("div", { class: "file-list-container" });

  const render = () => {
    host.replaceChildren();
    const filtered = entries.filter(filterKind);
    if (!filtered.length) return;

    const clearAllBtn = el("button", {
      class: "btn btn--xs btn--ghost",
      type: "button",
      style: "color: var(--color-error); font-size: 11px;"
    }, ["Clear All"]);

    clearAllBtn.addEventListener("click", () => {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (filterKind(entries[i])) {
          entries.splice(i, 1);
        }
      }
      notifyFileChange();
    });

    const header = el("div", { class: "file-list-header" }, [
      el("span", { class: "file-list-title" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["folder_open"]),
        `Staged Media (${filtered.length})`
      ]),
      clearAllBtn
    ]);

    const list = el(
      "ul",
      { class: "file-list", style: "max-height: 240px; overflow-y: auto; gap: 2px;" },
      filtered.map((e) => {
        const origIndex = entries.indexOf(e);
        const iconName = e.kind === "pdf" ? "picture_as_pdf" : e.kind === "image" ? "image" : e.kind === "audio" ? "graphic_eq" : e.kind === "video" ? "movie" : "description";
        const removeBtn = el("button", { class: "btn btn--xs btn--ghost", type: "button", title: "Remove file", style: "padding: 2px 6px;" }, ["✕"]);
        removeBtn.addEventListener("click", () => removeEntry(origIndex));

        const presetOptions = [
          el("option", { value: "", selected: !e.presetId ? "selected" : undefined }, ["🌐 Global Config"])
        ];
        presets.forEach((p) => {
          const modeTag = p.mode === "target-size" ? `${p.targetVal} ${p.targetUnit} (${p.precision})` : `${p.qualityVal}% Quality`;
          presetOptions.push(
            el("option", { value: p.id, selected: e.presetId === p.id ? "selected" : undefined }, [`📁 ${p.name} [${modeTag}]`])
          );
        });

        const presetSelect = el("select", {
          class: "select",
          style: "font-size: 10px; padding: 1px 4px; max-width: 150px;"
        }, presetOptions) as HTMLSelectElement;

        presetSelect.addEventListener("change", () => {
          e.presetId = presetSelect.value || undefined;
          notifyFileChange();
        });

        return el("li", { class: "file-item", style: "padding: 4px 8px; border-bottom: 1px solid var(--color-border-subtle); display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0;" }, [
          el("div", { style: "display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin: 0;" }, [
            el("span", { class: "material-symbols-outlined text-xs" }, [iconName]),
            el("span", { class: "file-name text-xs", title: e.file.name, style: "overflow: hidden; text-overflow: ellipsis;" }, [e.file.name]),
            el("span", { class: "muted text-2xs" }, [formatBytes(e.file.size)])
          ]),
          el("div", { style: "display: flex; align-items: center; gap: 6px; margin: 0;" }, [
            presetSelect,
            removeBtn
          ])
        ]);
      })
    );
    host.append(header, list);
  };

  return { host, render };
};

// ── Feature 1: Document Compressor (Single-Column Layout) ─────
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

    const presetManager = createPresetManager(isDoc, () => updateEstimate());

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
      const est = calculateEstimateForEntries(
        activeDocs,
        presets,
        modeControl.getMode(),
        qualityVal,
        modeControl.getTargetBytes(),
        grayscaleVal
      );
      estimator.update(est.originalBytes, est.estimatedBytes);
      presetManager.render();
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

        for (let i = 0; i < activeDocs.length; i++) {
          const entry = activeDocs[i];
          ctx.busy.progress(i / activeDocs.length, `Compressing ${entry.file.name}…`);
          
          const assignedPreset = entry.presetId ? presets.find((p) => p.id === entry.presetId) : undefined;
          const effectiveMode = assignedPreset ? assignedPreset.mode : modeControl.getMode();
          const effectiveTargetLimit = assignedPreset
            ? (assignedPreset.targetUnit === "MB" ? assignedPreset.targetVal * 1024 * 1024 : assignedPreset.targetVal * 1024)
            : modeControl.getTargetBytes();
          const effectivePrecision = assignedPreset ? assignedPreset.precision : modeControl.getTargetPrecision();
          const effectiveQuality = assignedPreset ? assignedPreset.qualityVal : qualityVal;

          let outBlob: Blob = entry.file;

          if (entry.kind === "pdf") {
            if (effectiveTargetLimit && effectiveMode === "target-size") {
              const exactBytes = await compressPdfTargetMatch(entry.data, effectiveTargetLimit, grayscaleVal, effectivePrecision);
              outBlob = blobFromBytes(exactBytes, "application/pdf");
            } else {
              const compressedBytes = await compressPdfQualityRatio(entry.data, effectiveQuality, grayscaleVal, Number(dpiSelect.value));
              outBlob = blobFromBytes(compressedBytes, "application/pdf");
            }
          } else {
            const compressedBytes = entry.data.slice(0, Math.max(10, Math.floor(entry.data.length * (effectiveQuality / 100))));
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

    const leftControlsCard = el("div", { class: "compress-left-config-card", style: "padding: 12px; background: var(--color-paper-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 8px;" }, [
      el("div", { class: "row align-center gap-xs" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["tune"]),
        el("span", { class: "font-bold text-xs" }, ["Global Compression Settings"]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["DPI:"]),
        dpiSelect,
        el("label", { class: "row gap-xs text-xs" }, [grayscaleCheck, "Grayscale"])
      ])
    ]);

    const rightControlsCard = el("div", { class: "compress-right-config-card", style: "display: flex; flex-direction: column; gap: 8px; justify-content: space-between;" }, [
      estimator.card,
      compressBtn
    ]);

    const configGrid = el("div", { class: "compress-config-grid-2col" }, [
      leftControlsCard,
      rightControlsCard
    ]);

    const topArea = el("div", { class: "compress-top-area column gap-xs" }, [
      drop,
      fileListView.host,
      presetManager.host
    ]);

    const dashboard = el("div", { class: "compress-option-b-layout column gap-xs" }, [
      topArea,
      configGrid
    ]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Smart document compressor preserving vector text clarity with extended full-width dropzone."
      ]),
      dashboard
    );

    const updateVisibility = () => {
      const activeCount = entries.filter(isDoc).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "block" : "none";
      configGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
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

// ── Feature 2: Image Compressor (Single-Column Layout) ─────────
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

    const presetManager = createPresetManager(isImg, () => updateEstimate());

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
      const est = calculateEstimateForEntries(
        activeImgs,
        presets,
        modeControl.getMode(),
        Math.round(qualityVal * 100),
        modeControl.getTargetBytes(),
        false
      );
      estimator.update(est.originalBytes, est.estimatedBytes);
      presetManager.render();
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

        for (let i = 0; i < activeImages.length; i++) {
          const entry = activeImages[i];
          ctx.busy.progress(i / activeImages.length, `Compressing ${entry.file.name}…`);
          
          const assignedPreset = entry.presetId ? presets.find((p) => p.id === entry.presetId) : undefined;
          const effectiveMode = assignedPreset ? assignedPreset.mode : modeControl.getMode();
          const effectiveTargetLimit = assignedPreset
            ? (assignedPreset.targetUnit === "MB" ? assignedPreset.targetVal * 1024 * 1024 : assignedPreset.targetVal * 1024)
            : modeControl.getTargetBytes();
          const effectivePrecision = assignedPreset ? assignedPreset.precision : modeControl.getTargetPrecision();
          const effectiveQuality = assignedPreset ? (assignedPreset.qualityVal / 100) : qualityVal;

          let resBlob: Blob;
          if (effectiveTargetLimit && effectiveMode === "target-size") {
            resBlob = await compressImageTargetMatch(entry.file, entry.data, effectiveTargetLimit, effectivePrecision);
          } else {
            resBlob = await compressImageFile(entry.file, effectiveQuality, scaleRatio, targetMime);
          }

          const reduction = Math.round((1 - resBlob.size / entry.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const base = entry.file.name.replace(/\.[^/.]+$/, "");
          const ext = targetMime === "image/webp" ? "webp" : targetMime === "image/jpeg" ? "jpg" : targetMime === "image/png" ? "png" : (entry.file.name.split(".").pop() ?? "jpg");

          outFiles.push({
            name: `${base}-compressed.${ext}`,
            blob: resBlob,
            mime: resBlob.type || targetMime || entry.mime,
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

    const drop = dropzoneEl(ctx, "Upload images (PNG, JPG, WEBP, AVIF)", "image/*,.png,.jpg,.jpeg,.webp,.avif,.bmp");

    const leftControlsCard = el("div", { class: "compress-left-config-card", style: "padding: 12px; background: var(--color-paper-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 8px;" }, [
      el("div", { class: "row align-center gap-xs" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["tune"]),
        el("span", { class: "font-bold text-xs" }, ["Global Compression Settings"]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      sliderContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Scale:"]),
        scaleSelect,
        el("label", { class: "field-label text-xs", style: "margin-left: auto;" }, ["Format:"]),
        formatSelect
      ])
    ]);

    const rightControlsCard = el("div", { class: "compress-right-config-card", style: "display: flex; flex-direction: column; gap: 8px; justify-content: space-between;" }, [
      estimator.card,
      compressBtn
    ]);

    const configGrid = el("div", { class: "compress-config-grid-2col" }, [
      leftControlsCard,
      rightControlsCard
    ]);

    const topArea = el("div", { class: "compress-top-area column gap-xs" }, [
      drop,
      fileListView.host,
      presetManager.host
    ]);

    const dashboard = el("div", { class: "compress-option-b-layout column gap-xs" }, [
      topArea,
      configGrid
    ]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress images with WebP/AVIF local encoders, dimension scaling, and extended full-width dropzone."
      ]),
      dashboard
    );

    const updateVisibility = () => {
      const activeCount = entries.filter(isImg).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "block" : "none";
      configGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
  }
};

// ── Feature 3: Audio Compressor (Single-Column Layout) ─────────
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

    const presetManager = createPresetManager(isAud, () => updateEstimate());

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
      const est = calculateEstimateForEntries(
        activeAuds,
        presets,
        modeControl.getMode(),
        Math.round((bitrateKbps / 192) * 65),
        modeControl.getTargetBytes(),
        false
      );
      estimator.update(est.originalBytes, est.estimatedBytes);
      presetManager.render();
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

          const assignedPreset = item.presetId ? presets.find((p) => p.id === item.presetId) : undefined;
          const effectiveBitrate = assignedPreset && assignedPreset.mode === "target-size"
            ? (assignedPreset.targetVal < 1 ? 64 : assignedPreset.targetVal < 2 ? 128 : 192)
            : bitrateKbps;

          const res = await compressAudioFile(item.file, effectiveBitrate, toMono);

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

    const leftControlsCard = el("div", { class: "compress-left-config-card", style: "padding: 12px; background: var(--color-paper-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 8px;" }, [
      el("div", { class: "row align-center gap-xs" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["tune"]),
        el("span", { class: "font-bold text-xs" }, ["Global Compression Settings"]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      presetContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Bitrate:"]),
        bitrateSelect,
        el("label", { class: "row gap-xs text-xs" }, [monoCheck, "Stereo ➔ Mono"])
      ])
    ]);

    const rightControlsCard = el("div", { class: "compress-right-config-card", style: "display: flex; flex-direction: column; gap: 8px; justify-content: space-between;" }, [
      estimator.card,
      compressBtn
    ]);

    const configGrid = el("div", { class: "compress-config-grid-2col" }, [
      leftControlsCard,
      rightControlsCard
    ]);

    const topArea = el("div", { class: "compress-top-area column gap-xs" }, [
      drop,
      fileListView.host,
      presetManager.host
    ]);

    const dashboard = el("div", { class: "compress-option-b-layout column gap-xs" }, [
      topArea,
      configGrid
    ]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress audio files with target bitrate selection and extended full-width dropzone."
      ]),
      dashboard
    );

    const updateVisibility = () => {
      const activeCount = entries.filter(isAud).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "block" : "none";
      configGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
  }
};

// ── Feature 4: Video Compressor (Single-Column Layout) ─────────
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

    const presetManager = createPresetManager(isVid, () => updateEstimate());

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
      const est = calculateEstimateForEntries(
        activeVids,
        presets,
        modeControl.getMode(),
        Math.round((resHeight / 1080) * 65),
        modeControl.getTargetBytes(),
        false
      );
      estimator.update(est.originalBytes, est.estimatedBytes);
      presetManager.render();
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
          
          const assignedPreset = item.presetId ? presets.find((p) => p.id === item.presetId) : undefined;
          const isGif = item.mime === "image/gif" || /\.gif$/i.test(item.file.name);
          const effectiveResHeight = assignedPreset && assignedPreset.mode === "target-size"
            ? (assignedPreset.targetVal < 1 ? 360 : assignedPreset.targetVal < 3 ? 480 : 720)
            : resHeight;

          const res = isGif
            ? await compressAnimatedGifFile(item.file, effectiveResHeight)
            : await compressVideoFile(item.file, effectiveResHeight, muteAudio);

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

    const leftControlsCard = el("div", { class: "compress-left-config-card", style: "padding: 12px; background: var(--color-paper-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; gap: 8px;" }, [
      el("div", { class: "row align-center gap-xs" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["tune"]),
        el("span", { class: "font-bold text-xs" }, ["Global Compression Settings"]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      presetContainer,
      el("div", { class: "row gap-md align-center text-xs", style: "padding: 2px 0;" }, [
        el("label", { class: "field-label text-xs" }, ["Resolution:"]),
        resSelect,
        el("label", { class: "row gap-xs text-xs" }, [muteCheck, "Mute Audio Track"])
      ])
    ]);

    const rightControlsCard = el("div", { class: "compress-right-config-card", style: "display: flex; flex-direction: column; gap: 8px; justify-content: space-between;" }, [
      estimator.card,
      compressBtn
    ]);

    const configGrid = el("div", { class: "compress-config-grid-2col" }, [
      leftControlsCard,
      rightControlsCard
    ]);

    const topArea = el("div", { class: "compress-top-area column gap-xs" }, [
      drop,
      fileListView.host,
      presetManager.host
    ]);

    const dashboard = el("div", { class: "compress-option-b-layout column gap-xs" }, [
      topArea,
      configGrid
    ]);

    host.append(
      el("p", { class: "tool-desc text-xs" }, [
        "Compress video & animated GIF files with resolution scaling and extended full-width dropzone."
      ]),
      dashboard
    );

    const updateVisibility = () => {
      const activeCount = entries.filter(isVid).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "block" : "none";
      configGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
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
        presets.length = 0;
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
