# ChatVault — todo

Status: **v3.0.0 shipped** — web app live, userscript built, Hermes skill available, public repo.
Tests: 16/16 passing (`npm test`). Live: https://chatvault.nyan-anonymous-d45.workers.dev

## Done

- [x] Structured ChatGPT backend extraction (the path that produced the first successful 12-message export)
- [x] DOM fallback with platform adapters: Claude, Gemini, Grok, DeepSeek, Perplexity, Copilot + generic
- [x] Markdown export with code fences, timestamps, roles, warnings
- [x] Dependency-free text PDF writer (real selectable text, no external libs)
- [x] Print-perfect PDF via styled HTML + browser print dialog
- [x] HTML archive + JSON export
- [x] ZIP bundle containing MD + PDF + HTML + JSON
- [x] Wrangler Worker: static site, `/api/resolve`, export endpoints, URL allowlist, rate limit
- [x] Open Graph / Twitter metadata + 1200x630 thumbnail for Discord embeds
- [x] Self-contained Tampermonkey userscript generated from one source of truth
- [x] Hermes skill + zero-dependency CLI
- [x] 16 automated tests, public GitHub repo

## Next (real, doable)

- [ ] Verify DOM adapters against live logged-in pages for Claude, Gemini, Grok and DeepSeek; update selectors where they drifted. Needs a real browser session per platform.
- [ ] Test public `/share/` pages end to end (the original successful export was a logged-in `/c/` conversation).
- [ ] Add Playwright smoke tests for the web UI (tabs, preview, six download buttons) and the userscript toolbar.
- [ ] Add a `bookmarklet` variant for people who cannot install Tampermonkey (copy current DOM into the web app via `postMessage`).
- [ ] Support attachment downloads: collect image/file URLs and add them into the ZIP under `assets/`.
- [ ] Make PDF export Unicode-complete by embedding a small TTF subset (current writer transliterates non-WinAnsi characters).
- [ ] Add a batch mode: multiple share URLs → one ZIP with a folder per conversation.
- [ ] Add conversation search/filter in the web preview (role chips, keyword highlight, message range selection).

## Considered, not built (yet)

- **Server-side login automation** — dropped: violates platform terms and would require storing credentials. Paste-JSON and userscript paths cover the same need safely.
- **External PDF service** — dropped: sends private conversations to a third party and the local writer + print path already work.
- **Cloudflare KV cache of resolved shares** — deferred: public shares can be edited/deleted; caching would serve stale conversations. Revisit only with a short TTL and explicit user opt-in.
- **Browser MV3 extension** — deferred: Tampermonkey covers the same use case with less review friction.
- **OCR for screenshots inside chats** — deferred: needs a model download or paid API, both contrary to the free/offline goal.

## Ideas (unbacked)

- Local encrypted vault (`WebCrypto` + passphrase) with an index of exported chats.
- Auto-detect and strip duplicated nested message nodes from heavily themed UIs.
- "Export selection" — highlight a message range on the page and export only that.
- Themeable print CSS presets (academic, minimal, dark).
- CLI `--stdin` streaming mode for piping exports through shell tools.
