# 11 — Milestones
## UtiliBox · Roadmap Pengembangan (TDD-driven, per milestone teruji)

---

## M0 — Fondasi (hari 1-3) ✅ DONE (commit e470e95, ad62302)
- Scaffold Vite + TS + router hash + design tokens (`tokens.css`) ✅
- Shell UI: header/search (⌘K), kategori, grid home, footer ✅
- Tool registry (`config/tools.ts`) + lazy loading per tool + empty state ✅
- Shared components: dropzone, toast, progress, download, copy ✅
- CI: GitHub Actions (lint + vitest + build + deploy) ✅ hijau
- **Checkpoint**: deploy awal **live** https://fadhlijeu.github.io/UtiliBox/ ✅
  2 tool jalan (base64 + json), test 9/9, lint+typecheck bersih.

## M1 — Documents core (hari 4-9)
- PDF: merge, split (range/extract), organize grid (drag reorder, delete, rotate)
- PDF compress (3 preset + custom) + compress image (squoosh)
- Convert: PDF→TXT, PDF→MD, DOCX→PDF, XLSX→PDF (matrix dasar)
- Metadata: EXIF viewer + remover (jpg/png)
- **Checkpoint**: 5 tool P0 docs lulus acceptance (fixture files).

## M2 — OCR + Security core (hari 10-14)
- OCR tier A (Tesseract eng/ind) + tier B (Unlimited-OCR Space via gradio wrapper + health check + failover akhaliq)
- QR gen (14 types + custom + SVG/PNG) + QR scanner (jsQR camera/upload)
- Password gen/check (zxcvbn + HIBP) · Hash 12 algs (text+file) · JWT decode/verify
- **Checkpoint**: OCR live test (2 fixture) + security tools acceptance.

## M3 — Media & Downloader (hari 15-21)
- Remove bg local (u2net) + manual brush + bg replace
- Image convert (incl HEIC) + resize/crop presets
- Video→GIF (clip/fps/loop) + audio converter (ffmpeg.wasm lazy)
- **Downloader P0**: TikTok HD (service per open-questions decision), YT MP3/MP4; URL + username input, history localStorage
- **Checkpoint**: downloader kerja end-to-end di browser.

## M4 — Dev tools (hari 22-26)
- JSON suite (format/validate/minify/tree/convert/diff) + YAML/XML
- Base64 (text/file/image, url-safe, MIME) · Markdown (MD↔HTML + preview)
- API tester core (methods/params/headers/body/auth + history)
- **Checkpoint**: API tester panggil endpoint publik sukses.

## M5 — AI tools (hari 27-32)
- Settings BYOK (Gemini + custom) + prompt engine
- Summarizer + Paraphraser (+humanize) · Caption in-browser
- Code assistant (explain/fix/lint) · Prompt beautifier lokal
- Chatbot FAQ (lokal matching + BYOK chat) · Sketch preprocessing
- **Checkpoint**: semua AI tool dengan mode offline/basic + BYOK jalan.

## M6 — Polish & ship (hari 33-37)
- Speed test basic · Diff checker · Enkripsi AES/RSA · Export ZIP untuk batch
- Audit Hallmark slop: 58 gates pass · responsive 320-768 · aksesibilitas
- Perf pass (chunk sizes, cache), copywriting final, docs/README
- E2E Playwright: 10 critical paths
- **Ship v1.0** 🚀

---

## Definition of Done (per tool)
- [ ] Unit test engine (Vitest) — pure logic covered
- [ ] Acceptance dari spec file terpenuhi
- [ ] Manual check di Chrome + Safari (mobile 375px)
- [ ] Tidak ada konsol error
- [ ] State: loading/error/empty lengkap
- [ ] Dark mode tidak rusak (jika P1)
- [ ] Copy ID benar

---

## Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| Service downloader down/CORS | multi-service fallback + pesan jujur + saran "coba layanan lain" |
| HF Space mati | health check startup + 2 space + tier A fallback |
| ffmpeg.wasm memory | limit durasi, worker, pesan upgrade |
| GitHub Pages size / bundle | per-tool chunk, < 500KB/tool avg |
| Token tikdownloader expire | re-fetch token flow (open question) |