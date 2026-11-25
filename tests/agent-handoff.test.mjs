import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentHandoff } from '../site/beautify.js';

const conversation = {
  title: 'Handoff fixture',
  source: 'https://chatgpt.com/c/example',
  exportedAt: '2026-11-25T00:00:00.000Z',
  metadata: { platform: 'chatgpt', extractionMethod: 'structured' },
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Build a reusable city generation tool from SydForge. We decided the existing game stays the foundation. It must preserve current working systems.' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'We could create a separate editor later. The current import pipeline is implemented but not runtime verified.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Please inspect the repo, update the architecture plan, and do not rewrite the game. Is the OSM dataset still available?' }] }
  ]
};

test('agent handoff leads with the latest user request', () => {
  const brief = buildAgentHandoff(conversation);
  assert.ok(brief.indexOf('## Read this first') < brief.indexOf('## Objective & original context'));
  assert.ok(brief.includes('Please inspect the repo, update the architecture plan'));
  assert.ok(brief.includes('Messages captured:** 3'));
});

test('agent handoff separates user decisions and constraints from assistant proposals', () => {
  const brief = buildAgentHandoff(conversation);
  assert.match(brief, /User decisions \(explicit wording only\)/);
  assert.match(brief, /We decided the existing game stays the foundation/);
  assert.match(brief, /User requirements & constraints/);
  assert.match(brief, /It must preserve current working systems/);
  assert.match(brief, /Assistant proposals \(not automatically approved\)/);
  assert.match(brief, /We could create a separate editor later/);
  assert.doesNotMatch(brief.split('## User decisions')[1].split('## User requirements')[0], /We could create/);
});

test('progress statements are attributed as claims and not represented as verification', () => {
  const brief = buildAgentHandoff(conversation);
  assert.match(brief, /Progress statements \(claims; verify in repository\)/);
  assert.match(brief, /implemented but not runtime verified/);
  assert.match(brief, /This handoff is not a live repository snapshot/);
  assert.match(brief, /does not establish current code state/);
});

test('string-only input remains supported without fabricating a latest request', () => {
  const brief = buildAgentHandoff('# Old handoff\n\nSome context.');
  assert.match(brief, /No user request was available/);
  assert.match(brief, /Old handoff/);
});
