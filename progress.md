# UtiliBox — Session Progress Log

> ⚠️ **JIKA SESSION TERPOTONG/PUTUS: BACA FILE INI DULU.** Ini adalah memori kerja —
> prompt & respons terakhir, keputusan desain, progres, dan langkah berikutnya.
> Update file ini di akhir setiap sesi kerja.

---

## Cara pakai (untuk agent)

1. Saat sesi baru dimulai, baca `PROGRESS.md` ini + `workflows/` + `src/` state terkini.
2. Lanjutkan dari bagian **Next Move** / **Progress Terbaru**.
3. Selalu jalankan `npm run lint && npm test && npm run build` sebelum commit.
4. Update bagian **Log Aktivitas** di akhir sebelum menyerahkan hasil.

---

## Ringkasan Proyek

- **UtiliBox** — GitHub Pages SPA (Vite + vanilla TS), 30+ tools client-first.
  Repo: `D:\PROJECT\UtiliBox` | live: `https://fadhlijeu.github.io/UtiliBox/` (deploy via GHA otomatis).
- Arah UX (dari user, wajib dipatuhi): preview- sebelum-commit (output "commit before push" - tombol), progress bar wajib (`busy()`), semua file visionable thumbnail, tombol contextual disabled (bukan hilang), tool-shell (tab fitur + view hasil terpisah + undo/redo/reset + handoff "oper file").
- Ruang tes: `tests/` (vitest, node env, 26 tests pass). Perpustakaan: pdf-lib, pdfjs-dist v6 (lazy), exifr, marked, js-yaml.

---

## Prompt Terakhir (User — round 2 sesi ini)

> "sip UI sudah oke tapi begini: merge tampilin preview pages nya tiap file (previewnya gabungan dari beberapa file setelah upload),
> split juga harus ada preview pages setelah upload dan preview pages setelah split seperti organizer,
> lalu saya mau semua fitur punya drag n move page.
> perbaiki delete page error parah: saya pilih beberapa tapi kehapus semua, saya pilih sedikit yang kehapus banyak. tiap file fiturnya jadi independen.
> ui delete picker juga perbagus, jangan hanya kasih border kuning sebagai indikator."

### Response / Keputusan (round 2)

- **ROOT CAUSE "delete parah" (F-77)**: pdfjs v6 **mentransfer (detach) ArrayBuffer** yang dikirim ke `getDocument({data})`. Kode lama `new Uint8Array(bytes)` itu **view berbagi buffer, bukan copy** → begitu thumbnail/grid dirender, `pdf.data` jadi **detached (kosong)** → extract/delete/save kacau ("pilih sedikit kehapus banyak"). FIX: semua input pdfjs wajib **`bytes.slice()`** (copy beneran) di `thumb.ts` (fileThumb + pdfPageThumbs). `toPdfBytes` di pdf-core aman karena pdf-lib tidak detach.
- **Merge**: flat grid preview GABUNGAN semua halaman semua file (`{entryIdx, page}`), tag nama file + urutan + p×n; drag antar-halaman lintas file + tombol ◀▶; merge urut sesuai urutan grid; output `extractPages(page-1)` per item + `mergePdfs`.
- **Split**: per-file preview halaman setelah upload; drag reorder (`pdf.order`); **klik halaman = pilih range** (input terisi posisi); split pakai `splitPdfByOrderRanges` (baru, +2 unit test) → hasil split strip Pages otomatis kebuka di output panel.
- **Semua fitur drag-move page**: helper `bindDnd` + `isCleanClick` (state di-reset dragend/drop → tak ada click-after-drag ghost); `moveButtons` ◀▶ per cell (sentuh).
- **Picker delete**: fill accent + badge centang (anim) + `.selection-bar` "N selected · Clear · Delete" — bukan border kuning doang.
- **Independen per file**: tiap section punya `selected` + `state` sendiri; `renderSections` guard `isConnected` supaya listener zombie dari tab lain tidak re-render.
- **Fix halus lain**: `posOf(item)` closure (bukan `items[idx]` stale); chip posisi merge pakai `.page-cell__pos` (bentrok `.page-cell__no` absolute).

---

## Prompt Terakhir (round 1 sesi ini)

> "oke, UInya jelek banget top bar jelek, terus kenapa ada dua display 'No files yet — drop files below' & 'No files yet — merge needs 2+', bikin ini optimal,
> undo, redo, reset itu muncul ketika sudah upload file + fitur digunakan.
> lalu preview tiap page itu ada di tiap fitur astaga, label delete bukan organize, organize untuk drag and drop move page,
> tombol back to features aja gagal, preview akhir itu preview tiap page dan preview workspace,
> preview workspace kenapa gede banget dan masalah belum muncul di bawah, cukup ukuran yang bagus,
> halaman website yang baru, dan bisa back ke halaman sebelumnya,
> jika fitur tunggal seperti split dan delete misalnya, jika ada multiple file, maka fitur berlaku tiap file, misal file: file 2:
> Update workflows, oiya kamu ada fitur potong session, buat folder baru progress.md yang isinya prompt dan aktualisasi dan saran dan progress serta aktivitas yang kamu lakukan, supaya jika terpotong harus baca progress"

### Response / Keputusan (dipakai)

- **UI jelek**: sebab utama = banyak komponen baru (tool-shell, tabs, history, result-view, preview overlay, file-section) sama sekali BELUM punya CSS → ditambahkan blok besar di `components.css`.
- **"No files yet" dobel**: status bar kini kosong saat belum ada file (dropzone punya label/hint sendiri). Sisa.
- **Undo/Redo/Reset muncul setelah aktivitas**: `ToolShell` baru punya state `hasActivity`; method `shell.activity()` dipanggil saat ada file masuk/edisi mutable; history-bar `hidden` sampai ada aktivitas.
- **Page preview di tiap fitur**: grid tiap-halaman (pdfPageThumbs) HANYA di Organize; Merge/Split pakai file-list kompak (thumb kecil 40px).
- **Label**: tab `Organize` = drag & drop reorder + delete + undo/redo + save (`pdf.order` sebagai urutan halaman; snapshot `{data, order, pages}` untuk undo/redo).
- **Back-to-features gagal**: tombol `[data-back]` tidak pernah dipasang click handler → sekarang dipasang di dalam `ToolShell` (menampilkan workspace, hide resultWrap).
- **Preview**: jadi modal overlay terpusat (≤920px, ≤86vh), tombol Back + Download + Escape + klik backdrop menutup; `history.pushState` sehingga **tombol back browser juga menutup** preview.
- **Preview hasil PDF**: tombol "Pages" per file output → strip thumbnail setiap halaman (pdfjs).
- **Per-file features**: Split & Organize menampilkan satu section per PDF ("File 1: name.pdf" + kombinasi sendiri).
- **Icon gagal render**: `src/pages/tool.ts` memakai class `material-icons-outlined` (tidak nyambung) → diganti `material-symbols-outlined` (F-73).
- **progress.md**: file ini.

---

## Progress Terkini (commit terakhir saat sesi ini)

- Rebuild `src/tools/pdf-organizer/index.ts` (3 fitur tab: Merge/Split/Organize):
  - Merge: hint, disabled <2 file, image→PDF, hasil `ctx.showResult`.
  - Split: per-file sections ("File N: nama.pdf"), prefill range `1-N`, output per file.
  - Organize: per-file grid; drag & drop reorder (`dragstart/dragover/drop`, `pdf.order`), select+delete (snapshot undo/redo), Save (url pesanan).
  - `fileListEl` kompak (row kecil; thumb kecil; tombol x).
  - Intake `takeHandoff("pdf-organizer")` → auto-add files; `SAME_TOOL_EVENT` listener → `shell.activate(feature)`.
- **ToolShell** (`src/components/tool-shell.ts`):
  - Back button `[data-back]` wired (fix), history bar muncul hanya setelah aktivitas (`activity()`), `opts.onReset`, fix `disabled` undo pakai `history.length`.
- **OutputPanel** (`src/components/output-panel.ts`):
  - Row baru: item output-card, Pages toggle (per-page strip), Preview modal (back/Esc/browser-back, Download) `nativeHistory`.
- **CSS** di `src/styles/components.css`: blok baru (tool-head, feature-tabs, history-bar, result-view, file-section per-file, page-cell dragstate, output-grid/page-strip, preview-overlay modal, icon sizing + `material-symbols` fix).
- **Wiring**: `SAME_TOOL_EVENT` lis di organizer; fix class icon di `tool.ts`.
- **Workflow**: F-68..F-73 ditambahkan di `01_requirements.md` + ringkasan di `07`.

Status sesi ini: lint ✅, test ✅ (26), build ✅. Terakhir di-cek komitman: "feat: tool-shell..." (098f0f5 belum termasuk perubahan sesi ini).

---

## Next Step (lanjut di sini)

1. **Uji manual di browser** (user meng-check di Pages setelah deploy) — item yang berpotensi bug:
   - Drag & drop antar cell (HTML5 DnD di mobile tidak jalan; boleh ditambah fallback tombol pindah ◀ ▶).
   - `Organize` dengan 2+ PDF: tiap section independen.
   - Undo setelah delete: render ulang grid dan pastikan `pdf.data` benar.
   - Preview modal: kompetisi Back popstate.
2. **Handoff antar tool nyata**: verifikasi `Send to` → tool tujuan (compress, convert) dan intake. Tool tujuan lain belum pakai ToolShell (fitur "core" tab masih lama) — kecuali diminta, jangan pindah. 
3. Commit & push sesi ini (belum di-commit!):
   `feat: tool-shell UI polish, organizer per-file + drag-drop reorder, output preview modal + pdf page strip, icon fix (F-68..F-73)`
4. Jika perlu: registrasi pembagian kerja/doc perubahan 07 + `README`.

---

## Log Aktivitas

| Tanggal/Sesi | Aktivitas |
|---|---|
| 2026-08-10 (round 2) | **Drag DnD Fix & Lineage Timeline**: FIX HTML5 Drag & Drop (`setData` & `effectAllowed`); Fix positioning popover dropdown agar dekat tombol & tidak terpotong viewport (`12px` margin); Auto-close Result View saat "Send to..." / klik timeline card (`closeResult()`); Multi-level flyout Send-to dropdown (dengan filter exclude self-feature); Explicit Undo/Redo labels (`Moved page 3 to 1`, `Deleted 2 page(s)`); File History Timeline dengan arsitektur Main vs Branch lineage (`[Merge ➔ Split]`). |
| 2026-08-10 (sesi ini) | **UX & History Refactoring**: Per-file history bar di atas preview grid untuk Split & Organize, 1 batch history bar untuk Merge; Reset mengembalikan ke baseline original tanpa hapus file; Tombol 'Delete all files' di header file list; Hamburger menu dropdown untuk checkpoints Undo/Redo; Fix scroll jump di file >25 halaman (`withScrollPreserved` & mengganti `<button>` dengan `<div class="page-cell" tabindex="0">`); Visual flow 'All' action buttons dipindah ke paling bawah (Upload > Preview > Output > Download/Action All). |
| 2026-08-09 (round 1) | Rebuild organizer (organizer per-file sections, drag reorder, undo/save); ToolShell back-button + aktivitas; OutputPanel modal preview + Pages strip; CSS semua komponen baru; fix icon `material-symbols-outlined` di tool.ts; handoff same-tool wiring; workflow F-68..73; buat progress.md ini |
| 2026-08-09 (round 2) | **FIX detach pdfjs `bytes.slice()`** (root cause delete parah); merge flat-grid preview + drag lintas file; split dengan preview + pilih-range/drag + `splitPdfByOrderRanges`; drag-move universal (bindDnd/isCleanClick/◀▶); picker delete (badge+fill+selection bar); independen per file; auto-open Pages strip PDF; F-74..F-78 |

## Tips

- Jangan taruh `material-icons-outlined` — IT DOESN'T EXIST in this project. Selalu `material-symbols-outlined`.
- `pdfjs-dist@6` detaches input buffer → selalu kirim COPY (`new Uint8Array(bytes)`).
- `pdf-lib` butuh `Uint8Array<ArrayBuffer>` → `toPdfBytes` di `pdf-core.ts`.
- Perintah: `npm run dev` (lokal), `npm test`, `npm run lint`, `npm run build`.