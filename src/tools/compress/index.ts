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
export type BatchTargetStrategy = "per-file" | "proportional";

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

const fileExtension = (fileName: string, fallback = "bin"): string =>
  fileName.includes(".") ? fileName.split(".").pop() ?? fallback : fallback;

const baseName = (fileName: string): string => fileName.replace(/\.[^/.]+$/, "");

const safeDocumentBlob = (entry: CompressEntry): Blob =>
  new Blob([entry.data.slice()], { type: entry.mime || "application/octet-stream" });

export const calculateProportionalTarget = (
  fileSize: number,
  totalBatchSize: number,
  totalTargetBytes: number,
  strategy: BatchTargetStrategy = "per-file"
): number => {
  if (strategy === "per-file" || totalBatchSize <= 0 || totalTargetBytes <= 0) {
    return totalTargetBytes;
  }
  const shareRatio = fileSize / totalBatchSize;
  return Math.max(10 * 1024, Math.round(totalTargetBytes * shareRatio));
};

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
  grayscaleVal: boolean = false,
  targetStrategy: BatchTargetStrategy = "per-file"
): { originalBytes: number; estimatedBytes: number } => {
  let originalBytes = 0;
  let estimatedBytes = 0;
  const totalBatchSize = activeEntries.reduce((acc, e) => acc + e.file.size, 0);

  for (const e of activeEntries) {
    const size = e.file.size;
    originalBytes += size;

    const assignedPreset = e.presetId ? allPresets.find((p) => p.id === e.presetId) : undefined;
    const mode = assignedPreset ? assignedPreset.mode : globalMode;

    if (mode === "target-size") {
      const rawGlobalLimit = globalTargetBytes && globalTargetBytes > 0
        ? calculateProportionalTarget(size, totalBatchSize, globalTargetBytes, targetStrategy)
        : undefined;

      const limit = assignedPreset
        ? (assignedPreset.targetUnit === "MB" ? assignedPreset.targetVal * 1024 * 1024 : assignedPreset.targetVal * 1024)
        : rawGlobalLimit;

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
  dpi: number = 150,
  onProgress?: (pageNum: number, totalPages: number) => void
): Promise<Uint8Array> => {
  try {
    const pdfjs = await getPdfJs();
    const pdfDoc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
    const pageCount = pdfDoc.numPages;
    const outPdf = await PDFDocument.create();

    const renderScale = Math.max(1.0, dpi / 72);

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      if (onProgress) {
        try { onProgress(pageNum, pageCount); } catch { /* ignore */ }
      }
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;

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
      const blob: Blob = await new Promise((res, rej) => {
        canvas.toBlob((b) => {
          if (b) res(b);
          else rej(new Error("Canvas export failed"));
        }, "image/jpeg", q);
      });
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
  userDpi: number = 150,
  onProgress?: (pageNum: number, totalPages: number) => void
): Promise<Uint8Array> => {
  const originalSize = pdfBytes.length;
  const targetBytes = Math.round(originalSize * (qualityPercent / 100));

  const structural = await compressPdfStructural(pdfBytes);
  // If structural optimization alone achieved good reduction without rasterization
  if (structural.length <= targetBytes && structural.length < originalSize * 0.95 && structural.length >= 1024) {
    return structural;
  }

  let dpi = userDpi;
  if (originalSize > 20 * 1024 * 1024) {
    dpi = Math.max(180, Math.round(userDpi * 1.5));
  } else if (originalSize > 5 * 1024 * 1024) {
    dpi = Math.max(140, Math.round(userDpi * 1.2));
  }

  const candidate = await compressPdfCanvas(pdfBytes, qualityPercent, grayscale, dpi, onProgress);
  return candidate.length < originalSize ? candidate : (structural.length < originalSize ? structural : pdfBytes);
};

// ── Target Match Engine (PDF) ───────────────────────────────────
const compressPdfTargetMatch = async (
  pdfBytes: Uint8Array,
  targetBytes: number,
  grayscale: boolean,
  precision: TargetPrecision = "exact",
  onProgress?: (pageNum: number, totalPages: number) => void
): Promise<Uint8Array> => {
  const structural = await compressPdfStructural(pdfBytes);
  if (structural.length <= targetBytes && structural.length >= targetBytes * 0.8) {
    return structural;
  }

  const dpiTiers = [300, 225, 175, 150, 120, 90, 72];
  let bestBytes = structural.length < pdfBytes.length ? structural : pdfBytes;
  let bestSize = bestBytes.length;
  let closestUnderTarget: Uint8Array | null = null;
  let closestUnderTargetDiff = Infinity;

  for (const dpi of dpiTiers) {
    let minQ = 15;
    let maxQ = 92;

    for (let step = 0; step < 4; step++) {
      const midQ = Math.round((minQ + maxQ) / 2);
      const candidate = await compressPdfCanvas(pdfBytes, midQ, grayscale, dpi, onProgress);
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

// ── Engine 3: Image Compressor (Community-Standard Canvas Pipeline) ──
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
      let width = Math.max(1, Math.round(img.width * scale));
      let height = Math.max(1, Math.round(img.height * scale));

      // Community constraint: clamp maximum texture dimensions
      const maxDim = 4096;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: true })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      const mime = targetMime || (file.type === "image/png" ? "image/webp" : file.type || "image/jpeg");

      if (mime === "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas blob generation failed"));
        },
        mime,
        Math.max(0.05, Math.min(1.0, quality))
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

  let minQ = 0.08;
  let maxQ = 0.95;
  let bestBlob: Blob = file;
  let bestDiff = Infinity;
  let currentScale = 1.0;

  const targetMime = file.type === "image/png" ? "image/webp" : file.type || "image/jpeg";

  // Multi-pass binary search (browser-image-compression algorithm)
  for (let step = 0; step < 7; step++) {
    const midQ = (minQ + maxQ) / 2;
    const candidate = await compressImageFile(file, midQ, currentScale, targetMime);

    if (candidate.size <= targetBytes) {
      const diff = targetBytes - candidate.size;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestBlob = candidate;
      }
      if (precision === "exact" && diff < targetBytes * 0.05) {
        return candidate;
      }
      minQ = midQ + 0.03;
    } else {
      maxQ = midQ - 0.03;
    }

    if (minQ > maxQ && bestBlob.size > targetBytes && currentScale > 0.3) {
      currentScale *= 0.8;
      minQ = 0.15;
      maxQ = 0.9;
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
  const sampleRate = Math.min(
    audioBuffer.sampleRate,
    bitrateKbps <= 64 ? 22050 : bitrateKbps <= 96 ? 32000 : 44100
  );
  const length = Math.max(1, Math.round(audioBuffer.duration * sampleRate));
  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  if (toMono && audioBuffer.numberOfChannels > 1) {
    const monoBuffer = offlineCtx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
    const mono = monoBuffer.getChannelData(0);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const input = audioBuffer.getChannelData(channel);
      for (let i = 0; i < input.length; i++) mono[i] += input[i] / audioBuffer.numberOfChannels;
    }
    const source = offlineCtx.createBufferSource();
    source.buffer = monoBuffer;
    source.connect(offlineCtx.destination);
    source.start();
  } else {
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
  }

  const renderedBuffer = await offlineCtx.startRendering();
  void audioCtx.close();

  const wavBlob = audioBufferToWavBlob(renderedBuffer);
  return {
    blob: wavBlob.size <= file.size ? wavBlob : file,
    mime: wavBlob.size <= file.size ? "audio/wav" : (file.type || "application/octet-stream")
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
  initialOrigBytes: number,
  initialEstBytes: number
): { card: HTMLElement; update: (origBytes: number, estBytes: number) => void } => {
  const origBytes = initialOrigBytes;
  const estBytes = initialEstBytes;
  const savedBytes = Math.max(0, origBytes - estBytes);
  const initialPct = origBytes > 0 ? Math.min(99, Math.max(0, Math.round((savedBytes / origBytes) * 100))) : 0;

  const originalLabel = el("span", { class: "compress-metric-value" }, [formatBytes(origBytes)]);
  const estimatedLabel = el("span", { class: "compress-metric-value compress-metric-value--accent" }, [
    formatBytes(estBytes)
  ]);

  const badge = el("span", { class: "compress-savings-badge" }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["savings"]),
    `Save ~${formatBytes(savedBytes)} (${initialPct}%)`
  ]);

  const progressFill = el("div", {
    class: "compress-gauge-bar-fill",
    style: `width: ${origBytes > 0 ? Math.max(5, Math.min(100, Math.round((estBytes / origBytes) * 100))) : 0}%`
  });

  const card = el("div", { class: "compress-telemetry-card" }, [
    el("div", { class: "compress-card-head" }, [
      el("span", { class: "compress-card-title" }, [
        el("span", { class: "material-symbols-outlined" }, ["analytics"]),
        "Savings Telemetry"
      ]),
      el("span", { class: "muted text-2xs font-mono" }, ["Real-time Analysis"])
    ]),
    el("div", { class: "compress-telemetry-metrics" }, [
      el("div", { class: "compress-metric-item" }, [
        el("span", { class: "compress-metric-label" }, ["Original Size"]),
        originalLabel
      ]),
      el("div", { class: "compress-metric-arrow" }, [
        el("span", { class: "material-symbols-outlined text-sm" }, ["arrow_forward"])
      ]),
      el("div", { class: "compress-metric-item", style: "text-align: right;" }, [
        el("span", { class: "compress-metric-label" }, ["Estimated Result"]),
        estimatedLabel
      ])
    ]),
    el("div", { class: "compress-savings-gauge" }, [
      el("div", { class: "compress-savings-callout" }, [
        el("span", { class: "muted text-2xs" }, ["Projected size reduction:"]),
        badge
      ]),
      el("div", { class: "compress-gauge-bar-track" }, [progressFill])
    ])
  ]);

  const update = (orig: number, est: number) => {
    originalLabel.textContent = formatBytes(orig);
    const validEst = Math.max(0, est);
    estimatedLabel.textContent = formatBytes(validEst);
    const saved = Math.max(0, orig - validEst);
    const pct = orig > 0 ? Math.min(99, Math.max(0, Math.round((saved / orig) * 100))) : 0;
    badge.replaceChildren(
      el("span", { class: "material-symbols-outlined text-xs" }, ["savings"]),
      `Save ~${formatBytes(saved)} (${pct}%)`
    );
    const fillRatio = orig > 0 ? Math.max(5, Math.min(100, Math.round((validEst / orig) * 100))) : 0;
    progressFill.style.width = `${fillRatio}%`;
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
  getTargetStrategy: () => BatchTargetStrategy;
  setDisabledState: (elementsToDisable: HTMLElement[]) => void;
} => {
  let activeMode: CompressMode = "quality";
  let activePrecision: TargetPrecision = "exact";
  let activeStrategy: BatchTargetStrategy = "per-file";

  const tabQuality = el("button", {
    class: "compress-mode-tab compress-mode-tab--active",
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined" }, ["tune"]),
    "Quality Slider"
  ]);

  const tabTarget = el("button", {
    class: "compress-mode-tab",
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined" }, ["track_changes"]),
    "Target File Size"
  ]);

  const segmentedBar = el("div", { class: "compress-mode-segmented" }, [tabQuality, tabTarget]);

  const pillExact = el("button", {
    class: "compress-pill-btn compress-pill-btn--active",
    type: "button"
  }, ["Exact Match (~100%)"]);

  const pillApprox = el("button", {
    class: "compress-pill-btn",
    type: "button"
  }, ["Approx (Max Ceiling)"]);

  const precisionToggle = el("div", { class: "compress-pill-toggle" }, [pillExact, pillApprox]);

  const pillPerFile = el("button", {
    class: "compress-pill-btn compress-pill-btn--active",
    type: "button",
    title: "Target cap applied per file individually"
  }, ["Fixed Per-File"]);

  const pillProportional = el("button", {
    class: "compress-pill-btn",
    type: "button",
    title: "Distribute total budget proportionally across batch"
  }, ["Proportional Share"]);

  const strategyToggle = el("div", { class: "compress-pill-toggle" }, [pillPerFile, pillProportional]);

  const numInput = el("input", {
    type: "number",
    min: "0.1",
    step: "0.1",
    value: "1.0",
    class: "compress-target-num"
  }) as HTMLInputElement;

  const unitSelect = el("select", { class: "compress-unit-select" }, [
    el("option", { value: "MB" }, ["MB"]),
    el("option", { value: "KB" }, ["KB"])
  ]) as HTMLSelectElement;

  const floatingInput = el("div", { class: "compress-floating-input" }, [
    el("span", { class: "material-symbols-outlined text-xs muted" }, ["straighten"]),
    numInput,
    unitSelect
  ]);

  const makeQuickChip = (valStr: string, unitStr: string) => {
    const btn = el("button", {
      class: "compress-quick-chip",
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

  const quickChipsRow = el("div", { class: "compress-quick-chips-row" }, [
    el("span", { class: "muted text-2xs font-semibold" }, ["Quick Target:"]),
    makeQuickChip("500", "KB"),
    makeQuickChip("1.0", "MB"),
    makeQuickChip("2.0", "MB"),
    makeQuickChip("5.0", "MB"),
    makeQuickChip("10.0", "MB")
  ]);

  const targetDeck = el("div", { class: "compress-target-deck", style: "display: none;" }, [
    el("div", { class: "row align-center justify-between gap-xs" }, [
      el("span", { class: "field-label text-xs", style: "margin: 0;" }, ["Target Limit:"]),
      floatingInput
    ]),
    el("div", { class: "row align-center justify-between gap-xs" }, [
      el("span", { class: "field-label text-xs", style: "margin: 0;" }, ["Match Precision:"]),
      precisionToggle
    ]),
    el("div", { class: "row align-center justify-between gap-xs" }, [
      el("span", { class: "field-label text-xs", style: "margin: 0;" }, ["Multi-File Budget:"]),
      strategyToggle
    ]),
    quickChipsRow
  ]);

  const container = el("div", { class: "column gap-sm" }, [
    segmentedBar,
    targetDeck
  ]);

  let qualityElements: HTMLElement[] = [];

  const updateState = (mode: CompressMode) => {
    activeMode = mode;
    const isTarget = mode === "target-size";
    tabQuality.classList.toggle("compress-mode-tab--active", !isTarget);
    tabTarget.classList.toggle("compress-mode-tab--active", isTarget);

    targetDeck.style.display = isTarget ? "flex" : "none";

    qualityElements.forEach((elItem) => {
      elItem.style.display = isTarget ? "none" : "flex";
    });
  };

  tabQuality.addEventListener("click", () => {
    updateState("quality");
    onModeChange("quality");
  });

  tabTarget.addEventListener("click", () => {
    updateState("target-size");
    numInput.focus();
    onModeChange("target-size");
  });

  pillExact.addEventListener("click", () => {
    activePrecision = "exact";
    pillExact.classList.add("compress-pill-btn--active");
    pillApprox.classList.remove("compress-pill-btn--active");
    onModeChange("target-size");
  });

  pillApprox.addEventListener("click", () => {
    activePrecision = "approx";
    pillApprox.classList.add("compress-pill-btn--active");
    pillExact.classList.remove("compress-pill-btn--active");
    onModeChange("target-size");
  });

  pillPerFile.addEventListener("click", () => {
    activeStrategy = "per-file";
    pillPerFile.classList.add("compress-pill-btn--active");
    pillProportional.classList.remove("compress-pill-btn--active");
    onModeChange("target-size");
  });

  pillProportional.addEventListener("click", () => {
    activeStrategy = "proportional";
    pillProportional.classList.add("compress-pill-btn--active");
    pillPerFile.classList.remove("compress-pill-btn--active");
    onModeChange("target-size");
  });

  numInput.addEventListener("input", () => {
    if (activeMode !== "target-size") updateState("target-size");
    onModeChange("target-size");
  });

  unitSelect.addEventListener("change", () => {
    if (activeMode !== "target-size") updateState("target-size");
    onModeChange("target-size");
  });

  const getMode = (): CompressMode => activeMode;
  const getTargetBytes = (): number | null => {
    if (activeMode !== "target-size") return null;
    const val = Number(numInput.value);
    if (!val || val <= 0) return null;
    return unitSelect.value === "MB" ? Math.round(val * 1024 * 1024) : Math.round(val * 1024);
  };

  const getTargetPrecision = (): TargetPrecision => activePrecision;
  const getTargetStrategy = (): BatchTargetStrategy => activeStrategy;

  const setDisabledState = (elements: HTMLElement[]) => {
    qualityElements = elements;
    updateState(activeMode);
  };

  return { container, getMode, getTargetBytes, getTargetPrecision, getTargetStrategy, setDisabledState };
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
    class: `compress-mode-tab ${selectedMode === "quality" ? "compress-mode-tab--active" : ""}`,
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
    "Quality Slider"
  ]);

  const tabTarget = el("button", {
    class: `compress-mode-tab ${selectedMode === "target-size" ? "compress-mode-tab--active" : ""}`,
    type: "button"
  }, [
    el("span", { class: "material-symbols-outlined text-xs" }, ["track_changes"]),
    "Target Size Match"
  ]);

  const segmentedTabs = el("div", { class: "compress-mode-segmented", style: "width: 100%;" }, [
    tabQuality,
    tabTarget
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
    style: "width: 80px; font-weight: 700; font-family: var(--font-mono); font-size: 12px; height: 34px;"
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

  const qualityValueLabel = el("span", { class: "compress-badge-accent" }, [`${preset.qualityVal}% Quality`]);

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
    tabQuality.classList.toggle("compress-mode-tab--active", mode === "quality");
    tabTarget.classList.toggle("compress-mode-tab--active", mode === "target-size");

    targetSection.style.display = mode === "target-size" ? "grid" : "none";
    qualitySection.style.display = mode === "quality" ? "flex" : "none";
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
        segmentedTabs
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
  const host = el("div", { class: "compress-preset-deck" });

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

    const header = el("div", { class: "compress-preset-deck__head" }, [
      el("div", { class: "compress-preset-deck__title" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["folder_special"]),
        "Preset Buckets",
        el("span", { class: "compress-staged-count-pill" }, [`${presets.length}`])
      ]),
      addBtn
    ]);

    if (!presets.length) {
      host.append(
        header,
        el("div", { class: "compress-preset-empty-hint" }, [
          "No independent preset buckets created. Staged files will automatically use Global Compression Settings."
        ])
      );
      return;
    }

    const cardsGrid = el("div", { class: "compress-preset-cards-grid" });

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
          el("span", { class: "compress-preset-card-pro__title", title: p.name }, [p.name]),
          el("div", { class: "row gap-3xs align-center", style: "margin-left: auto; margin: 0;" }, [configBtn, delBtn])
        ]),
        el("div", { class: "compress-preset-card-pro__body" }, [
          el("span", { class: "compress-badge-accent", style: "font-size: 10px; padding: 2px 6px;" }, [configTag]),
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
const createFileListView = (
  filterKind: (e: CompressEntry) => boolean,
  getGlobalState?: () => { mode: CompressMode; qualityVal: number; targetBytes: number | null; grayscaleVal?: boolean; strategy?: BatchTargetStrategy }
): { host: HTMLElement; render: () => void } => {
  const host = el("div", { class: "compress-staged-deck" });

  const render = () => {
    host.replaceChildren();
    const filtered = entries.filter(filterKind);
    if (!filtered.length) return;

    const clearAllBtn = el("button", {
      class: "btn btn--xs btn--ghost",
      type: "button",
      style: "color: var(--color-error); font-size: 11px;"
    }, [
      el("span", { class: "material-symbols-outlined text-xs", "aria-hidden": "true" }, ["delete"]),
      "Clear All"
    ]);

    clearAllBtn.addEventListener("click", () => {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (filterKind(entries[i])) {
          entries.splice(i, 1);
        }
      }
      notifyFileChange();
    });

    const header = el("div", { class: "compress-staged-head" }, [
      el("div", { class: "compress-staged-title" }, [
        el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["folder_open"]),
        "Staged Media Workspace",
        el("span", { class: "compress-staged-count-pill" }, [`${filtered.length} files`])
      ]),
      clearAllBtn
    ]);

    const state = getGlobalState?.() || { mode: "quality", qualityVal: 65, targetBytes: null };

    const list = el(
      "ul",
      { class: "compress-file-list" },
      filtered.map((e) => {
        const origIndex = entries.indexOf(e);
        const iconName = e.kind === "pdf" ? "picture_as_pdf" : e.kind === "image" ? "image" : e.kind === "audio" ? "graphic_eq" : e.kind === "video" ? "movie" : "description";
        const avatarClass = `compress-file-avatar compress-file-avatar--${e.kind === "pdf" ? "pdf" : e.kind === "image" ? "image" : e.kind === "audio" ? "audio" : "video"}`;

        const removeBtn = el("button", {
          class: "btn btn--xs btn--ghost",
          type: "button",
          title: "Remove file",
          style: "color: var(--color-error); padding: 4px;"
        }, [
          el("span", { class: "material-symbols-outlined text-xs" }, ["close"])
        ]);
        removeBtn.addEventListener("click", () => removeEntry(origIndex));

        const presetOptions = [
          el("option", { value: "", selected: !e.presetId ? "selected" : undefined }, ["🌐 Global Config"])
        ];
        presets.forEach((p) => {
          const modeTag = p.mode === "target-size" ? `${p.targetVal} ${p.targetUnit}` : `${p.qualityVal}% Q`;
          presetOptions.push(
            el("option", { value: p.id, selected: e.presetId === p.id ? "selected" : undefined }, [`📁 ${p.name} [${modeTag}]`])
          );
        });

        const presetSelect = el("select", {
          class: "compress-select-compact",
          title: "Assign Compression Preset"
        }, presetOptions) as HTMLSelectElement;

        presetSelect.addEventListener("change", () => {
          e.presetId = presetSelect.value || undefined;
          notifyFileChange();
        });

        const itemEst = calculateEstimateForEntries([e], presets, state.mode, state.qualityVal, state.targetBytes, state.grayscaleVal, state.strategy || "per-file");
        const saved = Math.max(0, e.file.size - itemEst.estimatedBytes);
        const pct = Math.min(99, Math.max(0, Math.round((saved / e.file.size) * 100)));

        const estTag = el("span", { class: "compress-est-chip" }, [
          el("span", { class: "material-symbols-outlined text-xs" }, ["bolt"]),
          `~${formatBytes(itemEst.estimatedBytes)} (-${pct}%)`
        ]);

        return el("li", { class: "compress-file-row" }, [
          el("div", { class: "compress-file-left" }, [
            el("div", { class: avatarClass }, [
              el("span", { class: "material-symbols-outlined text-sm" }, [iconName])
            ]),
            el("div", { class: "compress-file-info" }, [
              el("span", { class: "compress-file-name", title: e.file.name }, [e.file.name]),
              el("span", { class: "compress-file-meta" }, [formatBytes(e.file.size)])
            ])
          ]),
          el("div", { class: "compress-file-right" }, [
            estTag,
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

const makePresetChip = (title: string, desc: string, onClick: () => void): HTMLElement => {
  const btn = el("button", { class: "compress-preset-chip", type: "button" }, [
    el("span", { class: "compress-preset-chip__pct" }, [title]),
    el("span", { class: "compress-preset-chip__desc" }, [desc])
  ]);
  btn.addEventListener("click", onClick);
  return btn;
};

// ── Feature 1: Document Compressor ────────────────────────────
const docCompressFeature: Feature = {
  id: "doc-compress",
  label: "Compress Document",
  mount(host, ctx) {
    let qualityVal = 65;
    let grayscaleVal = false;

    const isDoc = (e: CompressEntry) => e.kind === "pdf" || e.kind === "doc";

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["picture_as_pdf"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Smart Document & PDF Compressor"]),
          el("span", { class: "compress-hero-desc" }, ["Structural vector optimization with multi-DPI perceptual convergence."])
        ])
      ]),
      el("div", { class: "compress-privacy-badge" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["lock"]),
        "100% Local Processing"
      ])
    ]);

    const modeControl = createModeControl("doc", (mode) => {
      updateEstimate(mode);
    });

    const fileListView = createFileListView(isDoc, () => ({
      mode: modeControl.getMode(),
      qualityVal,
      targetBytes: modeControl.getTargetBytes(),
      grayscaleVal,
      strategy: modeControl.getTargetStrategy()
    }));

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "65",
      class: "compress-slider-gradient"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "compress-badge-accent" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
      "65% Quality"
    ]);

    const dpiSelect = el("select", { class: "select", style: "font-size: 11px; height: 32px;" }, [
      el("option", { value: "150" }, ["150 DPI (Crisp Text Vector)"]),
      el("option", { value: "72" }, ["72 DPI (Web Compact)"]),
      el("option", { value: "300" }, ["300 DPI (High Print Quality)"])
    ]) as HTMLSelectElement;

    const grayscaleCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const docs = entries.filter(isDoc);
    const totalBytes = docs.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(totalBytes, Math.round(totalBytes * 0.65));

    const presetManager = createPresetManager(isDoc, () => updateEstimate());

    const sliderBlock = el("div", { class: "compress-slider-block" }, [
      el("div", { class: "compress-slider-head" }, [
        el("span", { class: "compress-slider-label" }, [
          el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["sliders"]),
          "Quality Slider:"
        ]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-trio" }, [
        makePresetChip("40%", "⚡ Maximum Reduction", () => {
          qualitySlider.value = "40";
          qualityVal = 40;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "40% Quality");
          updateEstimate();
        }),
        makePresetChip("65%", "⚖️ Balanced (Optimal)", () => {
          qualitySlider.value = "65";
          qualityVal = 65;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "65% Quality");
          updateEstimate();
        }),
        makePresetChip("85%", "💎 High Print Clarity", () => {
          qualitySlider.value = "85";
          qualityVal = 85;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "85% Quality");
          updateEstimate();
        })
      ])
    ]);

    const fineTuneGrid = el("div", { class: "compress-fine-tune-grid" }, [
      el("div", { class: "compress-tune-item" }, [
        el("span", { class: "compress-tune-label" }, ["Rendering Resolution:"]),
        dpiSelect
      ]),
      el("div", { class: "compress-tune-item justify-center" }, [
        el("span", { class: "compress-tune-label" }, ["Color Mode:"]),
        el("label", { class: "row gap-xs text-xs align-center", style: "cursor: pointer; height: 32px;" }, [
          grayscaleCheck,
          "Convert to Grayscale"
        ])
      ])
    ]);

    const qualityDeck = el("div", { class: "column gap-sm" }, [
      sliderBlock,
      fineTuneGrid
    ]);

    modeControl.setDisabledState([qualityDeck]);

    const updateEstimate = (_mode?: CompressMode) => {
      const activeDocs = entries.filter(isDoc);
      const est = calculateEstimateForEntries(
        activeDocs,
        presets,
        modeControl.getMode(),
        qualityVal,
        modeControl.getTargetBytes(),
        grayscaleVal,
        modeControl.getTargetStrategy()
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

    const compressBtn = el("button", {
      class: "btn btn--primary compress-action-cta",
      type: "button"
    }, [
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
            outBlob = safeDocumentBlob(entry);
          }

          const reduction = Math.round((1 - outBlob.size / entry.file.size) * 100);
          const reductionLabel = reduction > 0 ? `-${reduction}%` : "same size";
          const safeLabel = entry.kind === "pdf" ? reductionLabel : "kept safe";
          const ext = fileExtension(entry.file.name, "pdf");

          outFiles.push({
            name: `${baseName(entry.file.name)}-${entry.kind === "pdf" ? "compressed" : "safe-copy"}.${ext}`,
            blob: outBlob,
            mime: entry.mime || "application/pdf",
            sourceFeatureId: "doc-compress",
            sourceLabel: `Compressed (${safeLabel})`
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

    const leftControlsCard = el("div", { class: "compress-card" }, [
      el("div", { class: "compress-card-head" }, [
        el("span", { class: "compress-card-title" }, [
          el("span", { class: "material-symbols-outlined" }, ["tune"]),
          "Global Compression Strategy"
        ]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      qualityDeck
    ]);

    const rightTelemetryDeck = el("div", { class: "compress-telemetry-deck" }, [
      estimator.card,
      presetManager.host,
      compressBtn
    ]);

    const studioGrid = el("div", { class: "compress-studio-grid" }, [
      leftControlsCard,
      rightTelemetryDeck
    ]);

    const dashboard = el("div", { class: "compress-studio-container" }, [
      heroBanner,
      drop,
      fileListView.host,
      studioGrid
    ]);

    host.append(dashboard);

    const updateVisibility = () => {
      const activeCount = entries.filter(isDoc).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "flex" : "none";
      studioGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
  }
};

// ── Feature 2: Image Compressor ───────────────────────────────
const imageCompressFeature: Feature = {
  id: "image-compress",
  label: "Compress Image",
  mount(host, ctx) {
    let qualityVal = 0.75;
    let scaleRatio = 1.0;
    let targetMime = "image/webp";

    const isImg = (e: CompressEntry) => e.kind === "image" || (e.mime.startsWith("image/") && e.mime !== "image/gif");

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["image"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Modern Image Compressor"]),
          el("span", { class: "compress-hero-desc" }, ["WebP / AVIF next-gen local conversion with perceptual dimension scaling."])
        ])
      ]),
      el("div", { class: "compress-privacy-badge" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["lock"]),
        "100% Local Processing"
      ])
    ]);

    const fileListView = createFileListView(isImg);

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "75",
      class: "compress-slider-gradient"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "compress-badge-accent" }, [
      el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]),
      "75% Quality"
    ]);

    const scaleSelect = el("select", { class: "select", style: "font-size: 11px; height: 32px;" }, [
      el("option", { value: "1.0" }, ["Original (100%)"]),
      el("option", { value: "0.75" }, ["Scale 75%"]),
      el("option", { value: "0.5" }, ["Scale 50%"]),
      el("option", { value: "0.25" }, ["Scale 25%"])
    ]) as HTMLSelectElement;

    const formatSelect = el("select", { class: "select", style: "font-size: 11px; height: 32px;" }, [
      el("option", { value: "image/webp" }, ["WebP (Best Compression)"]),
      el("option", { value: "image/jpeg" }, ["JPG (Universal)"]),
      el("option", { value: "image/png" }, ["PNG (Lossless)"]),
      el("option", { value: "" }, ["Keep Original Format"])
    ]) as HTMLSelectElement;

    const imgs = entries.filter(isImg);
    const imagesTotal = imgs.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(imagesTotal, Math.round(imagesTotal * 0.75));

    const modeControl = createModeControl("img", (mode) => {
      updateEstimate(mode);
    });

    const presetManager = createPresetManager(isImg, () => updateEstimate());

    const sliderBlock = el("div", { class: "compress-slider-block" }, [
      el("div", { class: "compress-slider-head" }, [
        el("span", { class: "compress-slider-label" }, [
          el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["sliders"]),
          "Quality Slider:"
        ]),
        qualityBadge
      ]),
      qualitySlider,
      el("div", { class: "compress-presets-trio" }, [
        makePresetChip("40%", "⚡ Maximum Reduction", () => {
          qualitySlider.value = "40";
          qualityVal = 0.4;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "40% Quality");
          updateEstimate();
        }),
        makePresetChip("75%", "⚖️ WebP Standard", () => {
          qualitySlider.value = "75";
          qualityVal = 0.75;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "75% Quality");
          updateEstimate();
        }),
        makePresetChip("90%", "💎 Crisp High-Res", () => {
          qualitySlider.value = "90";
          qualityVal = 0.9;
          qualityBadge.replaceChildren(el("span", { class: "material-symbols-outlined text-xs" }, ["tune"]), "90% Quality");
          updateEstimate();
        })
      ])
    ]);

    const fineTuneGrid = el("div", { class: "compress-fine-tune-grid" }, [
      el("div", { class: "compress-tune-item" }, [
        el("span", { class: "compress-tune-label" }, ["Dimension Scaling:"]),
        scaleSelect
      ]),
      el("div", { class: "compress-tune-item" }, [
        el("span", { class: "compress-tune-label" }, ["Output Format:"]),
        formatSelect
      ])
    ]);

    const qualityDeck = el("div", { class: "column gap-sm" }, [
      sliderBlock,
      fineTuneGrid
    ]);

    modeControl.setDisabledState([qualityDeck]);

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

    const compressBtn = el("button", {
      class: "btn btn--primary compress-action-cta",
      type: "button"
    }, [
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
          const ext = targetMime === "image/webp" ? "webp" : targetMime === "image/jpeg" ? "jpg" : targetMime === "image/png" ? "png" : fileExtension(entry.file.name, "jpg");

          outFiles.push({
            name: `${baseName(entry.file.name)}-compressed.${ext}`,
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

    const leftControlsCard = el("div", { class: "compress-card" }, [
      el("div", { class: "compress-card-head" }, [
        el("span", { class: "compress-card-title" }, [
          el("span", { class: "material-symbols-outlined" }, ["tune"]),
          "Global Compression Strategy"
        ]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      qualityDeck
    ]);

    const rightTelemetryDeck = el("div", { class: "compress-telemetry-deck" }, [
      estimator.card,
      presetManager.host,
      compressBtn
    ]);

    const studioGrid = el("div", { class: "compress-studio-grid" }, [
      leftControlsCard,
      rightTelemetryDeck
    ]);

    const dashboard = el("div", { class: "compress-studio-container" }, [
      heroBanner,
      drop,
      fileListView.host,
      studioGrid
    ]);

    host.append(dashboard);

    const updateVisibility = () => {
      const activeCount = entries.filter(isImg).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "flex" : "none";
      studioGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
  }
};

// ── Feature 3: Audio Compressor ───────────────────────────────
const audioCompressFeature: Feature = {
  id: "audio-compress",
  label: "Compress Audio",
  mount(host, ctx) {
    let bitrateKbps = 128;
    let toMono = false;

    const isAud = (e: CompressEntry) => e.kind === "audio" || e.mime.startsWith("audio/");

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["graphic_eq"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["WebAudio Master Compressor"]),
          el("span", { class: "compress-hero-desc" }, ["Smart bitrate resampling and stereo-to-mono voice downmixing."])
        ])
      ]),
      el("div", { class: "compress-privacy-badge" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["lock"]),
        "100% Local Processing"
      ])
    ]);

    const fileListView = createFileListView(isAud);

    const bitrateSelect = el("select", { class: "select", style: "font-size: 11px; height: 32px;" }, [
      el("option", { value: "128" }, ["128 kbps (Standard MP3 Quality)"]),
      el("option", { value: "192" }, ["192 kbps (High Fidelity)"]),
      el("option", { value: "96" }, ["96 kbps (Medium Quality / Speech)"]),
      el("option", { value: "64" }, ["64 kbps (Voice / Minimum Size)"])
    ]) as HTMLSelectElement;

    const monoCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const auds = entries.filter(isAud);
    const audioTotal = auds.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(audioTotal, Math.round(audioTotal * 0.6));

    const modeControl = createModeControl("aud", (mode) => {
      updateEstimate(mode);
    });

    const presetManager = createPresetManager(isAud, () => updateEstimate());

    const sliderBlock = el("div", { class: "compress-slider-block" }, [
      el("div", { class: "compress-slider-head" }, [
        el("span", { class: "compress-slider-label" }, [
          el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["sliders"]),
          "Bitrate Presets:"
        ])
      ]),
      el("div", { class: "compress-presets-trio" }, [
        makePresetChip("64 kbps", "⚡ Voice Note", () => {
          bitrateSelect.value = "64";
          bitrateKbps = 64;
          updateEstimate();
        }),
        makePresetChip("128 kbps", "⚖️ Standard MP3", () => {
          bitrateSelect.value = "128";
          bitrateKbps = 128;
          updateEstimate();
        }),
        makePresetChip("192 kbps", "💎 Studio Audio", () => {
          bitrateSelect.value = "192";
          bitrateKbps = 192;
          updateEstimate();
        })
      ])
    ]);

    const fineTuneGrid = el("div", { class: "compress-fine-tune-grid" }, [
      el("div", { class: "compress-tune-item" }, [
        el("span", { class: "compress-tune-label" }, ["Audio Bitrate:"]),
        bitrateSelect
      ]),
      el("div", { class: "compress-tune-item justify-center" }, [
        el("span", { class: "compress-tune-label" }, ["Channel Downmix:"]),
        el("label", { class: "row gap-xs text-xs align-center", style: "cursor: pointer; height: 32px;" }, [
          monoCheck,
          "Downmix Stereo ➔ Mono"
        ])
      ])
    ]);

    const qualityDeck = el("div", { class: "column gap-sm" }, [
      sliderBlock,
      fineTuneGrid
    ]);

    modeControl.setDisabledState([qualityDeck]);

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

    const compressBtn = el("button", {
      class: "btn btn--primary compress-action-cta",
      type: "button"
    }, [
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

          outFiles.push({
            name: `${baseName(item.file.name)}-compressed.${res.mime === "audio/wav" ? "wav" : "mp3"}`,
            blob: res.blob,
            mime: res.mime,
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

    const leftControlsCard = el("div", { class: "compress-card" }, [
      el("div", { class: "compress-card-head" }, [
        el("span", { class: "compress-card-title" }, [
          el("span", { class: "material-symbols-outlined" }, ["tune"]),
          "Global Compression Strategy"
        ]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      qualityDeck
    ]);

    const rightTelemetryDeck = el("div", { class: "compress-telemetry-deck" }, [
      estimator.card,
      presetManager.host,
      compressBtn
    ]);

    const studioGrid = el("div", { class: "compress-studio-grid" }, [
      leftControlsCard,
      rightTelemetryDeck
    ]);

    const dashboard = el("div", { class: "compress-studio-container" }, [
      heroBanner,
      drop,
      fileListView.host,
      studioGrid
    ]);

    host.append(dashboard);

    const updateVisibility = () => {
      const activeCount = entries.filter(isAud).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "flex" : "none";
      studioGrid.style.display = activeCount > 0 ? "grid" : "none";
    };

    fileChangeListeners.push(updateVisibility);
    updateVisibility();
    updateEstimate();
  }
};

// ── Feature 4: Video Compressor ───────────────────────────────
const videoCompressFeature: Feature = {
  id: "video-compress",
  label: "Compress Video / GIF",
  mount(host, ctx) {
    let resHeight = 720;
    let muteAudio = false;

    const isVid = (e: CompressEntry) => e.kind === "video" || e.mime.startsWith("video/") || e.mime === "image/gif";

    const heroBanner = el("div", { class: "compress-hero-banner" }, [
      el("div", { class: "compress-hero-info" }, [
        el("div", { class: "compress-hero-icon" }, [
          el("span", { class: "material-symbols-outlined" }, ["movie"])
        ]),
        el("div", { class: "compress-hero-text" }, [
          el("span", { class: "compress-hero-title" }, ["Video & Animated GIF Compressor"]),
          el("span", { class: "compress-hero-desc" }, ["Multi-frame recording stream scaling and audio track stripping."])
        ])
      ]),
      el("div", { class: "compress-privacy-badge" }, [
        el("span", { class: "material-symbols-outlined text-xs" }, ["lock"]),
        "100% Local Processing"
      ])
    ]);

    const fileListView = createFileListView(isVid);

    const resSelect = el("select", { class: "select", style: "font-size: 11px; height: 32px;" }, [
      el("option", { value: "720" }, ["720p HD (Recommended)"]),
      el("option", { value: "480" }, ["480p SD (High Compression)"]),
      el("option", { value: "360" }, ["360p Low (Maximum Compression)"]),
      el("option", { value: "1080" }, ["1080p Full HD"])
    ]) as HTMLSelectElement;

    const muteCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const vids = entries.filter(isVid);
    const videoTotal = vids.reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(videoTotal, Math.round(videoTotal * 0.55));

    const modeControl = createModeControl("vid", (mode) => {
      updateEstimate(mode);
    });

    const presetManager = createPresetManager(isVid, () => updateEstimate());

    const sliderBlock = el("div", { class: "compress-slider-block" }, [
      el("div", { class: "compress-slider-head" }, [
        el("span", { class: "compress-slider-label" }, [
          el("span", { class: "material-symbols-outlined text-xs text-accent" }, ["sliders"]),
          "Resolution Presets:"
        ])
      ]),
      el("div", { class: "compress-presets-trio" }, [
        makePresetChip("480p", "⚡ SD (Fast & Compact)", () => {
          resSelect.value = "480";
          resHeight = 480;
          updateEstimate();
        }),
        makePresetChip("720p", "⚖️ 720p HD (Recommended)", () => {
          resSelect.value = "720";
          resHeight = 720;
          updateEstimate();
        }),
        makePresetChip("1080p", "💎 1080p Full HD", () => {
          resSelect.value = "1080";
          resHeight = 1080;
          updateEstimate();
        })
      ])
    ]);

    const fineTuneGrid = el("div", { class: "compress-fine-tune-grid" }, [
      el("div", { class: "compress-tune-item" }, [
        el("span", { class: "compress-tune-label" }, ["Output Resolution:"]),
        resSelect
      ]),
      el("div", { class: "compress-tune-item justify-center" }, [
        el("span", { class: "compress-tune-label" }, ["Audio Track:"]),
        el("label", { class: "row gap-xs text-xs align-center", style: "cursor: pointer; height: 32px;" }, [
          muteCheck,
          "Mute Audio Track"
        ])
      ])
    ]);

    const qualityDeck = el("div", { class: "column gap-sm" }, [
      sliderBlock,
      fineTuneGrid
    ]);

    modeControl.setDisabledState([qualityDeck]);

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

    const compressBtn = el("button", {
      class: "btn btn--primary compress-action-cta",
      type: "button"
    }, [
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
          const ext = res.mime.includes("webm") ? "webm" : isGif ? "gif" : fileExtension(item.file.name, "webm");

          outFiles.push({
            name: `${baseName(item.file.name)}-compressed.${ext}`,
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

    const leftControlsCard = el("div", { class: "compress-card" }, [
      el("div", { class: "compress-card-head" }, [
        el("span", { class: "compress-card-title" }, [
          el("span", { class: "material-symbols-outlined" }, ["tune"]),
          "Global Compression Strategy"
        ]),
        el("span", { class: "muted text-2xs" }, ["(Applies to unassigned files)"])
      ]),
      modeControl.container,
      qualityDeck
    ]);

    const rightTelemetryDeck = el("div", { class: "compress-telemetry-deck" }, [
      estimator.card,
      presetManager.host,
      compressBtn
    ]);

    const studioGrid = el("div", { class: "compress-studio-grid" }, [
      leftControlsCard,
      rightTelemetryDeck
    ]);

    const dashboard = el("div", { class: "compress-studio-container" }, [
      heroBanner,
      drop,
      fileListView.host,
      studioGrid
    ]);

    host.append(dashboard);

    const updateVisibility = () => {
      const activeCount = entries.filter(isVid).length;
      fileListView.host.style.display = activeCount > 0 ? "block" : "none";
      presetManager.host.style.display = activeCount > 0 ? "flex" : "none";
      studioGrid.style.display = activeCount > 0 ? "grid" : "none";
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
    const incoming = [
      ...takeHandoff("compress"),
      ...takeHandoff("pdf-compress")
    ];
    if (incoming && incoming.length) {
      entries.length = 0;
      await addFiles(incoming, { busy: noopBusy });
      toast(`${incoming.length} file(s) loaded`, "success");
    }
  };

  window.addEventListener(SAME_TOOL_EVENT, (e) => {
    const featureId = (e as CustomEvent<{ featureId?: string }>).detail?.featureId;
    if (featureId) shell.activate(featureId);
    void consumeHandoff();
  });

  void consumeHandoff();
};
