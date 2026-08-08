# 10 — AI Strategy
## UtiliBox · Strategi AI: OCR HD + LLM + In-browser models

---

## 1. Prinsip Umum

```
Setiap AI tool = 3 tier, dipilih otomatis:
Tier A: Client-side (gratis, offline, privasi — model kecil)
Tier B: HuggingFace (Serverless Inference / Spaces — gratis, no-key)
Tier C: BYOK (user key Gemini / OpenAI-compat — kualitas terbaik)
```
Tier dipilih: default A (jika performa cukup), tombol "Kalitas tinggi" → B/C dengan bahan transparan.

---

## 2. OCR — Detail Rendering (jawaban user: "Unlimited-OCR berat")

### Kesimpulan dari riset
- baidu/Unlimited-OCR = **3B VLM document-level parsing** — TIDAK BISA jalan di browser (tidak ada ONNX/WebGPU port); tidak ada di HF Inference Provider.
- Yang ada: **2 Space publik** yang tinggi (ZeroGPU):
  1. https://huggingface.co/spaces/baidu/Unlimited-OCR (official)
  2. https://huggingface.co/spaces/akhaliq/Unlimited-OCR (community clone)
- Keduanya **Gradio Server 6**: endpoint `/api run_ocr` (image_path FileData + mode gundam/base + prompt, SSE stream {"text","done"}) dan `/api explode_pdf` (PDF → list pages PNG 200 DPI).
- **JS client resmi**: `https://cdn.jsdelivr.net/npm/@gradio/client` — `handle_file()`, `app.predict("/run_ocr", {...})`, CORS terbuka; ini cara PERFEK dari GitHub Pages.
- **Quota**: anonymous 2 menit GPU/hari, HF-login 5 menit/hari, PRO 40 menit/hari. 1 call ≈ 60 detik (durasi slot) → **anonymous ~2 halaman/hari**. Maka: **BYO HF token opsional untuk naik quota**.

### Pipeline resmi UtiliBox OCR
```
[Input: image/jpg/png/pdf]
   │  (jika PDF → pdf.js render halaman → canvas, atau explode_pdf)
   ▼
Tier A: Tesseract.js (eng/ind) — offline: < 10 detik/halaman, gratis
Tier B (toggle "Akurasi terbaik"): baidu/Unlimited-OCR Space — seperti
     Document AI (reading order, tabel, markdown-ish). Cold start 30-120s
     (model 3B load) → UI: status "Menyiapkan model AI… (pertama kali lama)"
   ▼
Output: TXT / MD / copy / download
```
Catatan: `run_ocr` mobile & desk one-image; PDF → panggil `explode_pdf` sekali lalu `run_ocr` per laman (progress UI per laman).

### Backups
- **PaddleOCR-VL-1.6_Online_Demo** Space (alternatif tier B, Gradio 5, endpoint `/predict` — perlu cek info).
- HF model power: `stepfun-ai/Stepfun-...`? — tidak; tetap di Space.
- **Test/verifikasi sebelum rilis**: webfetch `/gradio_api/info` pada ruang pilihan; pastikan endpoint hidup; string "run_ocr" & "explode_pdf" jelas.

---

## 3. LLM BYOK (Chat completions)

UI Settings global aplikasi:
```
[Pilih provider]
  ● Gemini (ai.google.dev)   — default rekomendasi (free tier besar: Flash ~1k req/day, 100k token)
  ○ OpenAI-compatible (custom base URL + key — OpenRouter, Groq, Ollama)
- Key disimpan localStorage (expires opt); tombol "Uji koneksi" & "Hapus"
- Peringatan: key perangkat Anda tidak dikirim ke server mana pun (semua call langsung ke provider)
```
- Call path: browser → provider API (Gemini REST open CORS; OpenAI-compatible butuh user mengizinkan; untuk OpenRouter, key di header — dari browser ok, user-nya sendiri).
- Prompt templates per tool disimpan di `src/lib/prompts/*.ts` + parameter JSON (mode, lengthRatio, targetLang).

### Model default per tool (BYOK)
| Tool | Gemini default | Catatan |
|---|---|---|
| Summarizer | gemini-2.0-flash (atau flash-lite) | mode bullet → "output bullets" |
| Paraphraser | flash, prompt mode matrix (9 modes) | synonym slider → "change rate: n/10" |
| Humanizer | flash + "rewrite: human cadence, varied rhythm, informal if, no filler" | disclaimer |
| Code assist | flash | line refs, target output langs |
| Chatbot FAQ | flash + system injected FAQ | konteks budget 8k |

Heuristics: tanpa key & tanpa HF token → tool AI menampilkan "Mode offline dasar tersedia" atau disable dengan penjelasan.

---

## 4. Model in-browser (transformers.js) — opsi Tier A

| Tool | Model | Size (wasm) | Catatan |
|---|---|---|---|
| Summarizer | Xenova/bart-large-cnn | ~650MB q8 | heavy — default A=B? serverless lebih ringan |
| Paraphrase | t5-small (kualitas dasar) | ~90MB | CPU lambat; dari HF Inference flan-t5-large lebih baik |
| Caption | Xenova/vit-gpt2-image-captioning | ~90MB q8 | oke; ~2-5s |
| Chatbot (rag) | all-MiniLM-L6-v2 (embeddings) | ~90MB | untuk FAQ matching |
| Remove bg | @huggingface/transformers w/ u2net onnx (webgpu) | 40MB | P1 |

**Aturan**: lazy-load model per tool hanya saat tool dipakai; simpan cache (Cache Storage) agar re-visit cepat; berikan progress "Mengunduh model (x MB)" — jujur.

---

## 5. Matriks Biaya/Kebijakan (jujur)

- Free Gemini: banyak request/hari — cukup personal use. Jangan hardcode shared key di repo.
- HF Inference free: rate limit per token yi; user BYOK HF token = lebih k.
- HF Spaces: gratis tetapi rawan mati — semua integrasi → **fail-over ke Space clone (akhaliq) + tier lokal**.
- Paid third party (remove.bg, fal.ai, Replicate): opsional & pergeseran — off by default.

---

## 6. Implementasi checklist (10_ai_strategy)

| # | Item | Status |
|---|---|---|
| 1 | Gradio client wrapper (`src/lib/gradio.ts`) — connect space, predict, sstream | TODO |
| 2 | Space health check (fetch `/gradio_api/info` | TODO |
| 3 | HF token opt-in in Settings (quota up) | TODO |
| 4 | Tesseract.js worker lazy (lang eng+ind) | TODO |
| 5 | Gemini SDK REST(FETCH, tanpa SDK) + test UI | TODO |
| 6 | Prompt template engine (variables + modes) | TODO |
| 7 | transformers.js caption u8 setup | TODO |
| 8 | OAuth2 → no; BYOK only | TODO |