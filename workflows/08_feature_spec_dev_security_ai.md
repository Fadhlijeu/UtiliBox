# 08 — Feature Spec: Developer, Security & AI
*UtiliBox · Spesifikasi detail — keputusan user sudah diterapkan*

> Format per tool: Purpose / Input / Options / Output / Engine / Acceptance / Priority.
> Bahasa UI: **English** (keputusan #3).

---

## B. Developer & Data Tools

### 1. JSON / YAML / XML Suite
- Tabs: Formatter, Validator, Minifier, **Converter** (JSON/YAML/XML/CSV/Excel), **Diff**, **Schema** (validator+generator JSON Schema), **Tree view** (v1 basic).
- Formatter: indent 2/4, auto-fix, error dengan line/column, copy, download.
- Upload file (≤5MB), open URL optional, sample data.
- JSONPath query (P1).
- Engine: js-yaml, fast-xml-parser, json5, custom pretty printer, diff.
- Acceptance: fixtures valid/invalid tiap format; error msg akurat; converter round-trip; JSON 10MB format < 2s.
- **P0** (JSON), **P1** (YAML/XML).

### 2. Base64
- Mode: Text | File | Image(s).
- Opsi: charset select, **URL-safe toggle**, **MIME 76-char toggle**, per-line.
- File → base64 (s.d. 100MB); base64 → file (detect ext, warn), image → dataURL preview; copy / download .txt.
- **P0**.

### 3. Markdown → HTML
- Split editor + **live preview** (GFM: task list, table).
- Tab Converter: MD → HTML (copy/download), **HTML → MD**, MD → **PDF** (P1).
- Toolbar markdown; word/char count; clear/sample; sanitize (DOMPurify).
- **P0** (MD→HTML + preview), **P1** (reverse + PDF).

### 4. API Tester (mini Postman)
- Request bar (method grid + URL), **params KV table**, headers KV, **body tabs**: none/raw/json/form/multipart/file; auth: none/basic/bearer.
- Response: **pretty viewer (JSON/XML/HTML)**, headers, cookies, **status + time + size**.
- **Realtime (keputusan #17 "best option")**: WebSocket + SSE panel.
- Tabs multi-request; **Save/History** (localStorage); collections + export/import JSON/curl; **{{var}} environments** (P1).
- **CORS proxy toggle** (warning, per-request).
- **P0** (core + WS/SSE), **P1** (collections/env).

### 5. Code Runner / Canvas IDE
- CodeMirror 6, language picker (top 40), stdout/stderr/exit, `Run` via **Piston API** (gratis, no key; limit: eksekusi 10 dtk, body ~10k char), **HTML preview pane** (iframe lokal).
- **Dua mode (keputusan #19: keduanya)**:
  - *Single file*: paste → run → output.
  - *Project*: multi-tab files/folder di localStorage, **export/import project (ZIP)**, share via base64 URL.
- **P0** (single + project dasar), fallback engine P1.

### 6. Speed Test (basic)
- Ping median (2 host), download 5-10MB (CDN, parallel), upload 2-5MB blobs.
- Output: Mbps down/up, ping ms; keterangan "basic".
- Batas: GitHub Pages tanpa server-SS-result — P2 stretch.

---

## C. Security & Utility

### 1. QR Code Generator & Scanner
- Generator: **URL, text, email, phone, SMS, WiFi, vCard, event, location, crypto, whatsapp, facebook, twitter, linkedin** (exkan 14).
- Custom: warna solid/gradient (fg/bg), eyes style, **logo upload (≤ 2MB, auto remove-bg)**, **error correction L/M/Q/H**, size slider, preview + contrast warning.
- Download: **PNG dan SVG**; copy ke clipboard.
- Scanner: **upload image** **atau** **kamera (getUserMedia)**; jsQR per-frame; hasil → copy/open URL/lihat teks/WiFi; history localStorage.
- **P0**.

### 2. Password Generator & Checker
- Generator: length slider, toggles (upper/lower/digit/symbol), exclude-ambiguous, **passphrase mode**, **strength real-time (zxcvbn)**, auto-copy.
- Checker: **zxcvbn score + crack time**, weak patterns list.
- Keputusan #23: **tanpa HIBP** — semua lokal, zero network.
- **P0**.

### 3. Hash Generator
- Text + File upload (checksum); **MD5, SHA-1, SHA-256/384/512, SHA3-256/512, CRC32, Adler32, RIPEMD-160**; HMAC dengan secret; uppercase toggle.
- Engine: spark-md5 (MD5), WebCrypto (SHA), js-sha3 (SHA3), crc-32.
- File limit 500MB (chunked). Copy per-row.
- **P0**.

### 4. JWT Decoder
- Instant parse header/payload (pretty JSON), **claims table (iat/exp/nbf/iss/aud/sub)**, **validation: expired? signature?** (HS256/384/512 via secret; RS256/384/512 & ES256/384/512 via PEM), edit+encode (P2).
- Error state untuk token invalid.
- **P0**.

---

## D. AI Extras (BYOK — keputusan #24; fallback free per tool — `10_ai_strategy.md`)

### 1. Summarizer
- Input text/file ≤10k words; mode **Paragraph / Bullet**; **length slider 1-4**.
- BYOK: Gemini Flash / OpenAI-compatible (Settings).
- Fallback no-key: HF Serverless `facebook/bart-large-cnn` (label "standard").
- Output: wordcount, copy, export.
- Acceptance: artikel 800 kata → ringkasan ≥3 kalimat & < 40% panjang asli.
- **P0**.

### 2. Paraphraser
- Modes: **Standard, Fluency, Formal, Academic, Simple, Creative, Expand, Shorten, Humanize**.
- **Synonym slider** → prompt; 500 kata cap; side-by-side output.
- **P0** (BYOK), fallback t5 (kualitas-lower, diberi notice).

### 3. Humanizer
- Output rewrite lebih natural; knobs: **readability** (casual/professional/academic), tone, vocab.
- Disclaimer anti-detection (bukan jaminan bypass).
- BYOK only + fallback paraphraser "Humanize" mode.
- **P1**.

### 4. Image Caption Generator
- transformers.js **vit-gpt2 in-browser** (sekali load, cache) — gratis, no server (#25: best).
- 1 caption + "generate 3" (sampling); copy; opsi BLIP serverless (opsional).
- **P1**.

### 5. Sketch Enhancer — FREE version (#26)
- Local preprocessing: adaptive threshold, denoise, stroke widen, contrast.
- Classifier tfjs (pretrained) untuk label; tombol **"Copy prompt untuk SD"**.
- Tanpa paid pipeline di v1. **P2**.

### 6. Chatbot mini FAQ — semantic (#27)
- Bawaan/upload FAQ JSON → **semantic retrieval (all-MiniLM-L6-v2 di-browser)** → top-k kandidat.
- Mode offline: tampilkan top-match tanpa LLM.
- Mode BYOK: kandidat + pertanyaan dikirim Gemini → jawaban + sumber FAQ.
- Chat kecil; history in-memory; export JSON/markdown.
- **P1** (semantic core P0).

### 7. AI Code Assistant
- Actions: Explain, Fix, Lint/adhere, Convert-to-lang, Optimize, Comment.
- Before/after diff (P1); markdown render + copy.
- BYOK, fallback prompt "set key" + link.
- **P1**.

### 8. Prompt Beautifier
- Composer: persona/task/context/constraints/examples/output + template chips + tone; hasil template lokal selalu ada (no key).
- Tombol "Polish with AI" (BYOK). Library lokal (writing/marketing/coding/image/education).
- **P1**.

---

## E. Cross-cutting (semua tool)
1. Upload: drag-drop + paste + URL (bila service mendukung).
2. Nama file download: `utilibox-<tool>-<timestamp>`.
3. States: empty / loading / error (retry) / size cap.
4. Banner transparansi bila data dikirim ke layanan eksternal.
5. Progress + cancel untuk task > 2s.
6. History (localStorage) untuk relevant tools (converter, base64, downloader, QR, hash).
7. Deep-link per tool `#/tool/<id>` + global search ⌘K (keputusan #30/31: OK).