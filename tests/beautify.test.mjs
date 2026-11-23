import test from 'node:test';
import assert from 'node:assert/strict';
import {
  protectContent, restoreContent, beautifyMarkdown, generateToc, formatDate,
  buildIntelligenceReport, buildEditorialPrompt, detectInputType, beautifyConversation, STYLES
} from '../site/beautify.js';
import { toConversation } from '../site/core.js';

test('protectContent round-trips fenced code byte-for-byte', () => {
  const fence = [
    '```yaml',
    '# not a real heading',
    '---',
    '* still code',
    '````',
    'nested longer fence stays code',
    '````',
    'https://do-not-link.example',
    '```'
  ].join('\n');
  const input = `# Title\n\n${fence}\n\nOutside text.`;
  const { text, tokens } = protectContent(input);
  assert.ok(tokens.size >= 1);
  assert.equal(restoreContent(text, tokens), input);
});

test('beautifyMarkdown preserves code and links bare URLs outside code', () => {
  const input = [
    'intro text',
    '',
    '```js',
    'const url = "https://inside.example";',
    '// --- not a separator',
    '```',
    '',
    'See https://outside.example now',
    '',
    '',
    '',
    '---',
    '---',
    'end'
  ].join('\n');
  const out = beautifyMarkdown(input, { style: 'clean' });
  assert.match(out, /const url = "https:\/\/inside\.example";/);
  assert.match(out, /\/\/ --- not a separator/);
  assert.match(out, /See \[https:\/\/outside\.example\]\(https:\/\/outside\.example\) now/);
  assert.equal((out.match(/^---$/gm) || []).length, 1);
  assert.doesNotMatch(out, /\n\n\n/);
});

test('normalizes setext headings, list markers and heading jumps', () => {
  const out = beautifyMarkdown('### Deep heading\ntext\n\n* one\n+ two\n\nOther\n---\n\nbody', { style: 'clean' });
  assert.match(out, /^# Deep heading/m);
  assert.match(out, /^- one\n- two/m);
  assert.match(out, /## Other/);
});

test('raw style is an exact no-op and styles are declared', () => {
  const input = '# Title\n\nraw   spaces\n\n\n---\n';
  assert.equal(beautifyMarkdown(input, { style: 'raw' }), input);
  assert.deepEqual(STYLES.map(s => s.id), ['clean', 'report', 'kb', 'raw']);
});

test('generateToc skips the title and de-duplicates anchors', () => {
  const toc = generateToc('# Title\n\n## Setup\n\n## Setup\n\n### Details\n');
  assert.match(toc, /- \[Setup\]\(#setup\)/);
  assert.match(toc, /- \[Setup\]\(#setup-2\)/);
  assert.match(toc, /  - \[Details\]\(#details\)/);
  assert.doesNotMatch(toc, /Title/);
});

test('report style formats metadata into a readable header', () => {
  const out = beautifyMarkdown('# Chat\n\n## Details\n\nbody', {
    style: 'report',
    metadata: { source: 'https://chatgpt.com/share/abc', exported: '2026-11-22T12:00:00Z', messages: 8, platform: 'chatgpt' }
  });
  assert.match(out, /> \*\*Source:\*\* \[Original conversation\]\(https:\/\/chatgpt\.com\/share\/abc\)/);
  assert.match(out, /> \*\*Exported:\*\* 22 November 2026, 12:00 UTC/);
  assert.match(out, /> \*\*Messages:\*\* 8/);
  assert.match(out, /## Contents/);
  assert.equal(formatDate('2026-11-22T12:00:00Z'), '22 November 2026, 12:00 UTC');
});

test('intelligence report only extracts content present in the source', () => {
  const conv = toConversation({
    title: 'SydForge planning',
    messages: [
      { role: 'user', content: 'We decided to drop Supabase and use Cloudflare. TODO: wire the worker.' },
      { role: 'assistant', content: 'Agreed. Edit Z:/GITHUB/APP/worker.js and chatvault.core.ts next.\n\n```js\nconst decision = 1;\n```' }
    ],
    platform: 'chatgpt'
  });
  const report = buildIntelligenceReport(conv);
  assert.match(report, /Decisions & conclusions/);
  assert.match(report, /worker\.js/);
  assert.match(report, /Preserved code references/);
  assert.match(report, /from 1\. You/);
  assert.doesNotMatch(report, /Lemonwig|Driftfall/);
  assert.match(report, /No facts were added/);
});

test('beautifyConversation keeps the original intact and returns all variants', () => {
  const conv = toConversation({
    title: 'Test', source: 'https://example.com/x',
    messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'World' }]
  });
  const result = beautifyConversation(conv);
  assert.equal(result.original, result.variants.raw);
  assert.deepEqual(Object.keys(result.variants), ['raw', 'clean', 'report', 'kb']);
  assert.match(result.editorialPrompt, /Paste this whole document into an AI assistant/);
  assert.match(result.editorialPrompt, /World/);
  assert.equal(detectInputType('# hi'), 'markdown');
  assert.equal(detectInputType('[{"role":"user","content":"hi"}]'), 'json');
});

test('TOC ignores headings inside code fences; report parses text after a fence', () => {
  const input = [
    '# Root',
    '',
    '```yaml',
    '# fake heading',
    '---',
    '```',
    '',
    'We decided to use Cloudflare. TODO: wire worker.js next.'
  ].join('\n');
  const out = beautifyMarkdown(input, { style: 'report' });
  assert.doesNotMatch(out, /\[fake heading\]/);
  assert.doesNotMatch(out, /## Contents/);
  assert.match(out, /```yaml\n# fake heading\n---\n```/);
  const withMeta = beautifyMarkdown('Source: https://x.test\n\n# Root\n\n## Details\n\nbody', { style: 'report' });
  assert.match(withMeta, /^# Root\n\n> \*\*Source:\*\*[\s\S]*\n\n## Contents/m);
  const report = buildIntelligenceReport(input);
  assert.match(report, /Intelligence Report — Root/);
  assert.match(report, /worker\.js/);
  assert.match(report, /use Cloudflare/);
  assert.match(report, /Preserved code references/);
});

test('agent handoff separates decisions, constraints, proposals and open questions', async () => {
  const { buildAgentHandoff } = await import('../site/beautify.js');
  const source = [
    '# ChatVault implementation',
    'We decided to use local browser storage.',
    'The app must preserve the user original transcript.',
    'We could add an optional agent bundle later.',
    'TODO: verify the ZIP export in Firefox?',
    'The archive is currently stored in localStorage.',
    'Update site/app.js and tests/beautify.test.mjs next.'
  ].join('\n');
  const handoff = buildAgentHandoff(source);
  assert.match(handoff, /Confirmed decisions/);
  assert.match(handoff, /decided to use local browser storage/);
  assert.match(handoff, /Requirements & constraints/);
  assert.match(handoff, /must preserve the user original transcript/);
  assert.match(handoff, /Proposals & ideas/);
  assert.match(handoff, /could add an optional agent bundle/);
  assert.match(handoff, /Open questions, dependencies & blockers/);
  assert.match(handoff, /verify the ZIP export in Firefox/);
  assert.ok(handoff.includes('site/app.js'));
  assert.match(handoff, /Treat proposals as unapproved/);
  assert.match(handoff, /Acceptance criteria/);
  const actions = handoff.split('## Potential next actions')[1].split('## Relevant files')[0];
  assert.doesNotMatch(actions, /could add an optional agent bundle/);
  assert.match(handoff, /We decided to use local browser storage/);
});
