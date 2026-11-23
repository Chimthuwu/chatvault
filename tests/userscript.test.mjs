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
  assert.match(source, /@version\s+3.2.0/);
  for (const host of ['chatgpt.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'chat.deepseek.com', 'perplexity.ai', 'copilot.microsoft.com']) {
    assert.ok(source.includes(host), `missing @match host: ${host}`);
  }
  assert.doesNotMatch(source, /^export\s+/m);
  assert.doesNotMatch(source, /^import\s/m);
  assert.match(source, /function makeZip/);
  assert.match(source, /function collectCurrentConversation/);
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
  assert.doesNotMatch(bridge, /event\.source !== window/);
  assert.match(bridge, /isChatVaultOrigin/);
});
