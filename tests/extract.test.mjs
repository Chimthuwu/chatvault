import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPayload, extractConversation, ExtractError } from '../src/worker/extract.js';

test('detectPayload finds React Flight and legacy markers', () => {
  assert.equal(detectPayload('<script>self.__next_f.push([1,"x"])</script>'), 'react-flight');
  assert.equal(detectPayload('<script id="__NEXT_DATA__">{}</script>'), 'legacy-next');
  assert.equal(detectPayload('<html>plain</html>'), 'unknown');
});

test('extractConversation reconstructs messages from an RSC-style payload', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'general kenobi' }] }
  ];
  const record = JSON.stringify([1, JSON.stringify(messages)]);
  const html = `<html><title>Star Wars chat</title><script>self.__next_f.push(${record});</script></html>`;
  const conv = extractConversation(html, 'https://chatgpt.com/share/abc123', 'chatgpt');
  assert.equal(conv.title, 'Star Wars chat');
  assert.deepEqual(conv.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(conv.messages[0].content[0].text, 'hello there');
  assert.match(conv.metadata.extractionMethod, /react-flight/);
});

test('extractConversation reconstructs a ChatGPT mapping payload', () => {
  const payload = {
    title: 'Mapped',
    mapping: {
      a: { message: { id: 'a', author: { role: 'user' }, content: { parts: ['one'] } }, parent: null },
      b: { message: { id: 'b', author: { role: 'assistant' }, content: { parts: ['two'] } }, parent: 'a' }
    },
    current_node: 'b'
  };
  const html = `<html><script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: payload } })}</script></html>`;
  const conv = extractConversation(html, 'https://chatgpt.com/share/xyz', 'chatgpt');
  assert.deepEqual(conv.messages.map(m => m.role), ['user', 'assistant']);
  assert.equal(conv.messages[1].content[0].text, 'two');
});

test('extractConversation fails loudly on an unknown payload', () => {
  assert.throws(() => extractConversation('<html>nothing here</html>', 'https://x/y'), ExtractError);
});
