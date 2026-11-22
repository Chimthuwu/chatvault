# ChatVault — todo

Status: **v3.0.0 + Phase 2 shipped** — web app live, userscript built, Hermes skill available, public repo.
Tests: 25/25 passing (`npm test`). Live: https://chatvault.nyan-anonymous-d45.workers.dev

## Done

- [x] Original v3 exporter stack (userscript, Worker, skill, CLI, public repo, OG embed)
- [x] Phase 2 protected-content manager: fenced + inline code masked with collision-safe placeholders, restored byte-for-byte
- [x] Normalizers: headings (setext + ATX), whitespace, separators, lists, tables, bare URLs, timestamps
- [x] Four document styles: `clean`, `report`, `kb`, `raw` — one shared `site/beautify.js` for every product
- [x] Live before/after preview + feature checkboxes in the web app
- [x] 01 Original Conversation + 02 extractive Intelligence Report + editorial prompt in one ZIP
- [x] `BEAUTIFY` button in the userscript; `beautify` CLI subcommand; `/api/beautify` Worker endpoint
- [x] Regression tests for code-fence protection, TOC isolation, metadata placement, report extraction
- [x] 25 automated tests, live UI verified in a real browser

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
- [x] 16 automated tests, public GitHub repo (superseded by 25 below)

## Next (real, doable)

- [ ] Verify DOM adapters against live logged-in pages for Claude, Gemini, Grok and DeepSeek; update selectors where they drifted. Needs a real browser session per platform.
- [ ] Test public `/share/` pages end to end (the original successful export was a logged-in `/c/` conversation).
- [ ] Add Playwright smoke tests for the web UI (tabs, preview, six download buttons) and the userscript toolbar.
- [ ] Add a `bookmarklet` variant for people who cannot install Tampermonkey (copy current DOM into the web app via `postMessage`).
- [ ] Support attachment downloads: collect image/file URLs and add them into the ZIP under `assets/`.
- [ ] Make PDF export Unicode-complete by embedding a small TTF subset (current writer transliterates non-WinAnsi characters).
- [ ] Add a batch mode: multiple share URLs → one ZIP with a folder per conversation.
- [ ] Add conversation search/filter in the web preview (role chips, keyword highlight, message range selection).
- [ ] HTML-input beautifier: `detectInputType` recognizes HTML, but the normalizer currently treats it as text. Add a conservative HTML→Markdown pass before normalization.
- [ ] Protect quoted text (`>` blocks) explicitly, alongside code fences and inline code.
- [ ] Language detection for unlabeled code fences (heuristic by keywords, no network).
- [ ] Nested-list indentation repair beyond the current marker normalization.
- [ ] Intelligence Report: dedicated “Implemented” and “Rejected approaches” sections (currently folded into Decisions).
- [ ] Intelligence Report: detect architecture/topic clusters across 200-message exports, not just per-line keywords.
- [ ] Before/after diff highlighting in the web preview (line-level additions/removals).
- [ ] Embed TOC anchors as clickable links in the generated PDF.
- [ ] User-configurable style profiles (save checkbox/style choices as a preset in the browser).
- [ ] Batch beautify: drop several exports into the web app and get one ZIP with a folder per document.

## Considered, not built (yet)

- **Server-side login automation** — dropped: violates platform terms and would require storing credentials. Paste-JSON and userscript paths cover the same need safely.
- **External PDF service** — dropped: sends private conversations to a third party and the local writer + print path already work.
- **Cloudflare KV cache of resolved shares** — deferred: public shares can be edited/deleted; caching would serve stale conversations. Revisit only with a short TTL and explicit user opt-in.
- **Browser MV3 extension** — deferred: Tampermonkey covers the same use case with less review friction.
- **Automatic AI editorial engine** — deferred: needs an API key and paid inference, which conflicts with the free/offline goal. ChatVault ships an opt-in editorial prompt and a local extractive report instead — no token spend by default.
- **OCR for screenshots inside chats** — deferred: needs a model download or paid API, both contrary to the free/offline goal.

## Ideas (unbacked)

- Local encrypted vault (`WebCrypto` + passphrase) with an index of exported chats.
- Auto-detect and strip duplicated nested message nodes from heavily themed UIs.
- "Export selection" — highlight a message range on the page and export only that.
- Themeable print CSS presets (academic, minimal, dark).
- CLI `--stdin` streaming mode for piping exports through shell tools.
