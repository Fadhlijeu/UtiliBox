# UtiliBox
> *The personal utility toolkit. Deployed on GitHub Pages. 100% client-side where possible, smart serverless where needed.*

---

## Apa itu UtiliBox?

UtiliBox adalah gudang tools online pribadi berbasis website statis (GitHub Pages) yang mencakup **30+ tools** dalam 5 kategori: Documents & Files, Images & Media, Developer & Data, Security & Utility, dan AI Extras.

Prinsip utama:

1. **Client-first processing** — sebagian besar tools jalan di browser (WASM/JS murni). Tidak ada backend sendiri.
2. **Serverless cerdas** — berat (OCR SOTA, LLM, download media) dibantu via HuggingFace Spaces / Inference API / Bring-Your-Own-Key (BYOK).
3. **Tiap tool teruji** — setiap tool punya acceptance criteria + test, mengikuti skill TDD.
4. **Anti-AI-slop design** — mengikuti Hallmark Design System (lihat `09_ui_design_system.md`), bukan template default.

---

## Dokumen dalam folder `workflows/`

| File | Isi |
|------|-----|
| `00_overview.md` | Gambaran besar proyek (ini) |
| `01_requirements.md` | Kebutuhan fungsional & non-fungsional |
| `02_architecture.md` | Arsitektur teknis, deployment GitHub Pages, strategi backend |
| `03_research_docs.md` | Hasil scraping fitur website PDF/OCR (ilovepdf, smallpdf, pdf24, sejda, OCR.space, HF Unlimited-OCR) |
| `04_research_media.md` | Hasil scraping fitur media (tikdownloader.io, snaptik, y2down, remove.bg, squoosh, convertio, ezgif) |
| `05_research_dev_security.md` | Hasil scraping fitur dev tools (jsonlint, hoppscotch, onecompiler, speedtest) & security (qr, jwt, password, hash) |
| `06_research_ai.md` | Hasil scraping fitur AI tools (quillbot, humanizer, caption, prompt) + strategi model |
| `07_feature_spec_docs_media.md` | Spesifikasi detail tools Documents & Files + Images & Media |
| `08_feature_spec_dev_security_ai.md` | Spesifikasi detail Developer, Security, AI tools |
| `09_ui_design_system.md` | Design system & UI philosophy (Hallmark-aligned, anti AI slop) |
| `10_ai_strategy.md` | Strategi AI: HF Spaces OCR, LLM BYOK, model in-browser |
| `11_milestones.md` | Roadmap & milestone pengembangan |
| `12_open_questions.md` | Pertanyaan detail per tool yang butuh konfirmasi user |

---

## Daftar Tools (v1.0)

### 📄 Documents & Files
1. Convert dokumen (PDF ↔ Word ↔ Excel ↔ TXT ↔ Markdown)
2. Compress dokumen & gambar
3. Document editor (split, merge, delete, reorder pages, drag-n-move)
4. OCR (scan gambar jadi teks)
5. File encryption/decryption (AES, RSA)
6. Metadata remover/checker (foto/video)
7. Diff checker (bandingkan 2 file/text)

### 🎨 Images & Media
8. Remove background
9. Convert image format (JPG ↔ PNG ↔ HEIC ↔ WebP)
10. Image resize & crop
11. Convert video ↔ GIF ↔ anything
12. Audio converter (MP3 ↔ WAV ↔ OGG)
13. Media downloader (TikTok, IG, YouTube, X — support username, story, highlight, profile scraping)

### 🛠️ Developer & Data Tools
14. JSON/YAML/XML formatter & validator
15. Base64 encode/decode
16. Markdown ↔ HTML converter
17. API tester (mini Postman — pick provider & model)
18. Canvas code editor (insert code → compile → run → show; HTML → live preview)
19. Speed test (basic)

### 🔐 Security & Utility
20. QR code generator & scanner
21. Password generator/checker
22. Hash generator (MD5, SHA-256, + lainnya)
23. JWT decoder

### 🤖 AI Extras
24. Summarizer (artikel → ringkasan)
25. Paraphraser (rewrite teks)
26. Image caption generator
27. AI drawing / sketch enhancer
28. Chatbot mini (FAQ assistant)
29. AI code assistant (linting, explain code)
30. Prompt beautifier (short → mega prompt)
31. Humanizer (teks lebih natural)

---

## Filosofi Desain

UtiliBox menggunakan **Hallmark Design System** — bukan AI-slop default, bukan kluning dari design template.

- **Genre**: Modern-Minimal × Utilitarian (perkakas, bukan pajangan)
- **Tone**: Teknis-tegas, fokus pada fungsi — "a toolbox should feel like a toolbox, not a magazine"
- **Prinsip**: Tool adalah alat. Tidak ada animasi dekoratif yang menghalangi kerja. Setiap piksel punya alasan.

Lihat `09_ui_design_system.md` untuk detail lengkap.