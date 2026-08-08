# 03 — Feature Research: Documents & Files
## UtiliBox · Hasil Scraping Website PDF/OCR

> Sumber: ilovepdf.com, smallpdf.com, tools.pdf24.org, sejda.com, pdf2go.com, adobe.com/acrobat/online, cleverpdf.com, ocr.space, newocr.com, imagetotext.info, huggingface.co/baidu/Unlimited-OCR.
> Metode: webfetch langsung (7 situs PDF + 3 situs OCR diverifikasi). Kolom "Y" = fitur ada di situs itu.
> Singkatan: IL=ilovepdf, SP=smallpdf, P24=pdf24, SJ=sejda, PG=pdf2go, AD=adobe, CV=cleverpdf.

---

## 1. Daftar Tools per Situs

### ilovepdf (26+ tools)
- Organize: Merge, Split, **Remove pages, Extract pages, Organize (drag-reorder + delete + insert page dari PDF lain)**, Scan to PDF, **AI Summarizer**, Translate PDF, PDF to Markdown.
- Convert to PDF: JPG, Word, PowerPoint, Excel, HTML (URL), Scan.
- Convert from PDF: JPG, Word, PPT, Excel, PDF/A.
- Optimize: Compress, Repair, OCR.
- Edit: Rotate, Page numbers, Watermark, Crop, Edit PDF, PDF Forms.
- Security: Unlock, Protect, Sign, **Request signatures, Redact, Compare PDF**.
- Platform: desktop app, mobile app, workflows, API, Zapier/Make/WordPress.

### Smallpdf (40 tools)
- Terkuat di konversi **To PDF**: Word, Excel, PPT, JPG, Pages, TXT, **RTF, ODT, ODP, ODS, HWP, HTML, EPUB, ZIP, CSV**.
- AI: **Chat with PDF, AI Summarizer, Translate PDF, AI Question Generator**.
- Edit: Edit PDF, Annotator, Redact, **Flatten, Canvas**, Form Filler, Number Pages.
- Crypto: Protect, Unlock; Sign + **request signature via Sign.com (tracking)**.
- Platform: Chrome extension, G Suite, Dropbox, Windows app, mobile, embed widget, accessible-PDF.

### PDF24 (60 tools, semuanya gratis)
- Unik: **PDF Overlay (superimpose), Create job application PDF, e-invoice (XRechnung & ZUGFeRD), Set PDF viewer preferences, Create fillable form, Halve pages, Pages per sheet (N-up)**, **Remove metadata**, **Change document info (title/author/keywords)**, **Bookmark PDF**, **Create PDF from scratch**, Generate QR codes, Generate password.
- Conversions gila-gilaan: Word/DOCX, PPT, XLSX, **ODT/ODG/ODS/ODP, TXT, RTF, EPUB, Markdown to PDF**, PDF to images/JPG/PNG/SVG/HTML/secure/PDF-A, HEIC/WEBP/SVG/TIFF image converter.
- Desktop: PDF24 Creator (semua tools offline) + printer virtual + reader.

### Sejda (40+ tools)
- Paling kuat untuk **split**: by pages/ranges, **by bookmarks, split in half (A3 to 2xA4), by target size, by text pattern change**.
- **Alternate & Mix (interleave pages)**, **Visually combine & reorder** (seperti grid editor), **workflows (rantai tools otomatis)**.
- Compress: image quality presets (Medium/Good/Best), **PPI presets (72-720)**, grayscale, **discard multimedia**, optimize fonts.
- Editor teks sungguhan**: add/edit existing text, find & replace, hyperlink edit, whiteout, shapes.
- Watermark presets: posisi drag, X/Y exact, rotation, opacity, font, per-page, multi.
- Metadata edit, Bates numbering, Deskew scans, OCR language select + output searchable PDF.

### PDF2Go (30 tools)
- **Extract PDF (text, fonts, images)**, PDF Cleaner (**strip images, vector graphics, text**), **Print Poster (tile)**, Spellcheck, **Validate PDF/A**, **Extract facts (AI)**, Speech to Text.
- Compress dengan **6 preset DPI (Insane 20dpi - Prepress 300dpi)**, grayscale, **remove images saat compress**.
- Website URL - PDF (file/website/screenshot mode).
- AI Workspace beta.

### Adobe Acrobat Online (25+ tools, banyak yang butuh login)
- AI: Chat with PDF, Summary, Flashcards, **Quiz maker, Mind map, AI Presentation Maker, Resume Builder**.
- Konversi eksotis: **HEIC/ TIFF/ BMP/ GIF/ PSD/ AI/ INDD to PDF**, PNG/RTF/TXT to PDF.
- Compress up to 2GB dengan preset **High/Medium/Low**.

### CleverPDF (44 tools)
- **iWork**: Pages/Numbers/Keynote PDF interconvert.
- EPUB/Mobi, ODT; Image converter suite (PNG-JPG, HEIC-JPG, **GIF Maker, GIF-JPG/PNG**).
- Compress custom quality 1-100; Watermark hingga 120 char, 6 rotation, 4 opacity, 9 posisi, layer above/below.
- Tidak punya: OCR, editor, sign.

---

## 2. Union Fitur PDF (konsolidasi semua)

### Page Operations
Merge multi-PDF (+gambar), drag-reorder pre-merge, split multi/extract, split by range, **split by bookmarks**, **split by size target**, **split by text pattern**, **split by half**, **interleave/alternate pages**, **visual grid combine**, extract pages, **insert pages**, delete pages, reorder drag, rotate 90/180/270, crop, resize page size/A4, **unify mixed sizes**, **N-up (beberapa hal per lembar)**, mirror/flip, **overlay PDFs (superimpose background)**, page range selection.

### Conversion (dari/to action)
Word/DOCX-PDF, Excel-XLSX-PDF, PPT-PDF, JPG-PDF, PNG-PDF, TIFF/BMP/GIF/HEIC-PDF, WEBP/SVG-PDF, PSD/AI/INDD-PDF, Pages/Numbers/Keynote, TXT/RTF-PDF, ODT/ODP/ODS/ODG, HWP, **CSV**, HTML file/URL-PDF, **Markdown-PDF**, EPUB, MOBI, **PDF-simple, PDF-HTML/SVG, PDF-A archive, PDF-A validation**.

### Compression
Preset level (extreme/recommended/low), **DPI/PPI kontrol 72??**, **target size**, pro, **PDF to JPG/PNG/WEBP at 150/220 dpi**, speech vs print, **compress non-PDF (JPG/Word)**, up to 99% reduction claim, **web optimize/linearize**.

### Security
Password protect, **permissions (no print/copy/edit)**, unlock/remove owner password, **redact permanent**, flatten, whiteout, sign (draw/type/image), **request signature + track**, watermark teks/gambar, watermark 9-posisi/drag/X-Y, opacity/rotasi/font, target page range, **watermark above/below layer**, **templates**, secure PDF.

### Metadata & QA
- **Remove metadata**, view/edit document info (title/author/keywords), **validate PDF/A (checker)**, repair, **deskew**, flatten, peak.

### Tools Lain yang Menarik
- PDF viewer built-in (preview), page thumbnail drag-grid organizer, "organize view" seperti iLovePDF bureau, download ZIP untuk multi output, Google Drive/Dropbox/URL import, QR generator inline (PDF24), password generator (PDF24).

---

## 3. Penelitian OCR

### 3.1 baidu/Unlimited-OCR (rekomendasi utama user)
- **Type**: VLM document parsing 3B params (MIT license), read-order + tabel/markdown-ish output, <image>document parsing prompt.
- **Inference bukan browser**: 3B param GPU, tidak ada provider inference. Serverless: **Tidak deployed di HF Inference Provider**.
- **Space resmi bertingkat**: 
  - https://huggingface.co/spaces/baidu/Unlimited-OCR (official, ZeroGPU, durasi GPU 60 detik per call, model load di startup, cold start 30-120s)
  - https://huggingface.co/spaces/akhaliq/Unlimited-OCR (community clone, 51 likes)
  - alternatif: baohuynhbk14/DEMO-Unlimited-OCR-Streaming (batch/stream), prithivMLmods/DeepSeek-OCR-2-Unlimited-OCR.
- **API (Gradio 6 Server mode) yang diverifikasi dari app.py**:
  - `POST /gradio_api/call/run_ocr` — params: image_path (FileData), mode ("gundam" default | "base"), prompt. SSE streaming output {"text", "done"}.
  - `POST /gradio_api/call/explode_pdf` — split PDF rounded per page 200 DPI, return 1 list FileData. OCR halaman demi halaman.
  - `/gradio_api/info` dan `/gradio_api/openapi.json` untuk schema valid.
  - JS client resmi: `@gradio/client` (CDN), handle_file + app.predict/ submit, CORS terbuka dari origin manapun.
- **Quota ZeroGPU (nonauth 2 menit/hari, free account 5 menit/hari, PRO 40 menit/hari)** — sebuah halaman OCR call ~60 detik. Karena itu perlu tier lokal (Tesseract.js) + opsi BYO HF token.
- **Fitur UI web OCR lainnya (OCR.space/NewOCR)**: engine 1/2/3 (handwriting, tables - Markdown, 200+ langs), searchable PDF, overlay bbox per kata, "select region to OCR", rotate, math module, auto-enlarge low-DPI, language 122, output TXT/DOC/PDF/Google Docs/translate.

### 3.2 Recommended OCR pipeline (UtiliBox)
```
[User upload gambar/PDF]
        |
[PDF?] -> pdf.js render per halaman (canvas) 
        |
Tier 1 (gratis, offline): Tesseract.js (eng/ind, cepat, WASM)
        |
Tier 2 (akurat, opsional): baidu/Unlimited-OCR Space via @gradio/client
   (with warning on cold start + quota)
        |
[Mode "document parsing" -> markdown/teks dengan urutan baca]
        |
Export: TXT / MD / searchable PDF (opsional)
```

Detail strategi penuh: `10_ai_strategy.md`.