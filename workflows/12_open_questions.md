# 12 — Keputusan User (resolved)
## UtiliBox · Keputusan yang sudah dikonfirmasi — update terakhir

> Status: **SEMUA PERTANYAAN DIJAWAB (2026-08-09).** File ini menjadi log keputusan resmi. Spec di `07`, `08`, `02`, `10`, `11` sudah diperbarui sesuai.
> Format: No. — Pertanyaan → **Keputusan**.

---

## A. Fondasi
| No | Keputusan |
|----|-----------|
| 1 | Framework → **Vite + vanilla TypeScript** (saran saya — ringan, chunk per tool, anti-top) |
| 2 | Dark mode → **sertakan sejak awal** (token tersedia, prefers-color-scheme) — admin putuskan "v1/v2" |
| 3 | Bahasa UI → **English (EN)** sejak awal |
| 4 | Cloud import (Drive/Dropbox) → **SKIP** |
| 5 | GitHub repo → **belum ada; SEDANG DIBUAT** sekarang (privasi: repo public, nama UtiliBox) |

## B. Dokumen
| No | Keputusan |
|----|-----------|
| 6 | DOCX/Excel→PDF fidelity → **terbaik yang bisa user-side capai**; batasan disepakati, ditandai di UI |
| 7 | Merge gambar (JPG/PNG→PDF) → **YES** |
| 8 | Watermark di PDF editor → **TIDAK** |
| 9 | PDF signing → **TIDAK** |

## C. OCR
| No | Keputusan |
|----|-----------|
| 10 | OCR Tier B (Unlimited-OCR Space) → **default dicoba; fallback lokal otomatis** |
| 11 | HF token opsional di settings → **YES** (untuk naikkan quota) |
| 12 | Output OCR → **picker: TXT / MD / DOCX** |

## D. Media & Downloader
| No | Keputusan |
|----|-----------|
| 13 | TikTok → **pola Tiktok.py di-website-remote: input link → download; pilih kualitas HD terbaik** (via CORS-proxy/HF wrapper jika diperlukan) |
| 14 | Username-based → **bila ADA situs pendukung yang bisa scraping DOM** (seperti full media profil), gunakan; bila tidak → pesan jujur |
| 15 | IG carousel ZIP → **YES** |
| 16 | YouTube → **prioritas VIDEO (MP4)**; audio sebagai mode kedua |

## E. Dev Tools
| No | Keputusan |
|----|-----------|
| 17 | WebSocket/SSE di API tester → **YES ("best option")** |
| 18 | Code runner → **Piston API** (gratis, no-key, limit lebih besar tanpa perlu signup) |
| 19 | Canvas IDE → **dukungan keduanya: single file + project multi-file** |
| 20 | Speed test basic → **OK** (P2, keterbatasan GitHub Pages diakui) |

## F. Security
| No | Keputusan |
|----|-----------|
| 21 | QR → **static only** (dynamic butuh server — bukan) |
| 22 | Hash → **tanpa bcrypt/argon2**; MD5/SHA1/2/3/CRC32/HMAC cukup |
| 23 | HIBP pwned check → **TIDAK perlu**, password tool tetap (tetapi tanpa network) |
| 24 | AI API → **BYOK: user beri key sendiri (Gemini/OpenAI-compatible)** |

## G. AI
| No | Keputusan |
|----|-----------|
| 25 | Caption → **vit-gpt2 in-browser (transformers.js) — best gratis** |
| 26 | Sketch → **FREE lokal** (preprocess + classifier), tanpa paid pipeline |
| 27 | Chatbot → **semantic retrieval (MiniLM v2 lokal) + BYOK LLM** |
| 28 | Humanizer disclaimer → **YES/di-statement** |

## H. UX — diputuskan oleh AI (user tidak tahu, arahan: kerjakan)
| No | Keputusan |
|----|-----------|
| 29 | History localStorage → **ya untuk: JSON, base64, downloader, QR, hash — tidak untuk semua tool** |
| 30 | ⌘K global search → **YES** (kecil, bermanfaat) |
| 31 | Deep-link per tool → **YES** |

---

## ⚠ Tindak lanjut yang perlu user
1. **Repo GitHub sedang dibuat** — setelah jadi, beri tahu nama akun/repo apa yang user mau (atau pakai otomatis `Fadhlijeu/UtiliBox`? Pertanyaan: user tulis nama akun GitHub-nya).
2. Keputusan #29/30/31 diputuskan AI karena user menjawab "idk" — bisa direvisi kapan saja.