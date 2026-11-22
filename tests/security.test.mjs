import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShareUrl, safeRedirect, UrlError } from '../src/worker/security.js';

test('validateShareUrl accepts known public share links', () => {
  const cases = [
    'https://chatgpt.com/share/6b02d471-30f0-83ec',
    'https://chatgpt.com/share/abc123?ref=x',
    'https://claude.ai/share/abcDEF123',
    'https://gemini.google.com/share/abc123'
  ];
  for (const url of cases) assert.ok(validateShareUrl(url).platform, url);
});

test('validateShareUrl rejects private, unsupported and unsafe links', () => {
  for (const url of [
    'https://chatgpt.com/c/6b02d471-30f0-83ec',
    'https://example.com/share/abc123',
    'http://chatgpt.com/share/abc123',
    'https://evil.com@chatgpt.com/share/abc123',
    'https://chatgpt.com/share/..%2fc',
    'not a url'
  ]) assert.throws(() => validateShareUrl(url), UrlError, url);
});

test('safeRedirect keeps redirects on the same share host', () => {
  const original = new URL('https://chatgpt.com/share/abc123');
  assert.equal(safeRedirect('/share/abc123?x=1', original).hostname, 'chatgpt.com');
  assert.throws(() => safeRedirect('https://evil.com/share/abc123', original), UrlError);
});
