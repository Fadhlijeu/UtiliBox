# 01 — Requirements
## UtiliBox · Spesifikasi Kebutuhan

---

## 1. Kebutuhan Fungsional

### 1.1 Platform & Deployment

| ID | Requirement | Priority |
|----|-------------|----------|
| F-01 | Website statis yang dideploy ke GitHub Pages | P0 |
| F-02 | Zero backend sendiri; semua processing client-side atau via layanan pihak ketiga yang bisa diakses dari browser | P0 |
| F-03 | Semua tools bisa diakses tanpa login (kecuali BYOK untuk AI premium) | P0 |
| F-04 | Berjalan di semua browser modern (Chrome, Firefox, Safari, Edge terbaru) | P0 |
| F-05 | Responsive: desktop & mobile | P0 |

### 1.2 Documents & Files

| ID | Requirement | Priority |
|----|-------------|----------|
| F-10 | Konversi dokumen PDF ↔ Word/Excel/TXT/Markdown (client-side PDF.js + libs) | P0 |
| F-11 | Kompresi PDF & gambar (kualitas preset, target size, DPI) | P0 |
| F-12 | PDF editor: merge, split (range, ekstrak per halaman), delete, reorder (drag-n-drop), rotate, crop, watermark, page numbers — merge berlaku dua arah: multi-PDF **dan** dokumen (Word/TXT gambar) jadi satu file | P0 |
| F-13 | OCR gambar/PDF → teks (2 tier: Tesseract.js lokal + Unlimited-OCR via HF Spaces) | P0 |
| F-14 | Enkripsi/dekripsi file AES-256 (Web Crypto API) + RSA (openpgp.js) | P1 |
| F-15 | Metadata viewer/remover untuk foto & video (EXIF strip: GPS, kamera, tanggal, thumbnail) | P0 |
| F-16 | Diff checker text & file (side-by-side, inline diff) | P1 |

### 1.3 Images & Media

| ID | Requirement | Priority |
|----|-------------|----------|
| F-20 | Remove background: AI (remove.bg-style; opsi local lib u2net-onnx / rimraf / bgremover; fallback API) | P0 |
| F-21 | Konversi format gambar JPG/PNG/HEIC/WebP/GIF/BMP/TIFF/SVG/AVIF | P0 |
| F-22 | Resize & crop (preset social media, aspect lock, pixel/%, target file size) | P0 |
| F-23 | Video ↔ GIF dua arah: video→GIF (klip rentang waktu, fps, resize, loop) + GIF→video (video converter dasar) | P1 |
| F-24 | Audio converter MP3/WAV/OGG/M4A/FLAC (FFmpeg WASM) | P1 |
| F-25 | Media downloader: TikTok (HD tanpa watermark via tikdownloader.io API), IG (post/reel/story/highlight/profile), YouTube (via API/service), X (via API/service) | P0 |

### 1.4 Developer & Data

| ID | Requirement | Priority |
|----|-------------|----------|
| F-30 | JSON/YAML/XML formatter, validator (error dengan line number), minifier, converter antar-format | P0 |
| F-31 | Base64 encode/decode: text, file, URL-safe, image↔base64, chunk MIME | P0 |
| F-32 | Markdown ↔ HTML converter (live preview, GFM/CommonMark, export HTML/PDF) | P0 |
| F-33 | API tester mini: methods, headers, body types, auth, collections, history, env vars, response viewer | P1 |
| F-34 | Canvas code editor: pilih bahasa (30+), compile/run via Piston API / OneCompiler API, HTML → live preview pane | P0 |
| F-35 | Speed test basic: download/upload/ping (menggunakan XHR ke CORS-friendly endpoint) | P2 |

### 1.5 Security & Utility

| ID | Requirement | Priority |
|----|-------------|----------|
| F-40 | QR generator: URL/text/wifi/vCard/email/SMS/phone/event + custom warna/logo/error correction + download PNG/SVG | P0 |
| F-41 | QR scanner: upload image + camera, decode lokal (jsQR) | P0 |
| F-42 | Password generator (length, charset, exclude ambiguous, passphrase) + strength checker (zxcvbn) + pwned check (HIBP range API) | P0 |
| F-43 | Hash generator: MD5, SHA-1, SHA-256/384/512, SHA-3, CRC32, HMAC, bcrypt opsional | P0 |
| F-44 | JWT decoder: header/payload/signature, verify HS/RS/ES, claims breakdown, iat/exp/nbf | P0 |

### 1.6 AI Extras

| ID | Requirement | Priority |
|----|-------------|----------|
| F-50 | Summarizer: 2 tier (HF Inference bart-large-cnn / Gemini BYOK), mode bullet/paragraph, length slider | P0 |
| F-51 | Paraphraser: modes (standard/fluent/formal/simple/creative/expand/shorten/humanize), synonym slider | P0 |
| F-52 | Image caption: in-browser vit-gpt2 (transformers.js) + opsional HF BLIP | P1 |
| F-53 | Sketch enhancer: opsional (HF Space / fal.ai) — v1 sebagai "sketch to prompt" jika terlalu mahal | P2 |
| F-54 | Chatbot mini FAQ: BYOK LLM (Gemini/OpenAI-compatible) + knowledge base sederhana | P1 |
| F-55 | AI code assistant: explain/lint/fix via BYOK LLM | P1 |
| F-56 | Prompt beautifier: template R-CTCEO lokal + opsi LLM polish | P1 |
| F-57 | Humanizer: BYOK LLM rewrite (dengan disclaimer anti-detection) | P2 |

### 1.7 UX Wajib (semua tool file-termsukaan)

| ID | Requirement | Priority |
|----|-------------|----------|
| F-58 | Visionable: semua input file dokumen/gambar/video/audio dapat `fileThumb` — thumbnail asli (image/video) atau render first frame/page (PDF via pdfjs), fallback ikon kontekstual | P0 |
| F-59 | Preview area: halaman (page thumbnails) untuk PDF, list thumbnails untuk multi-file | P0 |
| F-60 | Progress wajib pada semua operasi berdurasi: spinner (tidak tentu) atau progress bar deterministik `busy()`; user selalu tahu proses sedang berjalan — `busy.ts` | P0 |
| F-61 | Output preview sebelum download: semua hasil operasi masuk ke `output-panel.ts` (Preview terintegrasi: PDF via iframe, image/video/audio/tex) — "seperti git commit sebelum push", tidak direct-download | P0 |
| F-62 | Search global & tombol navigasi: search global hanya di home; halaman tool menampilkan back-link "All tools" | P0 |
| F-63 | Semua tombol fitur tool selalu terlihat (tidak hilang saat mode lain aktif) | P0 |
| F-64 | Tool-shell: setiap tool multi-fungsi punya tab fitur di top bar (`ToolShell`, feature = tab); hanya fitur aktif yang terlihat; hasil tampil di **view terpisah** ("Result") dengan tombol Back | P0 |
| F-65 | Undo/Redo/Reset di top bar shell: tiap langkah mutable (mis. delete halaman) push `HistoryCmd` — Undo/Redo jalan, Reset mengosongkan history + hasil + state tool (file dilepas) | P0 |
| F-66 | Handoff "oper file": output bisa dikirim ke tool/fitur lain lewat menu Send-to (filter MIME, tanpa self-loop); receiver punya intake (`takeHandoff`) — antar fitur tool sama & antar tool | P0 |
| F-67 | Tombol aksi contextual disabled (bukan hilang): mis. Split aktif hanya saat tepat 1 PDF; Merge aktif saat ≥2 file; hint teks selalu memberi tahu syarat | P0 |
| F-68 | History bar (Undo/Redo/Reset) muncul hanya saat ada aktivitas: file di-upload atau operasi mutable (delete pindah halaman) dilakukan — tersembunyi sebelum itu | P0 |
| F-69 | Fitur single-input (Split, delete pages): jika ada beberapa file, fitur berlaku per file dengan section terpisah "File 1", "File 2", … masing-masing punya kontrol sendiri | P0 |
| F-70 | Organize = drag & drop reorder halaman + select/delete halaman (Undo/Redo), bukan fitur delete saja; hasil final = PDF dengan urutan baru | P0 |
| F-71 | Preview = view/modal proporsional (bukan full-halaman membesar): card terpusat, tinggi ≤86vh, tombol Back (browser Back ikut menutup), Download di dalam preview, Escape menutup | P0 |
| F-72 | Output PDF punya strip preview tiap halaman ("Pages" toggle) agar user memeriksa setiap halaman sebelum download | P0 |
| F-73 | CI/chrome styling: top bar (judul + history), tab fitur underline, section per-file, card output; semua ikon pakai class `material-symbols-outlined` (jangan `material-icons-outlined` yang gagal render) | P0 |

---

## 2. Kebutuhan Non-Fungsional

### 2.1 Performance

| Metric | Target |
|--------|--------|
| First load (index) | < 2.5s di koneksi 4G (code-splitting per tool) |
| Tool load (per-tool chunk) | < 1.5s |
| OCR lokal (Tesseract.js, 1 halaman A4) | < 10s |
| Remove bg lokal | < 8s per gambar 1MP |
| PDF merge/split 100 halaman | < 3s |
| Build & deploy GitHub Actions | < 3 menit |

### 2.2 Privacy

- Semua processing client-side tidak mengirim file ke server (kecuali tool yang memang server-based, dinyatakan transparan di UI)
- BYOK: API key user disimpan hanya di browser (localStorage, dengan konfirmasi), tidak pernah dikirim ke server kami (tidak ada server kami)
- Downloader: hanya URL yang dikirim ke service pihak ketiga, file tidak disimpan

### 2.3 Compatibility

- Chrome/Edge/Firefox/Safari 2 versi terakhir
- WebAssembly support (untuk FFmpeg, PDF.js, Tesseract)
- Mobile: layout responsive, file input support
- HTTPS required (GitHub Pages otomatis)

### 2.4 Aksesibilitas (Hallmark baseline)

- Semua interactive element punya label + keyboard access
- Contrast AA untuk semua teks
- `prefers-reduced-motion` dihormati
- Touch target ≥ 44px

---

## 3. Constraints & Asumsi

- **GitHub Pages = statis murni.** Tidak ada server, tidak ada cron, tidak ada API key rahasia server-side. Semua external call harus CORS-friendly atau via CORS proxy.
- CORS: banyak API pihak ketiga memblokir call browser. Tool yang terkena CORS harus pakai jalur: (a) service CORS proxy publik (corsproxy.io dsb) — rapuh, atau (b) HF Spaces (CORS terbuka), atau (c) endpoint yang memang mengizinkan CORS (Piston API, HIBP, Gemini API).
- **Downloader media**: harus lewat API/service pihak ketiga karena GitHub Pages tidak bisa menjalankan server untuk fetch TikTok. Dilarang menyimpan video.
- Model AI berat tidak bisa jalan in-browser; strategi bertingkat (in-browser ringan → HF Inference → BYOK).
- User bersedia mengetik API key sendiri untuk fitur AI premium (BYOK model).
