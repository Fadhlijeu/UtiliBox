# 09 — UI Design System
## UtiliBox · Design System & Visual Identity (Hallmark, anti-AI-slop)

<!-- Hallmark · genre: modern-minimal · tone: utilitarian-tech -->
<!-- Skills: hallmark, ui-ux-pro-max, design-system-architect -->

---

## Design Philosophy

> **"UtiliBox adalah kotak alat, bukan etalase."**

UtiliBox tampil sebagai **workshop digital** — alat yang langsung bisa dipakai, tanpa hiasan yang menghalangi kerja. Bukan SaaS template, bukan dashboard premium penuh glassmorphism, bukan "landing page AI default".

Tiga prinsip:
1. **Fungsi dulu** — setiap elemen UI punya pekerjaan; tidak ada dekorasi demi tampil
2. **Kepadatan terukur** — tools kompak, informasi padat, tanpa kekosongan tak-berguna
3. **Satu-satunya "wow" adalah hasil** — kecepatan, presisi, dan kerapian kerja

---

## Genre & Tone

- **Genre**: Modern-Minimal (Stripe/Linear school) — dari Hallmark
- **Tone**: Teknis · Tegas · Utilitarian — "developer tool, bukan toy app"
- **Anti-slop check**: tidak ada gradient blur hero, tidak ada emoji hias, tidak ada glassmorphism berlebihan, tidak ada animasi lucu, tidak ada ilustrasi "teamwork" generik, tidak ada fake testimonial/statistik.

---

## Color Tokens (OKLCH)

```css
:root {
  /* paper — abu dingin, workstation like */
  --color-paper-base: oklch(98% 0.003 250);
  --color-paper-1:    oklch(96% 0.004 250);
  --color-paper-2:    oklch(92% 0.005 250);
  --color-paper-3:    oklch(88% 0.006 250);
  --color-paper-4:    oklch(84% 0.007 250);
  --color-border:     oklch(88% 0.006 250);
  --color-border-strong: oklch(82% 0.008 250);

  /* ink */
  --color-ink:        oklch(18% 0.01 255);
  --color-ink-2:      oklch(38% 0.01 255);
  --color-ink-muted:  oklch(55% 0.008 255);

  /* accent — amber workstation: "focus" */
  --color-accent:        oklch(70% 0.15 75);
  --color-accent-ink:    oklch(20% 0.02 75);
  --color-accent-dim:    oklch(70% 0.15 75 / 0.14);
  --color-focus:         oklch(66% 0.16 75);

  /* semantic */
  --color-success: oklch(62% 0.14 152);
  --color-error:   oklch(55% 0.21 27);
  --color-warning: oklch(72% 0.15 80);
  --color-info:    oklch(62% 0.13 240);
}
```

Dark mode (tahap 2, P1) — swap paper/ink; aksen tetap.

---

## Typography

- **Display/heading**: `Inter` (atau `Geist`) weight 600, *never italic* (Hallmark gate 38a — tidak ada heading italic).
- **Body/UI**: `Inter` 400/500; ukuran 13-14px (tool density), label 12px uppercase.
- **Mono** (hasil, kode, metrik): `JetBrains Mono` 12.5-13px.
- 8pt baseline type scale: 12 / 13 / 14 / 16 / 20 / 28 / 36.

---

## Layout & Struktur (Macrostructure: Ecosystem Index ↔ Workbench)

- Home: **tool index grid** (kategori sebagai rail kiri, tools sebagai grid 3-4 kolom) — bukan hero→feature→CTA pattern slop.
- Setiap tool: layout **"Nilik studio"**: kiri = panel kontrol (input), kanan = panel hasil (live) — seperti tool desktop nyata.
- Toolbar global: search tools (⌘K), theme, reset, link home.
- Tidak ada carousel, tidak ada marquee, tidak ada "hero dengan gambar stock".

---

## Komponen Inti

### Dropzone
```
┌────────────────────────────┐
│  [⬆ icon]  Drop file here  │  ← dashed border, paper-2,
│  atau "browse" (50MB max)  │     tidak aksi di hover body
└────────────────────────────┘
```

### Tombol
- Primary: `accent` solid, ink dark; **bukan gradient**, radius 8px, tidak ada glow.
- Secondary: paper-3 border; 44px min hit area.
- State: hover (darken 2-3%), active (translateY 1px), focus-visible (2px focus ring), disabled (30% opacity), loading (spinner inline "Memproses…").

### Tabs dalam tool
- Underline accent aktif (bukan pill gradient) — seperti Linear.
- Radio group (GROUPS untuk mode di dalam tool: "AES/RSA", dll).

### Progress
- Bar tipis 2px, stroke accent; % + status teks (mis "Mengompres halaman 3/12").
- Untuk task > 2s: cancel button.

### Toast
- Bottom center, kiri ikon — success/error, auto-dismiss 3.5s, action "Buka".

### Hasil export
- Row aksi: [Download] [Copy] [Preview] — mono font untuk nama file.

---

## Motion (restrain)

| Elemen | Gerak |
|--------|-------|
| Hover card tool | outline accent 1px, no lift |
| Tool switch | 120ms fade/slide 4px |
| Progress | only bar width |
| Dropzone draft | icon rotates? — tidak. hanya bg tint. |
| Toast | 160ms entrance |

- Max 200ms untuk UI kedit; `prefers-reduced-motion` → semua 0ms.
- **Tanpa**: parallax, floating orbs, gradient animation, confetti, skeleton shimmer berlebihan.

---

## Icon

- **Material Symbols Outlined** (Google fonts icons, sama dengan Peak Gallery pattern) — dengan rules: 20-24px, stroke-consistent, kotak aksi 36px.
- Ikon per tool dibuat **"toolbox iconography"**: setiap tool → satu ikon material dengan label tool naming singkat (B2: "PDF", "OCR"... pastikan tidak ambig).

---

## Brandmark

- Wordmark: `UtiliBox` — setengah text setengah kotak SVG sederhana (3 kotak nested = "box"). 
- Favicon: sama, 32px.
- Warna brand: paper + accent amber + ink.

---

## Aksesibilitas & 教

- Contrast AA: ink pada paper (cukup), aksen di paper untuk border ≥ 3:1.
- Keyboard: toolbar focusable, tool kanan tab order logis, modals fokus trap.
- Screen reader: lang="id", label semua, aria-live pada status processing.
- Reduced motion, trypografia min 12px, touch 44px.
- Bahasa: UI bilingual ID default (english toggle P2) — konsisten di semua tool.

---

## Anti-Slop Checklist (ini jalur wajib)

1. Headline italic? → **tidak pernah**.
2. Gradient border fake chrome? → tidak.
3. Statistik palsu ("10x more")? → **tidak ada angka marketing di landing**.
4. Emoji sebagai ikon UI? → tidak; Material Symbols.
5. "AI slop spacing" ratio seragam 100px? → spacing sistematis 4/8/16/24/dst.
6. Tombol CTA "Coba gratis" di setiap hero? → tidak (bukan landing commercial).
7. Font display serif italic besar-besaran? → tidak (mono + sans utilitarian).
8. Bounce/spring dramatis? → tidak (ketat & teknis).

---

## Content / Copywriting

- Label pendek imperatif: "Gabung", "Split", "Hapus bg", "Kompres" (Verbatas — copy skill: verb-first).
- Error: bahasa manusia: "Arsip PDF ini terlampau besar. Maks 100 MB." — bukan "Error 500".
- Empty & loading state: jujur ("Mengunduh model OCR (12 MB) — pertama kali saja").