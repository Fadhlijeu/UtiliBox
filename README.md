# UtiliBox

The personal utility toolkit — 30+ browser-based tools, deployed on [GitHub Pages](https://fadhlijeu.github.io/UtiliBox/).

> **Status: M0 done** — shell, router, design system, CI live. 2/31 tools shipped (base64, JSON). Roadmap: [workflows/11_milestones.md](workflows/11_milestones.md).

[![CI](https://github.com/Fadhlijeu/UtiliBox/actions/workflows/ci.yml/badge.svg)](https://github.com/Fadhlijeu/UtiliBox/actions/workflows/ci.yml)

## Tools

- **Documents & Files**: PDF convert, compress, editor (split/merge/reorder), OCR, encryption, metadata, diff
- **Images & Media**: remove background, image convert, resize/crop, video→GIF, audio convert, media downloader
- **Developer & Data**: JSON/YAML/XML, Base64, Markdown, API tester, code runner, speed test
- **Security & Utility**: QR, password, hash, JWT
- **AI Extras**: summarizer, paraphraser, humanizer, caption, chatbot, code assistant, prompt beautifier, sketch

## Docs

| File | Description |
|------|-------------|
| `workflows/00_overview.md` | Project overview |
| `workflows/01_requirements.md` | Functional & non-functional requirements |
| `workflows/02_architecture.md` | Technical architecture |
| `workflows/03_research_docs.md` | Competitive research: PDF/OCR |
| `workflows/04_research_media.md` | Competitive research: media/downloader |
| `workflows/05_research_dev_security.md` | Competitive research: dev/security |
| `workflows/06_research_ai.md` | Competitive research: AI tools |
| `workflows/07_feature_spec_docs_media.md` | Tool specs: docs & media |
| `workflows/08_feature_spec_dev_security_ai.md` | Tool specs: dev, security, AI |
| `workflows/09_ui_design_system.md` | Hallmark design system (anti AI-slop) |
| `workflows/10_ai_strategy.md` | AI strategy (OCR via HF Spaces, BYOK) |
| `workflows/11_milestones.md` | Roadmap M0–M6 |
| `workflows/12_open_questions.md` | Resolved decisions log |

## Tech

- Vite + vanilla TypeScript (strict mode)
- GitHub Actions → GitHub Pages (CI: lint, typecheck, vitest, build)
- Hash router (`#/tool/:id`) + lazy-loaded tool chunks
- Client-first processing (pdf-lib, PDF.js, ffmpeg.wasm, Tesseract.js, transformers.js)
- HuggingFace Spaces for heavy OCR (baidu/Unlimited-OCR)
- BYOK for AI features (Gemini / OpenAI-compatible)

## Dev

```bash
npm install
npm run dev        # local dev server
npm run test       # vitest
npm run lint       # eslint + tsc --noEmit
npm run build      # tsc + vite build → dist/
```
