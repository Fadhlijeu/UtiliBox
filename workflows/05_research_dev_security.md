# 05 — Research: Developer, Data & Security
## UtiliBox · Hasil Scraping website dev tools & security utilities

> Sumber terverifikasi: jsonlint.com, jsonformatter.org, base64encode.org, base64decode.org, dillinger.io, stackedit.io, docs.hoppscotch.io, onecompiler.com, playcode.io, online-ide.com, codebeautify.org, speedtest.net, qrcode-monkey.com, qr-code-generator.com, qrcode-decoder.com, bitwarden.com/password-generator, lastpass.com/password-generator, bitwarden.com/password-strength, haveibeenpwned.com/Passwords, hash.online-convert.com, md5hashgenerator.com, jwt.io.
> ⚠️: base64.guru, codepen.io, json2yaml.com tidak ter-fetch (403/JS-only).

---

## 1. Developer & Data Tools

### 1.1 JSON
- Validator dengan **line-number error** (detail pesan: "Expecting STRING / NUMBER / NULL").
- Formatter: **indent 2/3/4 space**, auto-switch live; minify/compact; **Fix/Repair button** (screwdriver) untuk kutip-atau koma hilang.
- **Tree view, Graph view** (visual object graph), **image-on-hover** untuk URL gambar.
- Input: type/paste, **upload file**, **?url= param** (scrape JSON dari URL), ?json=.
- **Converters**: JSON<->XML, JSON->CSV/TSV/Excel, JSON->SQL, JSON->YAML, JSON->Java/Python/TS/Go/Rust/Kotlin/etc ("data to class"), **JSON Schema generator + validator**, JSONPath query, JSON5, JSONL, stringify.
- **JSON Diff** (side-by-side + file diff), JSON Sorter, JSON Cleaner.
- **Save & share**: judul, tag, deskripsi, **expiry 1h/8h/24h/7d/15d/30d/never**, public/private (login), My Links, Recent Links.
- Extras: JSON escape, URL encode, JSON to Base64, JWT decoder, chrome extension, macOS app (JSONLint Pro).

### 1.2 YAML & XML
- YAML: validator, parser, formatter/beautifier, pretty-print, viewer, YAML<->JSON/XML/CSV/Excel, YAML editor.
- XML: formatter/beautifier, minify, validator, viewer (tree), parser, editor, XML<->JSON/YAML/CSV/TSV/HTML/Excel/Java, **XML Diff**, **XML-XSL Transform**, sort XML, XML Escape, WSDL & SOAP formatter, XML->Base64.
- JSON5 support (jsonformatter.org).

### 1.3 Base64
- Encode/decode: **text dengan pilihan charset (UTF-8, ASCII, ISO-8859-x, Windows-1252, Big5, GB18030, Shift-JIS, dll — puluhan)**, **AUTO-DETECT di decode**.
- Opsi: **per-line encode**, **MIME line 76-char (RFC 2045)**, **URL-safe Base64URL (RFC 4648)**.
- File <-> base64 (upload hingga **100MB**, download, auto-delete setelah 15 menit/1x download), **image<->base64** (PNG/JPG/SVG), **JSON/XML/YAML/CSV/TSV/Binary/Hex/Octal, Base32, Base58**.
- **Live mode client-side** (tidak kirim data ke korang), clipboard copy, safety warning binary decode.

### 1.4 Markdown <-> HTML
- Editor Dillinger/StackEdit: Monaco, live preview split, **synced scroll**, Vim/Emacs keys, dark mode, zen mode, offline (localStorage).
- Export: **.md, styled HTML, PDF**; publish: Blogger, WordPress, Zendesk; sync: GitHub/Dropbox/GDrive/OneDrive/Bitbucket.
- Flavors: **CommonMark, GFM, Markdown Extra**; **KaTeX math, Mermaid diagram, ABC music, emoji** (StackEdit).
- HTML->Markdown: turndown-style (markdownify) — codebeautify & many tools.

### 1.5 API Tester (mini Postman) — base Hoppscotch
- Methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), **query params tabed tables**, headers, **body: JSON/raw/multipart form-data/urlencoded/binary upload**.
- Auth: **Basic, Bearer, OAuth2, API key, "none"** (per request dan collection).
- Response viewer: **status, pretty-print JSON/HTML/XML, headers, cookies, **time & size metrics**.
- **Collections**, folders, meta; **history** (re-send, favorite, filter); **environments** (global/personal/shared); **variables {{var}}**; **pre-request JS & post-response tests**; **Runner** (sequence with delay/iterations).
- Realtime: **WebSocket, SSE, Socket.IO, MQTT** opsional; **GraphQL** builder + schema explorer.
- Import/export: **Postman, Insomnia, OpenAPI, HAR, curl, JSON**; **generate code snippets** (JS, Python, Shell); **documentation generation** + public share links; widgets/embed; mock server (stub, custom status/latency); **command palette, hotkeys**; i18n; PWA desktop/CLI.
- CORS problem → **Proxyscotch/interceptor browser-extension** atau "use proxy" — dari GitHub Pages perlu interceptor extension atau CORS proxy built-in (settable).

### 1.6 Code Runner / Canvas IDE
- OneCompiler: **110+ languages** (HTML, Python, JS, Java, MySQL, C/C++, PHP, C#, Assembly, Go, Rust, Kotlin, Ruby, Lua, R, Bash, SQL-MySQL/Postgres/MongoDB...), stdin **I/O tab**, **embed via iframe/SDK**, **API execute code** (paid/free tier), Android app.
- Online-IDE: 9 bahasa, **share URL dengan expiry**, save file/project ZIP, download result, 35+ editor themes, **Vim/Emacs/Sublime/VS Code bindings**, **multi-file tabs**, layout vertical/horizontal output, F8/Ctrl+Enter run.
- Playcode: **HTML/CSS/JS + TS + React/Vue/Svelte live preview**, npm packages, Python (matplotlib/pandas in-browser WASM), C/C++17/20 & Go WASM offline, SQL Postgres in browser, Regex tester, JSON formatter.
- CoBra/piston: service open source default run (tanyakan boundary rate-limit) — v1 pakai **Piston API** (public, CORS ok, 10+ languages, no auth) atau **Wandbox API** (curses) — pilihan di open questions.

### SpeedTest (Ookla)
- Metrics: **ping, download, upload, jitter, packet loss**; **single vs multi connection**; **auto select server + manual pick**; provider detection; history (login); apps; IS documentation.
- UtiliBox: **basic version** = sequential download/upload test ke object yang CORS-open (mis. Cloudflare CDN asset), ping via fetch timing; no login, no history (P2: localStorage).

---

## 2. Security & Utility

### 2.1 QR
**Generator (QRCode Monkey + QRCG)**: tipe konten — **URL, Text, Email (subject+message), Phone, SMS, vCard 2.1/3.0 (profil lengkap tele kerja/privat), MeCard, Event/eCalendar, WiFi (SSID+password+encWEP/WPA/WPA2), Facebook, Twitter, YouTube, Location (lat/lng/drag map), Bitcoin/ETH/Litecoin/Dash (address+amount), App Store, PDF, MP3, Video, Gallery, Feedback/Rating, Homepage**.
- Custom: warna foreground tunggal/**gradient linier&radial**, warna eyes, background, **logo upload (PNG/JPG/GIF/SVG max 2-4MB) + logo gallery + auto-remove bg dari logo**, bentuk body/eye/ball **preset**, pixel res slider, **error correction sampai 30%** (logo menutup max 30% area).
- Download: **PNG, SVG, PDF, EPS** (logo/gradient hanya di PNG/SVG); bandito; **live preview**, kontras warning; **fast API** (qrcode-monkey pub API), 12程이 languages.
- Dynamic QR (PRO/internation, butuh shortlink+analytics) — v1 tidak perlu.
**Scanner/decoder**: upload file / live camera; **100% local browser (jsQR)**; output: **copy, open URL, download text, re-create QR**; auto-detect content type (URL vs wifi vs vCard text); batch scan ⚠️ tidak ada di references.

### 2.2 Password
- Generator (Bitwarden/LastPass): panjang **5-128**, toggle **uppercase/lowercase/numbers/symbols**, **exclude ambiguous chars, easy-to-say/read (pronounceable)**, **passphrase mode (kata random + separator)**, **username generator**, strength meter (lower weak..strong), **estimated time to crack (zxcvbn)**: Copy/regenerate, **local crypto-random (crypto.getRandomValues), no send**.
- Checker: **zxcvbn score + crack time**, HIBP pwned count via **k-anonymity range API (5-char SHA-1 prefix)** — klien lokal. Buku NIST 800-63.

### 2.3 Hash
- Algorithms (online-convert): **MD5, SHA-1, SHA-256/384/512, MD4, CRC-32/32B, Adler32, RIPEMD-128/160, Haval-128, Tiger-128/160/192, GOST, Whirlpool, Blowfish (salted), DES, htpasswd** — plus (web crypto) **SHA-3 (js-sha3)** + **HMAC key** + **file upload checksum** + UPPER/lowercase out.
- Dan's Tools: MD5 text max 256 chars, sibling tools list, unixtime, base64, URL, regex, data-size.

### 2.4 JWT (jwt.io)
- Tab Decode: **auto-decode header+payload + signature**, pretty-print JSON + **Claims Breakdown** (iat/exp/nbf dll), **live validation flag "Valid JWT/Signature Verified"**.
- Tab Encode: edit header/payload, **algorithm dropdown (HS256/384/512, RS256/384/512, ES256/384/512, PS256/384/512)**, **shared secret field HS* (Base64URL toggle)**, **public key PEM untuk RS/ES/PS verify**, private-key sign; auto-fill **iat/exp/nbf**, regenerate, copy, clear; **free, client-side**; libraries list.

---

## 3. Fitur yang Diadopsi UtiliBox (keputusan awal)

1. **JSON Tool Suite**: format/validate/minify + tree view + diff + converter lite (JSON-YAML-XML-CSV) + schema gen + save-share (expiry) — semua client.
2. **Base64**: tab text & file & image; **Base64URL toggle, MIME chunk, per-line**, charset select.
3. **Markdown Editor**: live preview sync, GFM, export HTML/PDF (jsPDF), converter 2 arah.
4. **API Tester**: subset Hoppscotch: methods, params, headers, body 5 types, auth 4, response pretty + timing, history/tab, collections/export/import, WebSocket (opsional v1.1), **CORS proxy toggle**.
5. **Code Runner**: Piston API (v1) dengan jestak grafis "Canvas": editor multi-tab, 30+ bahasa, stdin, output, **HTML preview pane**, modes theme, share, save, copy; batas Piston: 10.000 char request, 3s execute 5 lang/timeout, max 64MB) — dokumentasi di spec.
6. **Speedtest basic**: ping (fetch timing), 5MB down, 2MB up, jitter minimal (P2).
7. **QR**: full generator 14 tipe + custom (logo, gradient, EC, preview) + download 4 format + scanner kamera/upload local (jsQR) + auto-detect route.
8. **Password**: generator pas + passphrase + strength (zxcvbn) + HIBP check local.
9. **Hash**: 12+ algorithms text + file checksum (spark-md5/WebCrypto/js-sha3/crc-32) + HMAC + copy.
10. **JWT**: decode+encode+verify (jose) full seperti jwt.io.