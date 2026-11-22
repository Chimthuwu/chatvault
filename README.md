<div align="center">

```
 ██████╗██╗  ██╗██╗   ██╗██████╗ ███████╗██╗   ██╗███████╗██████╗ 
██╔════╝██║  ██║██║   ██║██╔══██╗██╔════╝██║   ██║██╔════╝██╔══██╗
██║     ███████║██║   ██║██████╔╝█████╗  ██║   ██║█████╗  ██████╔╝
██║     ██╔══██║██║   ██║██╔══██╗██╔══╝  ██║   ██║██╔══╝  ██╔══██╗
╚██████╗██║  ██║╚██████╔╝██║  ██║███████╗╚██████╔╝███████╗██║  ██║
 ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝
```

# ChatVault

**Your AI chats. Yours to keep.**

One-click export for ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity and Copilot — to Markdown, PDF, HTML and ZIP. No account, no API key, no external conversion service.

[![Live demo](https://img.shields.io/badge/🌐-Live%20demo-00dca5?style=for-the-badge)](https://chatvault.nyan-anonymous-d45.workers.dev)
[![Tests](https://img.shields.io/badge/tests-25%20passing-brightgreen?style=for-the-badge)](tests/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-3.0.0-9f6?style=for-the-badge)](package.json)

![ChatVault social preview](site/og-image.png)

</div>

---

## Why

Chat conversations vanish behind logins, UI redesigns and broken "copy" buttons. ChatVault turns them into files you own:

- **Markdown** — headings, code fences, tables, links, timestamps, roles.
- **PDF** — a real, text-selectable document generated locally (no jsPDF, no server).
- **Print-perfect PDF** — opens a styled HTML view and the browser's print dialog.
- **HTML archive** — a self-contained, readable copy.
- **ZIP** — all four above in one tidy bundle.
- **JSON** — the normalized conversation for your own tooling.

## Three ways in

### 1. Web app (no install)

👉 **https://chatvault.nyan-anonymous-d45.workers.dev** (canonical) · mirror: **https://chat-vault.pages.dev**

Both serve the same app. The Pages mirror keeps its static files on Pages and forwards `/api/*` to the Worker via [`functions/api/[[path]].js`](functions/api/[[path]].js), so exports and beautification work identically on either URL.

Paste a public share URL, a platform JSON export, or a plain transcript (`You: …` / `Assistant: …`). Pick a download. JSON and text modes never leave your browser; only public share URLs go through the Worker.

### 2. Tampermonkey userscript

Grab [`userscripts/chatvault.user.js`](userscripts/chatvault.user.js), create a new Tampermonkey script, paste the whole file, save, and refresh your chat tab. A small `BEAUTIFY / MD / PDF / PRINT / HTML / ZIP` toolbar appears in the corner. `BEAUTIFY` saves a ZIP with the original transcript, four presentation styles, the Intelligence Report, the editorial prompt and a PDF.

For ChatGPT it first reads the structured backend conversation (the path that successfully exported a full 12-message thread), then falls back to rendered DOM. Every other platform uses layered DOM selectors plus a generic alternating-role fallback.

> The userscript is generated — edit `site/core.js`, `site/archive.js`, `site/beautify.js`, `site/extract-browser.js` or `userscripts/chatvault-main.js`, then run `npm run build:userscript`. Never hand-edit the `.user.js` file.

### 3. Hermes skill + CLI

Install the bundled [`skills/chatvault/SKILL.md`](skills/chatvault/SKILL.md), then ask Hermes to export a chat. Under the hood it calls the zero-dependency CLI:

```bash
node scripts/cli.mjs --input examples/sample-conversation.json --out ./my-chat
# → my-chat/<title>.md, .pdf, .html, .json, .zip
```

The CLI also reads ChatGPT `conversations.json`, Claude `chat_messages`, and generic `[{ "role": "user", "content": "…" }]` arrays.

## Phase 2 — Beautify & Archive

The **Refining Exported Contents** feature set turns an export into a readable archive without rewriting it. Two layers, one rule: **presentation changes, content never does**.

- **Protected content manager** — fenced blocks and inline code are extracted into collision-safe placeholders before any normalization, then restored byte-for-byte. Headings *inside* code never appear in the table of contents.
- **Normalization pipeline** — setext/ATX heading levels, whitespace, decorative separators, list markers, table rows, bare URLs, ISO timestamps.
- **Four document styles** — `clean` (portable Markdown), `report` (metadata header + TOC), `kb` (at-a-glance summaries + references), `raw` (untouched original).
- **Live before/after preview** in the web app, with per-feature checkboxes and one-click archive download.
- **01 — Original Conversation** and **02 — Intelligence Report** in the same ZIP: the report is extractive (decisions, unfinished work, actions, files/repos, code references) and says so explicitly — no invented facts.
- **Editorial prompt** — a ready-to-paste prompt for an optional AI enhancement stage, kept separate from the faithful archive.

```bash
node scripts/cli.mjs beautify --input examples/sample-conversation.json --out ./beautified --style report
# → beautified/original.md, report.md, intelligence-report.md,
#   editorial-prompt.md, beautified.pdf, beautified.zip
```

The same pipeline runs in the userscript (`✨ BEAUTIFY` button), the web app, the Worker's `/api/beautify` endpoint and the CLI. All share [`site/beautify.js`](site/beautify.js), so output is identical everywhere.

AI enhancement is deliberately **opt-in**: ChatVault never sends a conversation to a model on its own. The browser does all formatting locally, and the editorial prompt is a file you choose to use.

## Platform support

| Platform | Structured extraction | DOM fallback | Public share URL via web app |
|---|---|---|---|
| ChatGPT (`/c/…`, `/share/…`) | ✅ backend conversation payload | ✅ | ✅ |
| Claude | — | ✅ | ✅ |
| Gemini / g.co | — | ✅ | ✅ |
| Grok / X | — | ✅ | share patterns are best-effort |
| DeepSeek | — | ✅ | ✅ (`/s/…`) |
| Perplexity | — | ✅ | ✅ (`/search/…`) |
| Copilot | — | ✅ | ✅ (`/chat/…`) |
| Anything else | — | generic heuristic | paste JSON / transcript |

## How it works

```mermaid
flowchart LR
  A[Chat page or JSON file] --> B{Which entry point?}
  B -->|Userscript| C[Structured API + DOM adapters]
  B -->|Web app| D[/api/resolve Worker/]
  B -->|CLI| E[parseImport]
  C --> F[Normalized conversation]
  D --> F
  E --> F
  F --> G[Markdown]
  F --> H[Text PDF]
  F --> I[HTML]
  F --> J[ZIP + JSON]
```

The shared model and exporters live in [`site/core.js`](site/core.js) and [`site/archive.js`](site/archive.js). The browser adapters live in [`site/extract-browser.js`](site/extract-browser.js); the Worker reads public share pages in [`src/worker/`](src/worker/). One codebase, identical output in all three products.

## Worker API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + version |
| `/api/config` | GET | Supported platforms and limits |
| `/api/resolve` | POST `{url}` | Fetch a public share and return a normalized conversation |
| `/api/export/markdown` | POST `{conversation}` | Markdown file |
| `/api/export/html` | POST `{conversation}` | HTML file |
| `/api/export/json` | POST `{conversation}` | JSON file |
| `/api/beautify` | POST `{markdown, style?, report?, prompt?}` | Beautified Markdown + optional extractive report/editorial prompt |

Only https public share URLs on the allowlisted hosts are fetched. Private `/c/` links, credentials in URLs, redirects off-host and oversized bodies are rejected.

## Development

```bash
npm test                 # builds the userscript + runs 25 node:test checks
npm run dev              # wrangler dev (local Worker + site)
npm run deploy           # wrangler deploy (Worker + canonical domain)
npm run deploy:pages     # pages mirror at chat-vault.pages.dev
npm run build:og         # regenerate the 1200x630 embed image (Pillow)
npm run cli -- --help    # local conversion CLI
```

## Honest limitations

- Server-side share retrieval is best-effort: platforms can block datacenter requests or render content purely client-side. When that happens, use paste-JSON mode or the userscript on the open chat.
- DOM selectors follow current layouts; they are the first thing to break when a platform ships a redesign. The generic fallback reduces total failures but cannot guarantee perfect role detection.
- The text PDF uses standard Helvetica with WinAnsi encoding: non-Latin characters are transliterated (`→` becomes `->`) and images are omitted. Use **Print-perfect** for full styling and Unicode.
- `/backend-api/*` on ChatGPT is an undocumented implementation detail, not a supported export API. It may change without notice.
- No conversation content is logged or stored by the Worker; rate limiting is in-memory and per-isolate.

## Layout

```
site/                 static web app + shared core/archive/beautify/extract modules
src/worker/           Cloudflare Worker API
functions/            Pages mirror API proxy
userscripts/          generated self-contained userscript
templates/            userscript metadata header
scripts/              build, CLI, OG-image generator
skills/chatvault/     Hermes skill
tests/                node:test suite
examples/             sample conversation JSON
```

## License

MIT — see [LICENSE](LICENSE). Built for chat hoarders (◕‿◕).
