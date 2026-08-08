# 06 — Research: AI Extras
## UtiliBox · Hasil Scraping website AI writing/caption tools

> Sumber terverifikasi: quillbot.com (summarize & paraphrase), undetectable.ai, humanize.ai, huggingface.co Spaces (BLIP, controlnet), chatboxai.app, free.ai/code/explain, promptbase.com, prompthero.com, promptperfect.jina.ai, onecompiler.
> Catatan penting: salesman-OCR / BLIP space **build error** (contoh ketidakandalan Space). yttomp3.org ternyata spam.

---

## 1. Fitur per Kategori

### 1.1 Summarizer (referensi: QuillBot)
- **3 mode output**: Paragraph, Bullet Points, Custom (Premium).
- **length slider 4 tingkat** (pendek/sedang/panjang) + auto-summarize.
- Input: paste teks **atau upload dokumen**; free limit 600 kata/run, no daily cap di referensi.
- Auto language detect; original-vs-summary comparison side-by-side; copy/export.

### 1.2 Paraphraser (QuillBot)
- **9 mode**: Standard (free), Fluency (free), Premium: **Formal, Academic, Simple, Creative, Expand, Shorten, Humanize, Custom**.
- **Synonym Slider** (agresivitas penggantian kata). Klikkata apa saja -> AI thesaurus pilihan sinonim.
- Compare/change history/stats; **free 125 kata/run, unlimited runs**; export copy.

### 1.3 Humanizer
- Undetectable.ai: **model Basic vs Stealth** (stealth = bonus anti-detection, paid), knob **Readability** (High school/University/Journalist...) dan **Purpose** (Essay/Academic/Marketing/Story), input max **10k chars** + upload, output score **human-likelihood  %** terhadap beberapa detector; "Humanize Again"; **50+ languages**; Chrome ext + API; account required.
- Humanize.ai: **100% free unlimited no-account**, Advanced Mode claim, word limit + upload, AI Detection Score + Natural score, 100+ language, sample buttons, clear history.

### 1.4 Image Caption
- **BLIP (Salesforce/blip-image-captioning-base, ~80M)** di HF — ternyata Space resmi untuk SENSITIVE building; in-browser transformers.js **Xenova/vit-gpt2-image-captioning ONNX (~90MB quantized)** = viable. BLIP-2 OPT-2.7b ~1.1GB (serverless).
- Output: 1 atau N caption (num_return_sequences sampling).
- HF Serverless: `Salesforce/blip-image-captioning-base` (500MB fp32, 150M). Multilingual: NLLB pass.

### 1.5 Sketch Enhancer / Drawing
- **Reality**: "sketch -> rendered image" butuh **Stable Diffusion + ControlNet** (5-10GB lokal; serverless via **fal.ai / Replicate / Runflow** paid per call) atau HF Spaces demo (ControlNet canny; banyak broken).
- Yang feasible free & browser: **sketch classification** (tfjs model kecil, 345 classes Quick-Draw) / **line-cleanup preprocessor**; kontrak: v1 = preview preprocessing + "Copy prompt untuk Stable Diffusion" + opsi BYOK paid pipeline.
- UI referensi: input upload/draw; style prompt optional; preprocessor list (canny/line-art); strength slider; generate; reseed; download.

### 1.6 Chatbot FAQ
- Referensi Chatbox: **BYOK multi-provider** (OpenAI, Gemini, Anthropic, OpenRouter, Mistral, Qwen, Moonshot), markdown/LaTeX, **file/document chat**, **knowledge base sorter** (agents**, MCP, websearch toggle, localStorage, export.
- Diskusi Pemilihan untuk UtiliBox: **chat in-browser sederhana**: system prompt FAQ (JSON bundled), localStorage conversation history, export/copy, tone preset, web search toggle; **opsi knowledge base custom file** (user upload dokumen — v1: keyword/RAG ringan).

### 1.7 AI Code Assistant
- Referensi: free.ai/code/explain (4-level audience: Junior/Senior/Non-dev/learn; Line-by-line vs overview; **line-number refs**; upload; caps ~5-10k), Workik (linting per ESLint/PEP8, style guide enforce, performance flagging, report), Syntha (convert code lang X->Y, code optimizer).
- UtiliBox v1: explain + fix + lint (via BYOK LLM; deterministic mini-lexer linters untuk balance check tanpa key), plus target language picker, big markers di editor.

### 1.8 Prompt Beautifier
- Referensi PromptPerfect (otomatis expand + penjelasan), PromptBase (marketplace 310k cepat, library), template **R-CTCEO framework** (Role/Context/Task/Constraints/Examples/Output format) dari GitHub prompt-enhancer.
- UtiliBox: **lokal (no API)**: input idea singkat -> form field (persona, task, konteks, batasan, contoh, format output) -> compose template dengan **preset library (kategorisasi: writing/code/marketing/image)**, tone chips; **opsional LLM polish (BYOK)**.

---

## 2. Strategi Model (ringkas — detail di `10_ai_strategy.md`)

| Tool | Tier 1 (tanpa key) | Tier 2 (BYOK LLM) |
|------|--------------------|--------------------|
| Summarizer | HF Inference bart-large-cnn / in-browser t5-small (offline mode) | Gemini Flash prompt ratio/bullet |
| Paraphraser | HF Serverless flan-t5-large (kualitas sedang) | Gemini Flash + mode templates + synonym slider |
| Humanizer | (tidak ada gratis andal) | Gemini rewrite + disclaimer anti-detection |
| Caption | transformers.js vit-gpt2 (local, ~90MB q8) | BLIP-2 serverless (opsional) |
| Sketch | tfjs classifier / preprocessing | paid pipeline (fal.ai) optional |
| Chatbot | FAQ matching lokal + MiniLM RAG | BYOK chat w/ system prompt |
| Code assist | mini lint deterministic | BYOK explain/fix/lint |
| Prompt beautifier | 100% lokal template | Gemini polish |
| Password | — | — |

Key UX rule (dari research): **setiap tool AI menampilkan dengan jelas**: (1) mode bebas vs BYOK, (2) kapan data dikirim (teks/kode/file ke service eksternal), (3) disclaimer untuk klaim anti-detection.