import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const file = fileURLToPath(new URL('../userscripts/chatvault.user.js', import.meta.url));
const appFile = fileURLToPath(new URL('../site/app.js', import.meta.url));
const bridgeFile = fileURLToPath(new URL('../userscripts/chatvault-main.js', import.meta.url));

test('generated userscript is self-contained and parses', () => {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /\/\/ ==UserScript==/);
  assert.match(source, /@version\s+3.5.0/);
  for (const host of ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'g.co', 'grok.com', 'chat.deepseek.com', 'perplexity.ai', 'copilot.microsoft.com']) {
    assert.ok(source.includes(host), `missing @match host: ${host}`);
  }
  assert.doesNotMatch(source, /^export\s+/m);
  assert.doesNotMatch(source, /^import\s/m);
  assert.match(source, /function makeZip/);
  assert.match(source, /function collectCurrentConversation/);
  assert.match(source, /chatvault:toolbar-collapsed/);
  assert.match(source, /cv3-toggle/);
  assert.match(source, /cv3-archive/);
  assert.match(source, /ARCHIVE \+ BEAUTIFY/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /GM_addValueChangeListener/);
  assert.match(source, /https:\/\/\*\.chat-vault\.pages\.dev\/\*/);
  assert.match(source, /isChatVaultOrigin/);
  assert.match(source, /chatvault:browser-extract-request/);
  assert.match(source, /chatvault:browser-extract-result/);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});


test('share URL imports use the automatic browser JSON handoff', () => {
  const app = readFileSync(appFile, 'utf8');
  const bridge = readFileSync(bridgeFile, 'utf8');
  assert.match(app, /if \(state\.mode === 'url'\)\s*\{\s*startBrowserExtraction\(\);/);
  assert.match(app, /chatvault:browser-extract-request/);
  assert.match(app, /chatvault:browser-extract-result/);
  assert.doesNotMatch(app, /event\.source !== window/);
  assert.doesNotMatch(app, /window\.open\(target\.href/);
  assert.match(app, /cv-return=/);
  assert.match(app, /browser-extract-started/);
  assert.match(bridge, /location\.replace\(returnTarget\.href\)/);
  assert.match(bridge, /isExtractionTarget/);
  assert.match(bridge, /platform\.id === 'chatgpt'/);
  assert.ok(bridge.includes(String.raw`/^\/c\/`));
  assert.match(app, /resolveContinuationAncestors/);
  assert.match(app, /autoBeautifyImportedConversation/);
  assert.match(app, /cv-share/);
  assert.match(app, /sessionStorage\.setItem\('chatvault:chain:'/);
  assert.match(app, /continuationTitlesMatch/);
  assert.match(app, /data-detach-continuation/);
  assert.match(bridge, /GM_getValue\(RESULT_KEY\)/);
  assert.doesNotMatch(bridge, /event\.source !== window/);
  assert.match(bridge, /isChatVaultOrigin/);
  assert.match(bridge, /cv3-collapsed/);
  assert.match(bridge, /createOrGetChatGPTShareUrl/);
  assert.match(bridge, /chat-vault\\.pages\\.dev/);
  assert.match(bridge, /Expand ChatVault tools/);
});
