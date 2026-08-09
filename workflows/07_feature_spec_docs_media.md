# 07 — Feature Spec: Documents & Media Tools
## UtiliBox · Spesifikasi detail (menunggu konfirmasi user → `12_open_questions.md`)

> Format per tool: Purpose / Input / Option / Output / Engine / Acceptance (testable) / Priority.

---

## A. Documents & Files

### 1. Convert Dokumen (PDF ↔ Word ↔ Excel ↔ TXT ↔ Markdown)
- **Purpose**: Konversi 1 file 1 format (batch opsi).
- **Input**: upload / drag-drop (max 100MB), pilih source & target format.
- **Conversion matrix**: PDF->DOCX, DOCX->PDF, PDF->XLSX, XLSX->PDF, PDF->TXT, TXT->PDF, PDF->MD, MD->PDF, JPG/PNG->PDF (merge jadi satu, ikut poin #7 user: YES).
- **Fidelity DOCX→PDF / XLSX→PDF**: pakai opsi TERBAIK yang dapat klien-side dijangkau: render HTML hasil (mammoth/SheetJS) lalu generate PDF — dengan constraints: layout rumit (tabel gambar, dll) akan "sedekat mungkin", bukan pixel-perfect seperti LibreOffice. Ini disepakati (user: "The best option").
- **Options**: halaman range (untuk PDF), kualitas DPI (untuk render), orientation.
- **Engine**: pdf.js (parse/render), mammoth.js (DOCX-HTML), docx.js/html + pdf-lib render sederhana, xlsx (SheetJS), marked.
- **Output**: file hasil + tombol download; ZIP untuk multi-file.
- **Acceptance**: round-trip test (contoh file fixture DOCX/XLSX/PDF semua browser modern; error handling format tak dikenal; progress bar; ukuran hasil masuk akal).
- **P0/P1**: PDF-TXT & PDF-MD & XLSX-DOCX simple first; DOCX-PDF layout fidelity P1.

### 2. Compress Dokumen & Gambar
- **PDF**: 3 preset (Extreme/Recommended/Low), + custom quality slider 1-100, DPI preset (72-300), opsi **grayscale**, opsi hapus metadata ink setelah compress. Target: file size reduction ditampilkan (%) 
- **Gambar**: JPG/PNG/WebP/AVIF (squoosh engines local), quality slider, **before/after preview + % compare**, resize optional ketika compress.
- **Engine**: pdf-lib (downsample), Canvas + libavif/mozjpeg-wasm webp, exifr strip.
- **Acceptance**: memory crash test 100MB PDF (worker), output terbuka di pdf viewer.
- **P0**.

### 3. Merge & Split (PDF editor: split, merge, delete, reorder, drag-n-move)
- **Vue** iLovePDF-style: 
  - Merge: multi-PDF + gambar (JPG/PNG → halaman PDF, user #7: YES) + **dokumen umum (TXT/MD → halaman teks, DOCX via convert)** — merge berlaku dua arah: semua format jadi satu PDF, drag-order list before merge.
  - Split: by range (input format "1-3,5"), extract each page file, split every N pages. ⚠️ bookmarks split P2.
  - Organize: **grid thumbnail tiap halaman** — click select multi → delete; **drag-n-drop reorder**; (P1) insert blank page; rotate per page; zoom preview.
- **Engine**: pdf-lib + pdf.js render pages to canvas; worker (off-main) render. ⚠️ pdfjs selalu menerima **copy** buffer (`new Uint8Array(bytes)`) — jangan pernah pakai buffer yang sama dengan pdf-lib (terdetach → "Cannot perform Construct").
- **Progress & preview wajib (F-58–F-61)**: spinner/bar `busy()` pada semua operasi; hasil masuk `output-panel.ts` (Preview iframe/reframe sebelum download, mirip git commit → push). Semua tombol fitur selalu terlihat.
- **Tool-shell (F-64–F-78)**: tab fitur top bar (`Merge`/`Split`/`Organize`), hasil di view terpisah, Undo/Redo/Reset muncul setelah aktivitas, handoff `Send-to` antar fitur/tool, tombol contextual disabled; fitur single-input berlaku **per file**; `Organize` = drag-drop reorder + delete (picker: fill + badge + selection bar); **Setiap fitur punya preview halaman + drag/move page** (merge: grid gabungan semua file, urutan merge = urutan tampil; split: preview + klik-pilih range, drag-Preview pilih, range mengikuti urutan; hasil PDF auto-tampil strip Pages); pdfjs input wajib `bytes.slice()` (detach buffer); ikon class `material-symbols-outlined`.
- **Tidak termasuk (keputusan user)**: watermark editor (#8: tanpa), PDF sign (#9: tanpa).
- **Additional P1**: crop per-page, page numbers.
- **Acceptance**: 200-page doc: reorder 50 pages < 3s (render) valid; merge (PDF+PDF, PDF+TXT, PDF+gambar) output valid; delete selected pages benar; undo berfungsi.
- **P0** untuk merge/split/organize dasar.

### 3. OCR — Image/PDF → Teks
- Tier1 (default, gratis, offline): Tesseract.js — bahasa **eng + ind** default, pilih bahasa; opsi preprocessing (autodetect orientation, contrast).
- Tier2 (akurasi tinggi, default dicoba • user #10: YES): **baidu/Unlimited-OCR Space** (mode gundam/base), PDF via explode_pdf per page; **HF token (opsional) tersedia di Settings #11** untuk naik quota; observer fallback ke Tier1 bila Space mati/offline.
- Output: **picker semua tipe (#12): TXT / Markdown / Word (.docx)** + copy.
- UI: preview area: cropped region?, bahasa picker, tombol "OCR dengan AI HD (Space)".
- Acceptance: fixture potongan artikel; eng & ind accuracy: tier1 >= 85% (clean), tier2 >= 97% (clean); PDF 5 hal berjalan; cold start handled by status UI.
- **P0**.

### 4. File Encryption/Decryption (AES, RSA)
- **AES-256-GCM** (Web Crypto): enkripsi file → archive (.ubx, header: IV, salt, kdf PBKDF2, mode), dekripsi dengan password; streaming 64MB file test.
- **RSA (openpgp.js)**: generate keypair (4096), export pub/priv, encrypted message, decrypt.
- UI: 2 tab (AES/RSA), drag file, "Save result", password field + strength hint, note "private key not sent".
- Acceptance: round-trip enkripsi/dekripsi; salah password → error jelas; garbage input aman (no crash); pembatasan 100MB.
- **P1** (P0 untuk AES basic).

### 5. Metadata Remover / Checker (image/video)
- View: EXIF table (make/model, lens, GPS, date, software, **all tags**, thumbnails) + google maps link dari GPS.
- Remove: **strip EXIF + GPS + comment + thumbnail** dengan canvas/jpg-rewrite (lossless-ish jpeg, atau lossy per opsi); video: strip metadata box via remux mp4 (ffmpeg.wasm opsional P2).
- Batch: multi-file, status per file, ZIP out.
- Acceptance: fixture foto dengan GPS — remove → tidak ada tag GPS di output (test via exifr), size shrink; video mp4 (moov/meta) P2.
- **P0** (strip + view), P2 (video).

### 6. Diff Checker (file/text)
- Mode: text (paste 2 textarea) / file upload (txt, markdown, JSON, code).
- UIDENGKAP: side-by-side vs inline toggle, highlight line, **statistik (added/removed/changed)**, ignore whitespace, ignore case, dark/light.
- Engine: diff-match-patch (Google) atau dmp.
- Perf: 500KB file test.
- **P1**.

---

## B. Images & Media

### 1. Remove Background
- Tier: (a) **u2net lokal (transformers.js or onnx webgpu/wasm)** — gratis offline, (b) **configured API (remove.bg with user key optional)** only jika user set key.
- Edit: parameter (threshold/bg tolerance?), **Magic Brush: add/remove region** pada mask preview, feather slider.
- BG options: transparent / solid color / gradient / custom upload / keep original (opsi).
- Output: PNG (default), JPG (bukan transparan), chooose size (original/0.5x/logistic).
- Acceptance: foto silhouette test — tidak ada halo pada high contrast; tes API tanpa key → fallback local jalan.
- **P0**.

### 2. Image Converter (JPG/PNG/HEIC/WebP/GIF/BMP/SVG/Avif)
- Pair conversion UI dengan auto-detect format; settings per target: quality slider, resize, alpha, metadata strip (option with compress).
- HEIC input via libheif WASM. SVG input rasterize via canvas (sanitize DOMPurify dulu!). Output sharper dif использоват.
- **Batch**: 20 files; ZIP out; per-file results.
- **P0**.

### 3. Image Resize & Crop
- Resize: pixel / % / target file size (KB/MB, iterative compression), **social presets (IG post/story, Twitter, Facebook, YouTube thumb**, A4-print dpi), stretch/fit/crop-fit/fill options, aspect lock, presets 1:1, 4:5, 16:9, 9:16.
- Crop: interactive drag box on canvas, free ratio presets, rotate, flip, mirror.
- Usability: before/after preview, ao include **"resize by dims" matrix.
- **P0**.

### 4. Video ↔ GIF (dua arah)
- **Video → GIF**: upload/reel clip; set start/end time (range max 60s), fps (2-30), loop (yes/no), size limit 200MB; resize/crop hasil; effects (speed, reverse); optimize (frame skip).
- **GIF → Video**: upload GIF → konversi ke mp4/webm (fps/aspek dari GIF, opsional loop repeat ×N), via ffmpeg.wasm.
- **Tambahan (fastpass)**: video converter dasar mp4/webm/mov (+ audio extract) via ffmpeg.wasm — **lazy load & warning durasi ≤ 10 menit** (batas memori).
- **Acceptance**: GIF output = loop right; fps sesuai; test 30s clip OK; GIF→video berhasil (mp4 playable); worker.
- **P1** (converter), P0 (video↔GIF kualitas dasar).

### 5. Audio Converter (MP3/WAV/OGG/M4A/FLAC)
- Format list (12+), params: bitrate, sample rate, channels; **trim & fade opsional**; batch 5 files; strip metadata (opsional).
- ffmpeg.wasm — lazyload; max 50MB/10 min.
- **P1**.

### 6. Media Downloader (TikTok/IG/YT/X — extended)
- Input: **URL atau username** (user #14: scrap profil via teknik DOM scraper dari situs pendukung).
- Platform picker (tab).
- **TikTok (keputusan user #13 — "sesuai Tiktok.py; di websites remote; entry link → download; best option")**:
  - Alur meniru `Tiktok.py`: buka halaman situs downloader (tikdownloader.io) → scrape token → POST `api/ajaxSearch` → ambil link video HD dalam HTML → unduh. Dijalankan dari browser (CORS diatasi via CORS-proxy / HF Space UtiliBox yang membungkus alur ini).
  - Kualitas: **HD tanpa watermark (1080p/4K bila sumber menyediakan)** — pilih opsi terbaik dari link yang tersedia.
  - Foto/slideshow → MP4 merged + tiap slide JPEG + MP3 bila ada; **ZIP untuk semua foto** (#15: YES).
  - Opsi MP3, queue, history localStorage.
- **IG (#15)**: post/reel/carousel (ZIP — YES), story via username bila situs mendukung, highlight bila ada.
- **YT (#16 — prioritas VIDEO)**: MP4 kualitas tertinggi tersedia (hingga 4K), audio MP3 sebagai mode kedua.
- **X**: video + MP3.
- **Username-mode (#14)**: pakai pendekatan "DOM scraping dari situs pendukung" (pola sama dengan tiktok.py): pilih situs yang mendukung scrapping seluruh media profil → scrape daftar → antrian unduhan. Jika tak ada situs pendukung untuk platform tertentu → pesan jujur "username scraping tidak tersedia untuk [platform] di UtiliBox".
- **Batch mode**: dari list hasil scrape, antrian download 1-by-1, status per item.
- Legal notice footer + rate limit notice.
- **P0** core (URL TikTok HD, YT video, IG carousel) — username scrape P1.

---

## Catatan Keputusan User (diterapkan)
- #2: dark mode — diputuskan: **sertakan dari awal** (token OKLCH + prefers-color-scheme), UI English.
- #6: DOCX/Excel→PDF: fidelity terbaik yang bisa dicapai client-side, batasan diakui di UI (bukan pixel-perfect).
- #7: merge gambar (JPG/PNG) ke PDF: YES.
- #8: watermark: TIDAK dibangun. #9: PDF sign: TIDAK dibangun.
- #10: OCR Tier B (Unlimited-OCR Space) dicoba secara DEFAULT, fallback Tier1 otomatis.
- #11: Settings HF token (opsional) untuk naikkan quota ZeroGPU.
- #12: OCR output: TXT / MD / DOCX (picker).
- #13: TikTok: remote style tiktok.py → link → download, opsi HD terbaik.
- #14: username → scraping DOM via situs pendukung (bukan scraping mandiri).