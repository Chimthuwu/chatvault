---
name: chatvault
description: Export LLM chats to Markdown, PDF, HTML and ZIP archives.
version: 3.0.0
author: Chimthuwu, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [export, markdown, pdf, chatgpt, claude, gemini]
    related_skills: []
---

# ChatVault Skill

Converts AI conversations into portable files — Markdown, text PDF, print-ready HTML, JSON and a ZIP bundle. Also **beautifies** raw exports without rewriting their content: protected code, four document styles, a live before/after preview and an extractive Intelligence Report. Works with ChatGPT `conversations.json`, Claude/Gemini/Grok/DeepSeek JSON exports, generic `{role, content}` arrays, public share URLs and plain transcripts. No API key and no network required for local conversion.

## When to Use

- User wants to export, archive, back up or convert a ChatGPT/Claude/Gemini/Grok/DeepSeek conversation.
- User has a `.json` chat export on disk and wants `.md`, `.pdf`, `.html` or `.zip`.
- User asks for the ChatVault userscript, web app or a Discord-friendly export link.
- User wants a raw Markdown/text/JSON export cleaned up, organized into sections, given a TOC/metadata header, or turned into an “Intelligence Report” without rewriting the transcript.
- Don't use for live scraping of private logged-in pages from a server — use the userscript on the open page instead.

## Prerequisites

- Node.js 18+ (for the CLI). No `npm install` needed: the converters are dependency-free.
- The repo at `https://github.com/Chimthuwu/chatvault` (local checkout preferred).
- Optional: Python 3 with Pillow only when regenerating `site/og-image.png`.

## How to Run

From the repo root, with `terminal`:

```bash
node scripts/cli.mjs --input examples/sample-conversation.json --out ./my-chat
node scripts/cli.mjs --input /path/to/conversations.json --out /path/to/out --title "My chat"
node scripts/cli.mjs beautify --input /path/to/raw-export.md --out /path/to/beautified --style report
# styles: clean | report | kb | raw — all four are also emitted by the userscript's BEAUTIFY button
```

The tool prints each generated file and its size. It never uploads anything.

## Quick Reference

- `npm test` — rebuild userscript and run the 25-check test suite (includes beautifier regressions).
- `node scripts/cli.mjs beautify --input <file> --out <dir> [--style report]` — clean a raw export without rewriting it.
- `node scripts/cli.mjs --input <file> --out <dir>` — convert a local JSON export.
- `POST https://chatvault.nyan-anonymous-d45.workers.dev/api/beautify` with `{markdown, style, report:true, prompt:true}` — same pipeline via API.
- `npm run build:userscript` — regenerate `userscripts/chatvault.user.js`.
- `npm run deploy` — publish the web app with Wrangler (requires Cloudflare auth).
- Web app: https://chatvault.nyan-anonymous-d45.workers.dev

## Procedure

1. Locate the source JSON. If the user pasted JSON inline, write it to a scratch file first with `write_file`.
2. Run the CLI via `terminal` with `--input` and `--out`. Use a scratch directory, not the repo root, unless the user asks to keep artifacts.
3. Verify output exists: list the output directory and confirm `.md`, `.pdf`, `.html`, `.json`, `.zip` are present and non-empty.
4. Report the exact output paths. If the user wants the conversation as text in chat, `read_file` the `.md` instead of pasting raw JSON.
5. For a browser-first request, point at the web app for share URLs/JSON pasting, and at `userscripts/chatvault.user.js` for the on-page toolbar.
6. For “beautify this export”, run the `beautify` subcommand. Tell the user the ZIP contains `original.md` (faithful), the chosen style, `intelligence-report.md` and `editorial-prompt.md`. Never present the Intelligence Report as if it were the transcript.

## Pitfalls

- ChatGPT `conversations.json` is an array of conversations; the CLI picks the first one containing a `mapping`. Use a platform export trimmed to one chat when possible.
- The text PDF uses Helvetica/WinAnsi: non-Latin characters are transliterated and images are omitted. Offer the print-perfect HTML path for full fidelity.
- Public share URLs can be blocked by the platform when fetched server-side. In that case paste JSON or use the userscript; do not treat it as a ChatVault bug.
- `userscripts/chatvault.user.js` is generated. Never edit it directly; change the files in `site/` or `userscripts/chatvault-main.js` and rebuild.
- The userscript's ChatGPT backend call uses undocumented `/backend-api/*` routes and may change without notice.
- The beautifier masks code fences and inline code; headings inside those blocks never reach the TOC. `raw` style is the only no-op — use it when the user needs byte-identical output.
- The Intelligence Report is extractive keyword/structure matching, not an AI summary. It never calls a model and can produce false positives; always point back to `original.md` for accuracy.
- AI editorial enhancement is opt-in: the generated `editorial-prompt.md` is for the user to paste into a model of their choice. Do not spend tokens or call a paid API on the user's behalf without asking.

## Verification

- CLI run prints 5 files with non-zero byte counts; the ZIP opens and contains all four exports.
- `npm test` ends with `pass 25`, `fail 0`.
- Web app `/api/health` returns `{"success":true,"service":"ChatVault","version":"3.0.0"}`.
- `beautify` CLI run prints 6 files with non-zero byte counts; `original.md` is byte-identical to the input document.
