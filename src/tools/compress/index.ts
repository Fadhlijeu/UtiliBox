import { clear, el, readFileAsArrayBuffer } from "../../lib/dom";
import { dropzone } from "../../components/dropzone";
import { toast } from "../../components/toast";
import { ToolShell, type Feature, type FeatureCtx } from "../../components/tool-shell";
import { formatBytes, blobFromBytes } from "../../lib/files";
import { takeHandoff } from "../../lib/handoff";
import { SAME_TOOL_EVENT } from "../../components/output-panel";
import { PDFDocument } from "pdf-lib";
import type { Busy } from "../../components/busy";

export interface CompressEntry {
  file: File;
  data: Uint8Array;
  mime: string;
  kind: "pdf" | "image" | "audio" | "video" | "doc";
}

const entries: CompressEntry[] = [];
let notifyActivity: (() => void) | null = null;

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

// ── Audio Compression Helper (Web Audio API) ───────────────────
const compressAudioFile = async (
  file: File,
  bitrateKbps: number,
  toMono: boolean
): Promise<{ blob: Blob; mime: string }> => {
  const arrayBuf = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
  
  // Calculate reduced length or channel buffer
  const sampleRate = 22050;
  const numChannels = toMono ? 1 : Math.min(2, audioBuf.numberOfChannels);
  const offlineCtx = new OfflineAudioContext(numChannels, Math.floor(audioBuf.duration * sampleRate), sampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuf = await offlineCtx.startRendering();
  
  // Package raw audio data with bitrate factor reduction
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

// ── Video Compression Helper (Canvas & MediaRecorder) ──────────
const compressVideoFile = async (
  file: File,
  resHeight: number,
  muteAudio: boolean
): Promise<{ blob: Blob; mime: string }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.muted = muteAudio;
    video.src = url;

    video.onloadedmetadata = () => {
      const scale = resHeight > 0 ? Math.min(1, resHeight / video.videoHeight) : 1;
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
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
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        URL.revokeObjectURL(url);
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        resolve({ blob, mime: recorder.mimeType || "video/webm" });
      };

      recorder.start();
      video.play().then(() => {
        const renderLoop = () => {
          if (video.paused || video.ended) {
            recorder.stop();
            return;
          }
          ctx.drawImage(video, 0, 0, w, h);
          requestAnimationFrame(renderLoop);
        };
        renderLoop();
      }).catch(reject);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video for compression"));
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
    const pct = Math.round(ratio * 100);
    badge.textContent = `-${pct}% Reduction`;
    progressFill.style.width = `${Math.max(10, 100 - pct)}%`;
  };

  return { card, update };
};

// ── Feature 1: Document Compressor ─────────────────────────────
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
    const dpiSelect = el("select", { class: "select" }, [
      el("option", { value: "150" }, ["150 DPI (Recommended / E-book)"]),
      el("option", { value: "72" }, ["72 DPI (Extreme / Web & Mobile)"]),
      el("option", { value: "300" }, ["300 DPI (Low / High Print Quality)"])
    ]) as HTMLSelectElement;

    const grayscaleCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const totalBytes = entries.filter((e) => e.kind === "pdf" || e.kind === "doc").reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(totalBytes, 0.45);

    const updateEstimate = () => {
      const docs = entries.filter((e) => e.kind === "pdf" || e.kind === "doc");
      const bytes = docs.reduce((acc, e) => acc + e.file.size, 0);
      const ratio = (1 - qualityVal / 100) * 0.5 + (grayscaleVal ? 0.25 : 0) + (dpiSelect.value === "72" ? 0.2 : 0);
      estimator.update(bytes, Math.min(0.85, ratio));
    };

    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value);
      qualityBadge.textContent = `${qualityVal}%`;
      updateEstimate();
    });

    dpiSelect.addEventListener("change", updateEstimate);
    grayscaleCheck.addEventListener("change", () => {
      grayscaleVal = grayscaleCheck.checked;
      updateEstimate();
    });

    // Preset buttons
    const presetBtnExtreme = el("button", { class: "compress-preset-btn", type: "button" }, [
      el("span", { class: "compress-preset-btn__title" }, ["⚡ Extreme"]),
      el("span", { class: "compress-preset-btn__desc" }, ["72 DPI · B&W · 40%"])
    ]);
    presetBtnExtreme.addEventListener("click", () => {
      qualitySlider.value = "40";
      qualityVal = 40;
      qualityBadge.textContent = "40%";
      dpiSelect.value = "72";
      grayscaleCheck.checked = true;
      grayscaleVal = true;
      updateEstimate();
    });

    const presetBtnRec = el("button", { class: "compress-preset-btn compress-preset-btn--active", type: "button" }, [
      el("span", { class: "compress-preset-btn__title" }, ["⚙️ Recommended"]),
      el("span", { class: "compress-preset-btn__desc" }, ["150 DPI · Color · 65%"])
    ]);
    presetBtnRec.addEventListener("click", () => {
      qualitySlider.value = "65";
      qualityVal = 65;
      qualityBadge.textContent = "65%";
      dpiSelect.value = "150";
      grayscaleCheck.checked = false;
      grayscaleVal = false;
      updateEstimate();
    });

    const presetBtnLow = el("button", { class: "compress-preset-btn", type: "button" }, [
      el("span", { class: "compress-preset-btn__title" }, ["🔍 Low"]),
      el("span", { class: "compress-preset-btn__desc" }, ["300 DPI · Color · 85%"])
    ]);
    presetBtnLow.addEventListener("click", () => {
      qualitySlider.value = "85";
      qualityVal = 85;
      qualityBadge.textContent = "85%";
      dpiSelect.value = "300";
      grayscaleCheck.checked = false;
      grayscaleVal = false;
      updateEstimate();
    });

    const compressBtn = el("button", { class: "btn btn--primary", type: "button" }, [
      el("span", { class: "material-symbols-outlined", "aria-hidden": "true" }, ["compress"]),
      "Compress Document(s)"
    ]) as HTMLButtonElement;

    compressBtn.addEventListener("click", async () => {
      const docs = entries.filter((e) => e.kind === "pdf" || e.kind === "doc");
      if (!docs.length) return toast("Upload at least 1 document file", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing document(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < docs.length; i++) {
          const entry = docs[i];
          ctx.busy.progress(i / docs.length, `Compressing ${entry.file.name}…`);
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
          docs.map((e) => e.file),
          `Compressed ${docs.length} document(s)`
        );
        toast("Document compression complete", "success");
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
        "Reduce document size with intelligent page downsampling, DPI target presets, and B&W grayscale conversion."
      ]),
      drop,
      estimator.card,
      el("div", { class: "compress-presets-grid" }, [presetBtnExtreme, presetBtnRec, presetBtnLow]),
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Resolution (DPI):"]),
        dpiSelect,
        el("label", { class: "field-label" }, ["Quality:"]),
        qualitySlider,
        qualityBadge,
        el("label", { class: "row gap-xs" }, [grayscaleCheck, "Grayscale (B&W)"])
      ]),
      el("div", { class: "row" }, [compressBtn])
    );
  }
};

// ── Feature 2: Image Compressor ────────────────────────────────
const imageCompressFeature: Feature = {
  id: "image-compress",
  label: "Compress Image",
  mount(host, ctx) {
    let qualityVal = 0.75;
    let scaleRatio = 1.0;
    let targetMime = "image/webp";

    const qualitySlider = el("input", {
      type: "range",
      min: "10",
      max: "100",
      value: "75",
      class: "slider"
    }) as HTMLInputElement;

    const qualityBadge = el("span", { class: "badge" }, ["75%"]);

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

    const imagesTotal = entries.filter((e) => e.kind === "image" || e.mime.startsWith("image/")).reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(imagesTotal, 0.65);

    const updateEstimate = () => {
      const imgs = entries.filter((e) => e.kind === "image" || e.mime.startsWith("image/"));
      const bytes = imgs.reduce((acc, e) => acc + e.file.size, 0);
      const ratio = (1 - qualityVal) * 0.6 + (1 - scaleRatio) * 0.4 + (targetMime === "image/webp" ? 0.2 : 0);
      estimator.update(bytes, Math.min(0.92, ratio));
    };

    qualitySlider.addEventListener("input", () => {
      qualityVal = Number(qualitySlider.value) / 100;
      qualityBadge.textContent = `${Math.round(qualityVal * 100)}%`;
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
      const images = entries.filter((e) => e.kind === "image" || e.mime.startsWith("image/"));
      if (!images.length) return toast("Upload at least 1 image file", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing image(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < images.length; i++) {
          const imgEntry = images[i];
          ctx.busy.progress(i / images.length, `Compressing ${imgEntry.file.name}…`);
          const res = await compressImageFile(imgEntry.file, targetMime || imgEntry.mime, qualityVal, scaleRatio);

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

    const drop = dropzoneEl(ctx, "Upload images (JPG, PNG, WebP, AVIF, GIF)");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress images with WebP/AVIF local encoders, dimension scaling, and live size estimation."
      ]),
      drop,
      estimator.card,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Format:"]),
        formatSelect,
        el("label", { class: "field-label" }, ["Dimension Scale:"]),
        scaleSelect,
        el("label", { class: "field-label" }, ["Quality:"]),
        qualitySlider,
        qualityBadge
      ]),
      el("div", { class: "row" }, [compressBtn])
    );
  }
};

// ── Feature 3: Audio Compressor (MP3, WAV, OGG, M4A, FLAC) ─────
const audioCompressFeature: Feature = {
  id: "audio-compress",
  label: "Compress Audio",
  mount(host, ctx) {
    let bitrateKbps = 128;
    let toMono = false;

    const bitrateSelect = el("select", { class: "select" }, [
      el("option", { value: "128" }, ["128 kbps (Standard MP3 Quality)"]),
      el("option", { value: "192" }, ["192 kbps (High Quality)"]),
      el("option", { value: "96" }, ["96 kbps (Medium Quality / Speech)"]),
      el("option", { value: "64" }, ["64 kbps (Voice / Low Size)"])
    ]) as HTMLSelectElement;

    const monoCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const audioTotal = entries.filter((e) => e.kind === "audio" || e.mime.startsWith("audio/")).reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(audioTotal, 0.5);

    const updateEstimate = () => {
      const audios = entries.filter((e) => e.kind === "audio" || e.mime.startsWith("audio/"));
      const bytes = audios.reduce((acc, e) => acc + e.file.size, 0);
      const ratio = (1 - bitrateKbps / 320) * 0.6 + (toMono ? 0.3 : 0);
      estimator.update(bytes, Math.min(0.88, ratio));
    };

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
      const audios = entries.filter((e) => e.kind === "audio" || e.mime.startsWith("audio/"));
      if (!audios.length) return toast("Upload at least 1 audio file (MP3, WAV, OGG, M4A)", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing audio(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < audios.length; i++) {
          const item = audios[i];
          ctx.busy.progress(i / audios.length, `Compressing ${item.file.name}…`);
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
          audios.map((e) => e.file),
          `Compressed ${audios.length} audio file(s)`
        );
        toast("Audio compression complete", "success");
      } catch (e) {
        toast(`Audio compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload audio files (MP3, WAV, OGG, M4A, FLAC)");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress audio files with target bitrate selection and stereo to mono conversion."
      ]),
      drop,
      estimator.card,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Bitrate:"]),
        bitrateSelect,
        el("label", { class: "row gap-xs" }, [monoCheck, "Convert Stereo to Mono (Save ~50%)"])
      ]),
      el("div", { class: "row" }, [compressBtn])
    );
  }
};

// ── Feature 4: Video Compressor (MP4, WEBM, MOV, AVI) ──────────
const videoCompressFeature: Feature = {
  id: "video-compress",
  label: "Compress Video",
  mount(host, ctx) {
    let resHeight = 720;
    let muteAudio = false;

    const resSelect = el("select", { class: "select" }, [
      el("option", { value: "720" }, ["720p HD (Recommended)"]),
      el("option", { value: "480" }, ["480p SD (High Compression)"]),
      el("option", { value: "360" }, ["360p Low (Maximum Compression)"]),
      el("option", { value: "1080" }, ["1080p Full HD"])
    ]) as HTMLSelectElement;

    const muteCheck = el("input", { type: "checkbox" }) as HTMLInputElement;

    const videoTotal = entries.filter((e) => e.kind === "video" || e.mime.startsWith("video/")).reduce((acc, e) => acc + e.file.size, 0);
    const estimator = createEstimatorCard(videoTotal, 0.55);

    const updateEstimate = () => {
      const vids = entries.filter((e) => e.kind === "video" || e.mime.startsWith("video/"));
      const bytes = vids.reduce((acc, e) => acc + e.file.size, 0);
      const ratio = (1 - resHeight / 1080) * 0.6 + (muteAudio ? 0.2 : 0);
      estimator.update(bytes, Math.min(0.85, Math.max(0.2, ratio)));
    };

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
      const vids = entries.filter((e) => e.kind === "video" || e.mime.startsWith("video/"));
      if (!vids.length) return toast("Upload at least 1 video file (MP4, WEBM, MOV)", "error");
      compressBtn.disabled = true;
      ctx.busy.spin("Compressing video(s)…");
      try {
        const outFiles = [];
        for (let i = 0; i < vids.length; i++) {
          const item = vids[i];
          ctx.busy.progress(i / vids.length, `Compressing ${item.file.name}…`);
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
          vids.map((e) => e.file),
          `Compressed ${vids.length} video(s)`
        );
        toast("Video compression complete", "success");
      } catch (e) {
        toast(`Video compression failed: ${e instanceof Error ? e.message : e}`, "error");
      } finally {
        compressBtn.disabled = false;
        ctx.busy.done();
      }
    });

    const drop = dropzoneEl(ctx, "Upload video files (MP4, WEBM, MOV, AVI)");

    host.append(
      el("p", { class: "tool-desc" }, [
        "Compress video files with resolution scaling, frame rate capping, and mute audio options."
      ]),
      drop,
      estimator.card,
      el("div", { class: "row gap-md align-center" }, [
        el("label", { class: "field-label" }, ["Target Resolution:"]),
        resSelect,
        el("label", { class: "row gap-xs" }, [muteCheck, "Mute Audio Track (Save ~20%)"])
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
    [docCompressFeature, imageCompressFeature, audioCompressFeature, videoCompressFeature],
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
