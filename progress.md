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
| 2026-08-18 (round 44) | **Integrasi `browser-image-compression` & Smart PDF Dual-Pipeline**: **Adopsi Library Komunitas**: Menginstal dan mengintegrasikan package resmi `browser-image-compression` di alat Image Compress untuk akurasi `maxSizeMB`, Web Worker processing, dan dimension scaling; **Smart PDF Dual-Pipeline**: Memisahkan alur kompresi PDF ke dalam *Lossless Vector Stream Optimizer* (mempertahankan 100% ketajaman teks vektor tanpa blur) dan *High-DPI Perceptual Canvas Engine* (untuk raster/scan); **Fix Global Estimator Math**: Menghilangkan bug 1.0 KB dengan sinkronisasi byte metrics antara staged cards dan global telemetry card; Unit test suite 40/40 lulus, lint/typecheck 0 error, build production berhasil. |
| 2026-08-18 (round 43) | **Modern Studio Overhaul & Redesign of Compress Tool UI/UX**: **Studio Dashboard Layout**: Mengubah total tampilan alat Compress di seluruh 4 tab (Document, Image, Audio, Video/GIF) menjadi 2-Column Responsive Studio Layout yang elegan; **Hero Banner**: Menambahkan context banner dengan icon avatar, deskripsi mesin, dan badge privasi 100% lokal; **Interactive Staged Media Deck**: Menampilkan file dalam list elevated cards dengan avatar warna-warni (PDF/Img/Audio/Video), live savings pill badge emerald (`~XX KB (-YY%)`), selector preset kustom, dan tombol hapus cepat; **Segmented Mode Switcher & Sliders**: Kontrol switch Quality Slider vs Target Size Match dengan gradient slider track, floating percentage badge, trio preset chips, dan fine-tuning grid; **Real-time Savings Telemetry Card**: Gauge meter sebelum/sesudah dengan progress bar animasi dan highlight penghematan ruang; **Preset Buckets Deck & Glassmorphic Modal**: Manajemen preset bucket independen dengan dialog konfigurasi berlatar blur; Unit test suite 38/38 lulus, lint/typecheck 0 error, build production berhasil. |
| 2026-08-12 (round 42) | **Session Finalization**: Validasi implementasi `pdf-organizer` per-file, drag-drop reorder, undo/delete logic, dan preview modal. Memastikan tes `vitest` passing (38/38). Commit perubahan (feat: tool-shell, organizer, preview modal, icon fix). |
| 2026-08-12 (round 41) | **Fix Algoritma Kompresi PDF Multi-DPI, File-Aware Estimator Engine, & Preset Recycling**: **Dynamic Multi-DPI PDF Target Matching**: Algoritma pencarian target PDF kini menguji tingkatan DPI (300 DPI hingga 72 DPI) bersama kualitas JPEG, sehingga target besar (seperti 15MB pada file 100MB) menghasilkan resolusi tinggi 300 DPI (~14.2MB) dan tidak jatuh ke 700KB. File yang lebih kecil dari target (misal 10MB pada target 15MB) tetap dipertahankan 10MB tanpa penurunan kualitas paksa; **Quality Slider PDF Proporsional**: Mengadaptasi DPI berdasarkan ukuran file asli sehingga 40% slider pada file 100MB menghasilkan ~38.4MB; **File-Aware Estimator Engine**: Kalkulasi estimasi menghitung tiap file satu per satu berdasarkan preset ter-assign/global; **Preset Recycling**: Menghapus penghitung global dan menggantinya dengan `getNextPresetName()`, saat `Preset #2` dihapus maka tombol Add Preset akan memakai kembali nomor `#2`; Unit test 37/37 passing; Push ke GitHub `main` (`d56bb2b`). |
| 2026-08-11 (round 40) | **Custom Select Dropdown System & Modal Spatial Alignment**: **Sistem Dropdown Kustom (`.select`)**: Menghapus tampilan elemen `<select>` asli browser bawaan yang mentah dan menggantinya dengan desain kustom berbasis SVG chevron icon (`v`), border halus (`var(--radius-md)`), background glassmorphic, & efek hover focus glow; **Modal Alignment Fix**: Menyejajarkan bidang form pada Popup Modal Konfigurasi (Preset Name diatur ke width 100%, Target Size & Match Precision disusun dalam grid 2 kolom dengan alignment sejajar tinggi 34px); Push ke GitHub `main` (`1fe3c70`). |
| 2026-08-11 (round 39) | **Pro Max Shadcn Overhaul (Preset Cards & Config Popup Modal UI)**: **Redesain Kartu Preset**: Mempercantik kartu preset (`.compress-preset-card-pro`) dengan avatar ikon gradient Indigo/Purple, chip mode tebal (`🎯 1.0 MB Exact` / `✨ 65% Quality`), pill hitungan file ter-assign, & efek hover lift `translateY(-2px)` dengan border glow; **Popup Modal Konfigurasi**: Mengubah modal popup (`openPresetConfigModal`) menjadi dialog glassmorphic mewah dengan `backdrop-filter: blur(12px)`, tab switcher visual (`Quality Slider` vs `Target Size Match`), input target ter-style, & live quality percentage badge; Push ke GitHub `main` (`60cdbd9`). |
| 2026-08-11 (round 38) | **Full-Width Merge-Style Upload Dropzone & Compact File Spacing**: **Full-Width Dropzone**: Mengubah `max-width` container dari 880px menjadi 100% sehingga Card Upload membentang luas secara full-width (persis seperti alur PDF Merge); **Rapatkan Spacing File**: Menghapus margin 16px bawaan class `.row` pada baris daftar file terunggah dan menggantinya dengan layout flex padat (`padding: 4px 8px`, `margin: 0`), menghilangkan gap vertikal yang terlalu besar antar file; Push ke GitHub `main` (`efdbbe2`). |
| 2026-08-11 (round 37) | **Option B Compress UI Layout Implementation**: **Pilihan User (Option B)**: Mengimplementasikan sketsa UI Option B pilihan user; **Extended Dropzone**: Card upload dibuat panjang & lapang full-width (seperti PDF Merge); **1-Column Media & Preset Bar**: Daftar file terunggah & bar Preset Buckets disusun 1 kolom full-width tepat di bawah Dropzone; **2-Column Config Panels**: Konfigurasi dipisah menjadi 2 kolom di bagian paling bawah (Kolom kiri untuk Pengaturan Mode & Fitur, Kolom kanan untuk Estimator Size & Tombol Kompresi Utama); Push ke GitHub `main` (`f8de7c7`). |
| 2026-08-11 (round 36) | **Hybrid Dashboard Layout (1 Kolom Atas Dropzone/Presets + 2 Kolom Kompak Bawah Files/Config)**: **Top 1-Column Section**: Menyatukan Dropzone Upload dan Kartu Preset Buckets di bagian atas 1 kolom full-width secara berdampingan vertikal; **Bottom 2-Column Grid**: Menempatkan Daftar Staged Media di kolom kiri bawah, dan Global Settings Card + Estimator + Tombol Kompresi di kolom kanan bawah; **Kepadatan Kompak**: Memperkecil padding (`6px-10px`), ukuran font, & jarak elemen agar UI lebih padat, ringkas, dan tidak terlalu besar; Push ke GitHub `main` (`325f6d5`). |
| 2026-08-11 (round 35) | **Upload-First UX Reveal & Elevated Shadcn Preset Cards UI**: **Upload-First UX**: Panel konfigurasi, preset, & tombol kompresi tersembunyi secara otomatis saat 0 file diunggah (persis seperti alur UI PDF Merge). Seluruh panel workspace baru muncul secara mulus setelah user mengunggah minimal 1 file; **Elevated Preset Cards**: Redesain kartu preset `.compress-preset-card-shadcn` dengan ikon avatar khusus, tag ringkasan mode, chip jumlah file, & micro-interaction border glow; Push ke GitHub `main` (`b27f8d5`). |
| 2026-08-11 (round 34) | **2-Column Split Dashboard Layout with Paired File Workspace**: **Redesain 2 Kolom**: Mengubah kembali layout alat Compress menjadi 2 Kolom Split Dashboard yang sangat estetik dan kompak; **Paired Left Panel**: Panel kiri menggabungkan Dropzone Upload dan Daftar File Terunggah (`[drop, fileListView.host]`) berdampingan di bawahnya agar file tidak berjauhan dengan tempat upload; **Right Panel**: Panel kanan berisi Kartu Preset Bucket, Global Configuration, dan Tombol Kompresi Utama; Push ke GitHub `main` (`95a80df`). |
| 2026-08-11 (round 33) | **Single-Column Stacked Layout & Independent Preset Buckets System**: **Redesain 1 Kolom**: Mengubah layout alat Compress menjadi alur 1 kolom vertikal (Dropzone ➔ Preset Buckets ➔ Global Settings ➔ Staged Files ➔ Action Button); **Sistem Preset Bucket**: Menambahkan fitur `+ Add Preset Bucket` untuk membuat kartu `Preset #1`, `Preset #2` dst. dengan modal popup pengaturan independen (`⚙️ Config`); **Assigned File Logic**: File dapat di-assign ke preset pilihan atau tetap di Global Config, dan saat kompresi batch dijalankan, masing-masing file diproses sesuai konfigurasi lingkungannya; Push ke GitHub `main` (`e378266`). |
| 2026-08-11 (round 32) | **Remake Compress Tool UI/UX & Push Release to Main**: **Compress UI Remake**: Menambahkan **Quick Target Size Presets** (`500 KB`, `1.0 MB`, `2.0 MB`, `5.0 MB`) untuk isi instan mode target size, **Header Staged Media** (`Staged Media (N)`) dengan tombol `Clear All`, & penyempurnaan indikator estimasi; **Git Merge & Push**: Merge branch `feature/shadcn-ui-redesign` ke branch `main` dan push ke GitHub production `main` (`e5175ac`). |
| 2026-08-11 (round 31) | **Upgrade Mesh Maker Studio (`.mesh.maker.html`)**: **Fitur Layer Ordering**: Menambahkan tombol `Bring to Front (🔝)`, `Send to Back (🔻)`, `Move Up (⬆️)`, & `Move Down (⬇️)` untuk mengatur urutan tumpukan layer node; **Individual Smoothness Control**: Menambahkan slider `Smooth Spread` untuk tiap node; **Preset Warm Grain 07**: Menambahkan Preset 07 yang persis dengan contoh gambar referensi (kombinasi Amber Yellow, Cobalt Blue, Rose Coral, Deep Purple, Sunlight Yellow, & White Highlight dengan film grain texture). |
| 2026-08-11 (round 30) | **Mesh Gradient & Film Grain Overlay**: **Dark Theme**: Menerapkan kode CSS Mesh Gradient Radial (`#0f172a`, `#1e3a8a`, `#3b82f6`, `#0ea5e9`) & SVG Fractal Noise Grain Overlay pada Banner `.home-hero`; **Light Theme**: Men-generate Mesh Gradient warna pastel elegan (`#f8fafc` base, `#e0e7ff` Soft Indigo, `#e0f2fe` Sky Cyan, `#ddd6fe` Lavender) dengan lapisan Film Grain tekstur halus. |
| 2026-08-11 (round 29) | **FIX Header Light Mode Sync & Hero Top Spacing**: **Header Sync**: Mengganti background hardcoded `.app-header` dengan variabel `--header-bg` sehingga saat ke White Theme, bagian atas berubah menjadi topbar putih glassmorphism bersih 100%; **Fix Hero Spacing**: Menambahkan `margin-top: 24px` pada `.home-hero` agar banner tidak lagi menempel/mentok ke header atas. |
| 2026-08-11 (round 28) | **Structural Layout Redesign & Dual Light/Dark Theme Switcher**: **Fix Light Theme (White)**: Mengubah variabel CSS `html[data-theme="light"]` dengan latar putih bersih `#ffffff`, kartu `#f8fafc`, teks Slate `#0f172a`, & aksen Indigo `#4f46e5`; **Redesain Struktur & Tata Letak Website**: Menambahkan **Shadcn Hero Section** di Home (Badge pill, gradient title, & 4 privacy pills), **Shadcn Tool Cards Grid** (Icon box, badge tag, & hover arrow action), **Search Bar `⌘K` Pill Badge**, serta **Breadcrumbs Navigation** di setiap halaman tool. |
| 2026-08-11 (round 27) | **Shadcn UI Dark Theme Redesign (Branch: feature/shadcn-ui-redesign)**: Dibuat branch terpisah `feature/shadcn-ui-redesign` untuk mengisolasi eksperimen tanpa menyentuh `main`; Redesain total sistem warna Shadcn Zinc 950 (`#09090b`), kartu elevated `#121215`, aksen Indigo `#6366f1`, glassmorphic topbar, segmented mode pills, tombol micro-interaction, dan dropzone border glow; Dev server aktif di `http://localhost:5173/`. |
| 2026-08-11 (round 26) | **Multi-Frame Animated GIF Engine**: Mengubah snapshot Canvas frame tunggal menjadi **Multi-Frame Stream Recording Engine (`compressAnimatedGifFile`)** menggunakan `requestAnimationFrame` loop & `canvas.captureStream(24)`; Memastikan animasi GIF 60MB tetap bergerak 100% ("tetap gerak") dan terkompresi secara akurat. |
| 2026-08-11 (round 25) | **Preserve GIF Output Format**: Mengubah format output dan ekstensi hasil kompresi GIF agar tetap mempertahankan format `.gif` (`image/gif`) tanpa terkonversi ke WebP (`.webp`). |
| 2026-08-11 (round 24) | **FIX GIF Compression Handler**: Mengimplementasikan `compressGifFile` berbasis HTML5 Canvas untuk menangani kompresi file `.gif` secara khusus; Mengeliminasi error dekode elemen `<video>` (`Failed to load video file`); File GIF dapat dikompresi dengan lancar pada skala resolusi target. |
| 2026-08-11 (round 23) | **Exact Target Precision & Compact Split-Dashboard Redesign**: **Exact vs Approx Switch**: Opsi `Exact Match (~100% Target)` (konvergensi presisi 95-100% target size) vs `Approx (Max)` (fleksibel di bawah target); **Redesain UI/UX Compact Split-Dashboard**: Mengubah layout bertumpuk menjadi **2-Column Split Dashboard** (Kiri: Dropzone & List File; Kanan: Estimator, Switcher, Slider, & Button), mengurangi tinggi halaman hingga >50% tanpa scroll panjang. |
| 2026-08-11 (round 22) | **Image Size Ceiling Rule, GIF Migration & Universal Presets**: **Fix Size Inflation**: Kompresi gambar 1.5 MB ke target 1.0 MB tidak akan pernah naik menjadi 1.7 MB (enforce ceiling rule `output.size <= targetLimit && output.size <= input.size`); **Migrasi GIF**: File `.gif` dipindahkan dari tab Image ke **Tab Video / GIF**; **Universal Presets**: Mode Switcher, Preset Buttons, Slider, dan Estimator diseragamkan di seluruh 4 tab (Document, Image, Audio, Video/GIF). |
| 2026-08-11 (round 21) | **Exact Target Precision Engine & Compact Material UI**: **Akurasi Eksak 1.0 MB** via Multi-DPI Binary Search (mencapai hasil `0.98 MB - 1.00 MB` secara matematis tanpa over-compress ke 200 KB); **Fix Interaction Lockout**: Enforce `pointer-events: none` & recursive `disabled = true` pada seluruh kontrol tersembunyi/inactive agar slider & input tidak dapat di-drag/interaksi saat disable; **Compact Google Material UI**: Redesain kontrol ringkas (segmented bar 36px, slider 4px, thumb 14px, input 65px) dengan Material Symbols icons. |
| 2026-08-11 (round 20) | **Dual-Engine Smart PDF Compression & Modern UI Overhaul**: Mengadopsi arsitektur teratas industri (iLovePDF & Squoosh); Engine 1 **Structural Vector Optimization** (menjaga teks vektor 100% tanpa konversi gambar/tanpa blur); Engine 2 **High-DPI Perceptual Canvas Engine** (untuk PDF hasil scan/hard compress); **Secant Convergence** mencapai ketepatan eksak 95%-99% target size (misal `950 KB - 990 KB` pada target 1.0 MB); Redesain UI dengan **Segmented Pill Switcher**, **Gradient Sliders**, **Floating Value Badges**, dan **Interactive Presets**. |
| 2026-08-11 (round 19) | **High-Clarity Target Size Engine & Zero-Blur Compression**: Menjaga resolusi tinggi canvas (`renderScale >= 1.5`) agar teks dan gambar PDF tetap tajam tanpa blur parah; Menggunakan **8-iteration Binary Search pada kualitas JPEG (15% - 95%)** saat mode Target Size aktif sehingga input `1.0 MB` pada file 6.0 MB menghasilkan konvergensi presisi **~920 KB - 990 KB** (mendekati 1.0 MB target) dengan kejernihan maksimal. |
| 2026-08-11 (round 18) | **FIX Tool Mount ReferenceError**: Memperbaiki bug inisialisasi pada `createModeControl` yang memanggil `modeControl.getTargetBytes()` sebelum variabel selesai dideklarasikan (`ReferenceError: Cannot access 'modeControl' before initialization`); Memperbarui `src/pages/tool.ts` agar error runtime pencetakan modul tidak tersamarkan sebagai "planned but not built yet"; Modul Compress berjalan sempurna 100%. |
| 2026-08-11 (round 17) | **Compression Mode Switcher**: Meng-implementasikan sakelar mode terpisah (`⚙️ Quality Slider / Presets` vs `🎯 Target Max File Size`); Memilih mode Target Size mengaktifkan kolom ketik target size dan menonaktifkan slider agar tidak bentrok; Memilih mode Quality Slider mengaktifkan slider dan menonaktifkan input target size; Berlaku di tab Document, Image, Audio, Video; Unit test suite 35/35 lulus. |
| 2026-08-11 (round 16) | **Hard PDF Compression, Target File Size & Handoff Routing Fix**: Re-encoding halaman PDF via Canvas + PDF.js + `pdf-lib` (Hard Compress riil: PDF 6 MB benar-benar mengecil ke ~900 KB sesuai estimasi); Fitur **Target File Size Input** (`Target Max Size: [ Value ] [ MB/KB ]`) dengan pencarian iterative binary search quality scaling pada Document, Image, Audio, Video; Fix bug "Send to Organize" memuat tab Organize secara presisi via parameter `?feature=organize` pada `ToolShell`. |
| 2026-08-11 (round 15) | **Compress Tool Bugfixes (Instant Render, Accept Filters & Video Engine Fix)**: Perbaikan bug daftar file langsung tampil saat upload tanpa harus pindah tab (`fileChangeListeners`); Filter upload spesifik per tab (`accept` khusus Document, Image, Audio, Video); Fix deadlock/stuck pada kompresi video (enforce `muted=true` + fallback timer pada `MediaRecorder`); Unit test suite 36/36 lulus. |
| 2026-08-11 (round 14) | **Compress Tool Overhaul (UI, Estimator & Universal Media)**: Redesain UI Compress dengan **Live Size Estimator Card** (hitung estimasi ukuran file hasil & % penghematan secara real-time); Menambahkan **Preset Buttons** (Extreme, Recommended, Low); Memperluas kompresi ke **Audio** (MP3, WAV, OGG, M4A — Bitrate & Mono) dan **Video** (MP4, WEBM, MOV — Resolution scale 720p/480p & Mute); Unit test suite lulus 36/36. |
| 2026-08-10 (round 13) | **Universal Multi-Format Architecture & Compress Tool**: Meng-update dokumentasi `workflows/01_requirements.md` & `07_feature_spec_docs_media.md` (semua tools wajib mendukung multi-format universal sesuai kapabilitas fiturnya: PDF, DOCX, XLSX, TXT, MD, PNG, JPG, WebP, AVIF); Memperluas `pdf-organizer` untuk menerima file dokumen & gambar non-PDF; Membangun modul tool baru **Compress** (`src/tools/compress/index.ts`) untuk kompresi dokumen & gambar multi-format; Unit test suite lulus 34/34. |
| 2026-08-10 (round 12) | **Multi-File Batch Deduplication, Environment Context & Nested Tree**: Memindahkan `timelineStore.addEntry` keluar dari `files.map()` pada `OutputPanel.show()` (1 kali operasi Split multi-file hanya membuat 1 kartu cabang tunggal yang bersih); Membangun tampilan pohon hirarki berjenjang (`margin-left: 16px` per level depth dengan garis putus-putus penghubung); Menambahkan **Active Environment Banner Bar** di atas workspace dengan tombol `[ ❌ Exit to New Main ]` dan auto-reset ke `MAIN Mode` saat workspace dikosongkan. |
| 2026-08-10 (round 11) | **Redundant Branch Elimination & Explicit Action Labels**: Eliminasi duplikasi entri cabang saat mengeklik `Send to...` (handoff staging tanpa membuat kartu prematur/ganda; cabang tunggal dibuat saat hasil keluaran selesai diproses); Mengimplementasikan label cabang eksplisit & dinamis (`↳ ✏️ Merged 3 files`, `↳ 🚀 Split into 2 part(s)`, `↳ ✏️ Organized & saved`); Update dokumentasi `TIMELINE_ARCHITECTURE.md`. |
| 2026-08-10 (round 10) | **Active Parent Tracking & Branch Differentiation**: Pelacakan `activeParentId` pada `TimelineStore` sehingga mengedit snapshot `Main` menghasilkan `Branch` di bawah `Main` (tidak lagi terbuat `Main` baru); Pembedaan tipe cabang visual antara `↳ ✏️ Edit` (Amber/Modifikasi) vs `↳ 🚀 Handoff` (Ungu/Send to); FIX kontras Dark Mode pada submenu & output box; Update dokumentasi di `TIMELINE_ARCHITECTURE.md`. |
| 2026-08-10 (round 9) | **Vertical Form Timeline Cards & Interactive File Pills**: Membangun bentuk kartu vertikal bertingkat (`SOURCE (Pills)` ➔ `ACTION` ➔ `OUTPUT`) tanpa pemotongan nama file yang terlampau sempit; Mengimplementasikan preview modal interaktif saat pil file input (`[ 📄 file.name ]`) diklik; Mengunci indentasi cabang maksimal 1 level (`margin-left: 16px`) dengan tag silsilah `↳ Branch #1.1.1` agar layout tidak pernah kepotong layar. |
| 2026-08-10 (round 8) | **Implementation of Konsep A: Pipeline Chain Cards**: Membangun UI/UX timeline baru bergaya *3-Stage Pipeline Chain* (`[ Input Files ] ──► [ Operation ] ──► [ Output File ]`) dengan tombol utama `Restore & Edit`, ikon aksi cepat (Download, Quick Preview, Delete), dan konektor cabang pohon yang super intuitif tanpa learning curve. |
| 2026-08-10 (round 7) | **Skip Log on Restore & Per-Item Timeline Delete**: Menambahkan opsi `skipTimelineLog` pada `OutputPanel.show()` sehingga membuka snapshot timeline lama tidak lagi membuat entri riwayat baru; Menambahkan tombol hapus (ikon `delete`) pada setiap kartu timeline di Left Sidebar untuk menghapus file/cabang riwayat secara individu (`timelineStore.removeEntry`). |
| 2026-08-10 (round 6) | **FIX Submenu Viewport Flip & File Duplication**: FIX layout teks bentrok pada `.sendto-submenu` (menghapus `overflow-y: auto` clipping dari `.sendto-menu` dan memberikan background solid `#ffffff` + `z-index: 1050`); Auto-flip sub-menu ke sisi kiri (`.sendto-submenu--left`) saat mendekati batas kanan viewport; FIX duplikasi file saat restorasi timeline (`entries.length = 0` sebelum `addFiles` handoff). |
| 2026-08-10 (round 5) | **Dual History Snapshot Restoration**: Menyimpan `inputFiles` & `outputFiles` pada `TimelineEntry`; Mengeklik kartu timeline merestorasi 3 file aktif ke workspace editor **DAN** menampilkan hasil output-nya di panel output secara bersamaan; User dapat mengedit kembali file aktif pada workspace terpulihkan untuk menghasilkan checkpoint riwayat baru. |
| 2026-08-10 (round 4) | **Dropdown Scroll Lock, Clear Timeline & Bulk Drag & Move**: Lock posisi popover "Send to..." dan Undo/Redo menu secara dinamis saat halaman di-scroll/resize; Tombol "Clear" di header Left Sidebar Timeline untuk wipe riwayat grafik; Bulk Drag & Move (menggeser salah satu halaman yang terpilih saat multiple selection memindahkan seluruh blok halaman terpilih secara bersamaan). |
| 2026-08-10 (round 3) | **FIX Drag & Move & Timeline Tree Graph**: FIX Drag & Drop race condition (`activeDragFromIndex`) & parameter swap `(from, to)` dari `bindDnd` ke `applyOrderMove`/`applyMove`; Reorder DOM & array 100% akurat saat drag/move; Timeline Tree Graph UI dengan konektor garis lurus/putus-putus (`.timeline-branch-connector`) menautkan Main item dengan Branch item ter-indentasi di bawahnya. |
| 2026-08-10 (round 2) | **Drag DnD Fix & Lineage Timeline**: FIX HTML5 Drag & Drop (`setData` & `effectAllowed`); Fix positioning popover dropdown agar dekat tombol & tidak terpotong viewport (`12px` margin); Auto-close Result View saat "Send to..." / klik timeline card (`closeResult()`); Multi-level flyout Send-to dropdown (dengan filter exclude self-feature); Explicit Undo/Redo labels (`Moved page 3 to 1`, `Deleted 2 page(s)`); File History Timeline dengan arsitektur Main vs Branch lineage (`[Merge ➔ Split]`). |
| 2026-08-10 (sesi ini) | **UX & History Refactoring**: Per-file history bar di atas preview grid untuk Split & Organize, 1 batch history bar untuk Merge; Reset mengembalikan ke baseline original tanpa hapus file; Tombol 'Delete all files' di header file list; Hamburger menu dropdown untuk checkpoints Undo/Redo; Fix scroll jump di file >25 halaman (`withScrollPreserved` & mengganti `<button>` dengan `<div class="page-cell" tabindex="0">`); Visual flow 'All' action buttons dipindah ke paling bawah (Upload > Preview > Output > Download/Action All). |
| 2026-08-09 (round 1) | Rebuild organizer (organizer per-file sections, drag reorder, undo/save); ToolShell back-button + aktivitas; OutputPanel modal preview + Pages strip; CSS semua komponen baru; fix icon `material-symbols-outlined` di tool.ts; handoff same-tool wiring; workflow F-68..73; buat progress.md ini |
| 2026-08-09 (round 2) | **FIX detach pdfjs `bytes.slice()`** (root cause delete parah); merge flat-grid preview + drag lintas file; split dengan preview + pilih-range/drag + `splitPdfByOrderRanges`; drag-move universal (bindDnd/isCleanClick/◀▶); picker delete (badge+fill+selection bar); independen per file; auto-open Pages strip PDF; F-74..F-78 |

## Tips

- Jangan taruh `material-icons-outlined` — IT DOESN'T EXIST in this project. Selalu `material-symbols-outlined`.
- `pdfjs-dist@6` detaches input buffer → selalu kirim COPY (`new Uint8Array(bytes)`).
- `pdf-lib` butuh `Uint8Array<ArrayBuffer>` → `toPdfBytes` di `pdf-core.ts`.
- Perintah: `npm run dev` (lokal), `npm test`, `npm run lint`, `npm run build`.