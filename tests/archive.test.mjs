import test from 'node:test';
import assert from 'node:assert/strict';
import { makePdf, makeZip, blobBytes } from '../site/archive.js';
import { toConversation } from '../site/core.js';

const conv = toConversation({
  title: 'Archive test', source: 'local',
  messages: [
    { role: 'user', content: 'héllo “world” → ok' },
    { role: 'assistant', content: ['line one', 'line two'].join('\n') }
  ]
});

test('makePdf produces a valid-looking PDF with two pages-worth of objects', async () => {
  const pdf = makePdf(conv);
  assert.equal(pdf.type, 'application/pdf');
  const text = new TextDecoder().decode(await blobBytes(pdf));
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/Type \/Pages/);
  assert.match(text, /startxref/);
  assert.match(text, /%%EOF/);
  assert.match(text, /Archive test/);
  assert.ok(pdf.size > 800);
});

test('makeZip produces a readable archive containing all four exports', async () => {
  const zip = await makeZip([
    { name: 'a.md', data: '# hi' },
    { name: 'b.pdf', data: new Uint8Array([37, 80, 68, 70]) },
    { name: 'c.json', data: '{}' }
  ]);
  const bytes = await blobBytes(zip);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'PK\x03\x04');
  const names = new TextDecoder().decode(bytes);
  assert.match(names, /a\.md/);
  assert.match(names, /b\.pdf/);
  assert.match(names, /c\.json/);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
});
