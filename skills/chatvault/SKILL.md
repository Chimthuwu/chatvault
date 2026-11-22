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

Converts AI conversations into portable files — Markdown, text PDF, print-ready HTML, JSON and a ZIP bundle. Works with ChatGPT `conversations.json`, Claude/Gemini/Grok/DeepSeek JSON exports, generic `{role, content}` arrays, public share URLs and plain transcripts. No API key and no network required for local conversion.

## When to Use

- User wants to export, archive, back up or convert a ChatGPT/Claude/Gemini/Grok/DeepSeek conversation.
- User has a `.json` chat export on disk and wants `.md`, `.pdf`, `.html` or `.zip`.
- User asks for the ChatVault userscript, web app or a Discord-friendly export link.
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
```

The tool prints each generated file and its size. It never uploads anything.

## Quick Reference

- `npm test` — rebuild userscript and run the 16-check test suite.
- `node scripts/cli.mjs --input <file> --out <dir>` — convert a local JSON export.
- `npm run build:userscript` — regenerate `userscripts/chatvault.user.js`.
- `npm run deploy` — publish the web app with Wrangler (requires Cloudflare auth).
- Web app: https://chatvault.nyan-anonymous-d45.workers.dev

## Procedure

1. Locate the source JSON. If the user pasted JSON inline, write it to a scratch file first with `write_file`.
2. Run the CLI via `terminal` with `--input` and `--out`. Use a scratch directory, not the repo root, unless the user asks to keep artifacts.
3. Verify output exists: list the output directory and confirm `.md`, `.pdf`, `.html`, `.json`, `.zip` are present and non-empty.
4. Report the exact output paths. If the user wants the conversation as text in chat, `read_file` the `.md` instead of pasting raw JSON.
5. For a browser-first request, point at the web app for share URLs/JSON pasting, and at `userscripts/chatvault.user.js` for the on-page toolbar.

## Pitfalls

- ChatGPT `conversations.json` is an array of conversations; the CLI picks the first one containing a `mapping`. Use a platform export trimmed to one chat when possible.
- The text PDF uses Helvetica/WinAnsi: non-Latin characters are transliterated and images are omitted. Offer the print-perfect HTML path for full fidelity.
- Public share URLs can be blocked by the platform when fetched server-side. In that case paste JSON or use the userscript; do not treat it as a ChatVault bug.
- `userscripts/chatvault.user.js` is generated. Never edit it directly; change the files in `site/` or `userscripts/chatvault-main.js` and rebuild.
- The userscript's ChatGPT backend call uses undocumented `/backend-api/*` routes and may change without notice.

## Verification

- CLI run prints 5 files with non-zero byte counts; the ZIP opens and contains all four exports.
- `npm test` ends with `pass 16`, `fail 0`.
- Web app `/api/health` returns `{"success":true,"service":"ChatVault","version":"3.0.0"}`.
