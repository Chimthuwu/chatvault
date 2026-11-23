import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessages, toConversation, renderMarkdown, renderHtml, parseImport, platformForHost, extractContinuationReference
} from '../site/core.js';

const conv = toConversation({
  title: 'Test <chat>', source: 'https://chatgpt.com/share/abc',
  messages: [
    { role: 'user', content: 'Hello **world**', timestamp: '2026-01-01T00:00:00Z' },
    { role: 'assistant', content: [{ type: 'code', language: 'js', text: 'const x = 1;' }] }
  ],
  platform: 'chatgpt', method: 'test'
});

test('normalizeMessages maps roles and dedupes by id', () => {
  const result = normalizeMessages([
    { role: 'human', content: 'a', id: '1' },
    { role: 'human', content: 'a', id: '1' },
    { author: { role: 'assistant' }, content: [{ type: 'text', text: 'b' }], id: '2' },
    { role: 'system', content: '' }
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(m => m.role), ['user', 'assistant']);
  assert.equal(result[1].content[0].type, 'text');
});

test('renderMarkdown preserves metadata and fenced code', () => {
  const md = renderMarkdown(conv);
  assert.match(md, /^# Test <chat>/);
  assert.match(md, /## 1\. You/);
  assert.match(md, /```js\nconst x = 1;\n```/);
  assert.match(md, /Messages: 2/);
});

test('renderHtml escapes markup and can emit a print script', () => {
  const html = renderHtml(conv);
  assert.match(html, /Test &lt;chat&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(renderHtml(conv, { print: true }), /window\.print\(\)/);
});

test('parseImport accepts ChatGPT mapping export', () => {
  const payload = {
    title: 'Mapped chat',
    mapping: {
      a: { message: { id: 'a', author: { role: 'user' }, content: { parts: ['first'] }, create_time: 1 }, parent: null },
      b: { message: { id: 'b', author: { role: 'assistant' }, content: { parts: ['second'] }, create_time: 2 }, parent: 'a' }
    },
    current_node: 'b'
  };
  const result = parseImport(JSON.stringify(payload));
  assert.equal(result.title, 'Mapped chat');
  assert.deepEqual(result.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(result.messages[0].content[0].text, 'first');
});

test('parseImport accepts Claude/Gemini-style chat_messages and generic arrays', () => {
  const claude = parseImport(JSON.stringify({ chat_messages: [
    { role: 'human', content: [{ type: 'text', text: 'hey' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'yo' }] }
  ] }));
  assert.equal(claude.messages.length, 2);
  const generic = parseImport(JSON.stringify([{ role: 'user', content: 'hi' }, { role: 'model', content: 'hello' }]));
  assert.deepEqual(generic.messages.map(m => m.role), ['user', 'assistant']);
  assert.throws(() => parseImport('not json'), /not valid JSON/);
});

test('platformForHost recognizes supported hosts', () => {
  assert.equal(platformForHost('chatgpt.com').id, 'chatgpt');
  assert.equal(platformForHost('chat.deepseek.com').id, 'deepseek');
  assert.equal(platformForHost('example.com'), null);
});


test('extractContinuationReference detects ChatGPT continuation marker and parent conversation ID', () => {
  const result = extractContinuationReference([{
    role: 'assistant',
    content: 'Continued from [Assess Script Safety (1)](https://chatgpt.com/c/6b01f552-e394-83ec-8755-4d6d75d412de)'
  }]);
  assert.deepEqual(result, {
    parentId: '6b01f552-e394-83ec-8755-4d6d75d412de',
    parentTitle: 'Assess Script Safety (1)',
    parentUrl: 'https://chatgpt.com/c/6b01f552-e394-83ec-8755-4d6d75d412de'
  });
});

test('extractContinuationReference ignores unrelated links and unsafe hosts', () => {
  assert.equal(extractContinuationReference([{ role: 'assistant', content: 'Continued from [x](https://evil.example/c/abc123)' }]), null);
  assert.equal(extractContinuationReference([{ role: 'assistant', content: 'See https://chatgpt.com/c/abc123' }]), null);
});
