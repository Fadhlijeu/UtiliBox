# 02 — Architecture
## UtiliBox · Arsitektur Teknis

---

## 1. Stack Ringkas

| Layer | Pilihan | Alasan |
|-------|---------|--------|
| Framework | **Vite + vanilla TypeScript** (keputusan user #1) | Chunk code-splitting per tool, load cepat di Pages |
| Styling | Native CSS + design tokens (Hallmark-aligned, **OKLCH**) | Kontrol total desain anti-slop, dark mode sejak awal |
| Build/Deploy | Vite —> dist/ —> GitHub Actions push ke gh-pages | Otomatis, gratis |
| State | Minimal per tool; localStorage untuk history & BYOK key | Tanpa backend |
| Icons | Material Symbols Outlined | Vektor konsisten, anti-slop |
| Testing | Vitest (unit) + Playwright (e2e tool kritis) | Mengikuti TDD skill |
| UI Language | English (keputusan #3) | Single locale v1 |

---

## 2. Arsitektur Berlapis

```
UI  (tool views, per-tool pages)
        |
Tool Registry — route /tool/:id, meta, lazy chunk loader
        |
Processing Engines (3 tier):
  [Client-side]   PDF.js, pdf-lib, ffmpeg.wasm, Tesseract.js,
                  openpgp, exifr, zxcvbn, jsQR, qrcode, marked,
                  turndown, js-yaml, fast-xml-parser, diff
  [Serverless]    HF Spaces (OCR Unlimited-OCR, PaddleOCR),
                  HF Inference API, remove-bg service,
                  Piston API (code run), HIBP range API,
                  TikTok downloader API (tikdownloader.io)
  [BYOK]          Gemini / OpenAI-compatible (AI tools) —
                  key user di localStorage, call langsung ke
                  provider, tanpa proxy
        |
Shared utils: file-drop, toast, clipboard, download, progress
        |
GitHub Actions --> gh-pages (static)
```

---

## 3. Strategi Per Tool (Channel Tipe)

### 3.1 Client-side only (murni browser)

| Tool | Engine |
|------|--------|
| PDF merge/split/reorder/rotate/crop/compress | pdf-lib + pdf.js (preview) |
| DOCX - PDF / PDF - DOCX | mammoth.js (DOCX-HTML), docx.js; HTML-PDF via pdf-lib render sederhana (tanpa layout dok penuh — dibatasi, lihat open questions) |
| Excel - PDF / PDF - Excel | SheetJS (xlsx) parse + pdf-lib tulis; PDF-Excel ekstraksi tabel via pdf.js + parser tabel sederhana |
| Image convert/compress/resize/crop | Canvas + libavif/mozjpeg-webp WASM via squoosh engine |
| HEIC decode | heic2any / libheif WASM |
| Remove background lokal (opsi) | u2net onnx atau transformer.js + WebGPU (fallback bila tidak mau pakai API) |
| EXIF view/remove | exifr + canvas re-encode untuk strip |
| Diff | diff (Google diff-match-patch) |
| JSON/YAML/XML | js-yaml, fast-xml-parser, custom formatter |
| Base64 | Web API + TextEncoder + chunk MIME |
| Markdown-HTML | marked + turndown + DOMPurify |
| QR | qr-code-styling (generate), jsQR (scan) |
| Password | zxcvbn + crypto.getRandomValues |
| Hash | Web Crypto (SHA-1/256/384/512) + spark-md5 (MD5) + js-sha3 (SHA3) + crc-32 |
| JWT | jose library (verify HS/RS/ES) |
| VT/GIF/audio basics | ffmpeg.wasm (video-audio; berat — lazy load) |
| Diff | diff npm |

### 3.2 Serverless (HF Spaces / API publik)

| Tool | Service |
|------|---------|
| OCR HD | HF Space baidu/Unlimited-OCR (Gradio API, endpoint run_ocr + explode_pdf) — default try, fallback Tier1 (keputusan #10) |
| OCR fallback | PaddleOCR-VL Space / Tesseract.js lokal |
| Remove background premium | remove.bg API (user key opsi) atau Space open-source — TIER LOKAL u2net pertama (keputusan #26: free default) |
| Code run/compile | **Piston API** (keputusan #18 — engineer-man/piston, gratis tanpa key) — 40+ bahasa |
| TikTok downloader HD | Pola tiktok.py: situs remote (tikdownloader.io) via CORS-proxy / HF wrapper — keputusan #13 |
| IG/YT/X downloader | Situs support remote + scrape DOM bila tersedia (keputusan #14) |
| Speed test | Tanpa service khusus, CDN fetch (keputusan #20 — basic) |

### 3.3 BYOK (Bring Your Own Key) — keputusan #24

User paste API key di settings (disimpan localStorage), semua AI tool yang berat ikut jalur ini:

- Gemini API (rekomendasi: flash, gratis kuota harian cukup besar)
- Fallback OpenAI-compatible custom (user bisa isi base URL + key)

Tools: Summarizer, Paraphraser, Humanizer, Image caption (opsional serverless), AI code assistant, Chatbot FAQ, Prompt beautifier. HIBP TIDAK dipakai (#23).

---

## 4. Deployment

```
main branch
  |
  |  workflows/deploy.yml
  v
GitHub Actions: npm ci, npm run lint, npm run test, npm run build
  |
  v
gh-pages branch -> https://<user>.github.io/UtiliBox/
```

- SPA routing: karena GitHub Pages tidak support fallback routing, pakai **hash router** (#/tool/pdf-editor) agar reload aman.
- Caching: assets hashed di `dist`, service worker opsional (P2).

---

## 5. Data & Privacy Flow

- Tidak ada server. Tidak ada database. Tidak ada akun.
- localStorage (settings, history, keys) — user diberi opsi export/clear.
- Setiap tool yang mengirim data ke service eksternal menampilkan banner "File/URL Anda akan diproses oleh [service], file tidak disimpan" (transparansi — prinsip tools).

---

## 6. Risiko Utama & Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| CORS block dari service downloader | Tool tidak jalan | pilih service CORS-open; UI beri error jelas pada service yang kita sengaja |
| HF Space mati (Unlimited-OCR punya 2 Space, Surya rusak) | OCR HD rusak | multi-space fallback + Tesseract lokal tier 1 |
| Heap limit PDF besar di browser | crash tool | cap ukuran file per tool (misal 100MB), worker off-main-thread |
| ffmpeg.wasm + memory | Video konversi crash | Ultra lazyload, batas durasi, pesan upgrade di UI |
| API key user terlihat di localStorage | (wasjangan) | Peringatan BYOK di UI, key tidak pernah duplikasi ke URL |

---

## 7. Struktur Folder (draft)

```
src/
  main.ts
  router.ts
  styles/ (tokens.css, global.css)
  components/ (dropzone, toast, progress, code, badge)
  tools/
    pdf-convert/
    pdf-organizer/
    pdf-compress/
    ocr/
    encrypt/
    metadata/
    diff/
    remove-bg/
    image-convert/
    image-resize-crop/
    video-gif/
    audio-convert/
    downloader/
    json/
    base64/
    markdown/
    api-tester/
    code-runner/
    speedtest/
    qr/
    password/
    hash/
    jwt/
    summarizer/
    paraphraser/
    caption/
    sketch/
    chatbot/
    code-assist/
    prompt-beautify/
    humanizer/
  lib/ (engine wrappers)
  config/tools.ts (registry metadata)
tests/
```