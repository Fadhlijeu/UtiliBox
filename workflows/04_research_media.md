# 04 — Research: Images & Media
## UtiliBox · Hasil Scraping website media & downloader

> Sumber diverifikasi: tikdownloader.io, snaptik.app, ssstik.io, reelsvideo.io, getmyfb.com, ssstwitter.com, y2down.cc, remove.bg, convertio.co, cloudconvert.com, squoosh.app, ezgif.com, photopea.com, online-audio-converter.com, simpleimageresizer.com, iloveimg.com, tinypng.com, heictojpg.com.
> Catatan verifikasi: y2mate.com / snapinsta.app / savefrom.net / savetweetvid.com TIDAK ter-fetch (transport error / disentegrasi). jpeg mini/compressor.io 403 (unverified). Fitur di bawah yang ✅ sudah diverifikasi fetch; yang ⚠️ belum terverifikasi.

---

## 1. Media Downloader (TikTok / IG / YT / X)

### 1.1 TikDownloader.io (dasar dari script user `D:\DOWNLOAD\Tiktok.py`)
- **Model kerja**: UI input URL TikTok -> JS POST ke `https://tikdownloader.io/api/ajaxSearch` (form-urlencoded, header Origin/Referer + X-Requested-With, token statis dalam PAYLOAD) -> server balas HTML yang berisi link download (biasanya MP4 tanpa watermark + MP3 + slideshow/mix).
- **Fitur UI**: tanpa watermark, klaim "HD 1080p/4K/8K" (marketing: kualitas = sumber), 2 tombol (Download MP4 / Download MP3), foto/slideshow menjadi MP4 merged atau per-slide JPEG / MP3, report page states, free tanpa login.
- **⚠ Kritikal dari riset**: endpoint ini **diblok Cloudflare** untuk request programatik murni tanpa cookie/clearance — script curl/python gagal (433 challenge). Script user bekerja jika: (a) token di-copy dari halaman aktif, (b) request memakai User-Agent & cookie browser yang sudah lolos challenge. **Kesimpulan**: dari browser (client-side) call langsung akan kena CORS + Cloudflare challenge — downloader TikTok HD UtiliBox harus plugin via **proxy service** (misal space) atau pakai **gratis CORS proxy**, atau **jalankan Tiktok.py-style request via Piston/bin-server** (perlu riset lanjut — masuk `12_open_questions.md`).
- **Gagasan solusi yang feasible**: (1) cari service alternatif dengan API ter-dokumentasi & CORS terbuka (mis. `cobalt.tools` API atau `tikwm.com` API — keduanya CORS/RATE, harus diuji dari browser); (2) pakai HF Space yang membungkus downloader (beberapa ada); (3) buat "Download via" list dengan fallback jamak.

### 1.2 Union Fitur TikTok downloader (dari TD, Snaptik, SSSTik, MusicallyDown, Savetik)
- Tanpa watermark (semua), kualitas full HD jika tersedia (SSSTik, MD, ST), MP3/M4A audio-only (TD, SSSTik; ST: audio via tombol "Download Audio" M4A; beberapa bilang "HD MP3 128kbps/VBR — rate 待 bitrate selection **tidak ada yang eksplisit** ⚠️).
- **Slideshow/foto**: merged MP4 (semua), per-slide JPEG (TD/ST), **Download All (ZIP)** (Snaptik), MP3 per slide.
- **Stories**: SSSTik `download-tiktok-stories` (via **profile link**, anon), Musikal origin story page, SnapTik "TikTok Story Downloader" page.
- **Profile scrape**: web tools TIDAK support batch/profile scrape; ada **Jettcodey/TikTok-Downloader** (desktop C# scraper by username dengan captcha) ⚠️, dan **yt-dlp** (CLI, non-URL) untuk profile/favorites/likes.
- Username input **hanya** di story tool (anonim viewer SSSTik), post link/handle.
- Lainnya: iOS 13+ workaround, Android app, **tidak ada login (SSSTik/ST/TD)**, privasi (tidak simpan file), tanpa limit (SS/ST/TD), rate limit WAIT dialog (getmyfb, savetik), **extension Chrome**: Savetik.
- Yang TIDAK ada di semua: batch, riwayat download (hanya ST ternyata "no history"), queue, keyword search, preview player.

### 1.3 YouTube (via y2down.cc — y2mate tidak terhubung)
- Format MP4 144-1440p + WEBM 4K; audio MP3/M4A/WEBM/AAC/FLAC/OPUS/OGG/WAV.
- Playlist page, quality-split pages (4K, 1080p, MP3, WAV), TikTok & IG modules dalam satu situs, API publik (video-download-api.com) ⚠️ verifikasi, Firefox extension.

### 1.4 Instagram (ReelsVideo.io divert; snapinsta gagal)
- Post/video/carousel URL, story viewer **by username**, output MP4 (Reels/IGTV/carousel), JPG per carousel, **story photo+video original quality**, **MP3 extraction**, up to 720p / 1080x1350 px, public-only, no batch, no login, HD "300".
- **username browsing hanya story viewer; profile feed scrape tidak ada di web tools** (cukup coba yt-dlp / Instagram private API ⚠️ — open question).

### 1.5 X / Twitter (ssstwitter; savetweetvid sudah jadi blog spam)
- MP4 HD source quality, GIF support claim, live/broadcast, MP3 page, public-only, no batch, **rate limit manual (delay antara download)**, Android app UVD.

### 1.6 Facebook (getmyfb)
- MP4 HD (720/1080p, "2K or source"), Reels, **Live (after broadcast)**, private/group via iframe login process (⚠️), MP3 page, photo page, rate limit ~10s.

### 2. Image Tools

### Resmo-bg (remove.bg)
- AI bg removal 1-click, Magic Brush (fine, manual), preview + feedback per image, **HD credit paid**, **API**, PS extension, desktop apps (Win/Mac/Linux), Android, **free credits ~50/bulan** (⚠️ angka tidak terbaca dari halaman JS), plugin.

### 2.2 Image Convert (Convertio/CloudConvert/Squoosh/HEIC)
- Formats: JPG, PNG, WebP, GIF, BMP, TIFF, ICO, HEIC, SVG, AVIF, JXL, RAW (CR2/NEF/ARW), FLIF/BPG legacy (ezgif), PSD (Photopea: DDS/PSD/CDR/PDF/AI/EPS/Figma/MP4).
- **Camera RAW dev** (exposure/WB/contrast pada DNG/CR2/CR3) — Photopea, CloudConvert.
- Animasi: GIF-MP4/WebM/MOV, WebP/APNG/AVIF/JXL-GIF, transparent video-GIF, GIF maker, GIF analyzer, **video screenshot to JPG/PNG**, e-book/font.
- DataURI, QR/barcode generate, HTML-IMAGE.
- Custom settings: codec, bitrate, aspect, a picture, dll.
- Limits: Convertio free **100MB** (claim 1GB*), CloudConvert free 1GB paid (⚠️), ezgif 200MB, TinyPNG 5MB/img.

## 2.2.3 Upload inputs: URL download, Google Drive/Dropbox, local, batch, chained (CloudConvert jobs), clip (TinyPNG).

### Compress/optimize
- + moderate, 80% literal (TinyPNG), mozjpeg/webp/avif/oxipng-crush (Squoosh, WASM local), quality slider + ratio preview, metadata strip (TinyPNG), resize while compress (API), HEIC-JPG + compress (JPEGmini), batch 3-200 files free, no-upload (Squoosh = privacy).

### Edit dasar
- Resize % atau px, aspect lock, fit presets (Auto-crop, Fit, Fill, Blur), social presets, resize to file size in KB/MB, print dpi set, crop freehand/px/aspect, rotate 0/90/180/manual, flip, watermark text/image dengan pos/opacity/rotation, text-overlay/meme, blur face (ILoveIMG), pixelate, sketch filter (Photopea ⚠️), AI upscale (Upscayl butuh GPU desktop / ILoveIMG upscale — AI & pay), generative fill/inpaint (Photopea).

### Video tools
- VTK.
- Video-GIF (ezgif): pilih start/end time, loop count, fps, durasi mak, resize, crop, transparent video; GIF-MP4/WebM/MOV, reverse, speed change, split frames, optimize, watermark, subtitle overlay, white-box caption, loop.
- Video editor mudah: cut (invert select), crop, rotate, speed, reverse, filters (brightness/contrast/sepia/blur), saturasi, remove audio, volume, stabilizer claim (sibling OAC), screen/voice recorder, subtitle.
- Format video: mp4, avi, mkv, webm, mov, mpeg, m4v, wmv, asf, 3gp; audio: mp3, wav, m4a, aac, flac, ogg, opus, amr, m4r, wma, aiff, mp2 (converter).
- **Limits: 2000MB (ezgif video), 500MB** (thing).

### Audio
- Converter: MP3/WAV/M4A/AAC/FLAC/OGG/OPUS/AMR/M4R/MMF/WMA/AIFF/MP2 (OAC +), **extract audio dari video**, CBR/VBR/VBR, sample rate, channels.
- Editor audio: trim, fade in/out, reverse, volume, speed + pitch, equalizer, MP3 tags (title/artist/album). waveform gen., noise/voice remove claim (OAC suite ⚠️).
- Batch + zip download, Google Drive/Dropbox export, 30+ languages.

### Metadata
- EXIF viewer (ezgif, SRI), EXIF remover (ezgif 2026, SRI; TinyPNG autoremove, claim "no metadata"). 

---

## 3. Ringkasan untuk UtiliBox (fitur yang akan diadopsi)

1. **Downloader**: input URL + juga **username** (story/highlight/anon view), kualitas tier buttons, MP3 mode, slideshow ZIP, batch (lim it), history lokal browser, queue.
   - TikTok: HD tanpa watermark via lever apar (lihat open questions strategi: tikdownloader token / cobalt / yt-dlp-based service).
   - IG/YT/X: sama, fallback service.
2. **Remove bg**: tier local (u2net) + tier premium API opsional; Magic Brush manual; replace bg (warna/gradient/transparan).
3. **Image**: convert antar semua format umum + HEIC+RAW limited, compress dengan slider & preview ratio, resize+crop presets, strip metadata otomatis saat compress (opsi), watermark.
4. **Video/GIF/audio**: rentang waktu clip, fps, loop, speed, reverse, extract frame, transcode video (mp4/webm/mov/gif), audio converter + trim/fade/tags; semua via ffmpeg.wasm (selama budget memory memadbdung - limit durasi/fps; document).
5. **UX unik dari referensi yang mengadopsi**: dropzone besar + paste URL, hasil langsung preview (Squoosh style before/after), ZIP export multi-file, progress bars.