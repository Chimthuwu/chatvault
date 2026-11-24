import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../site/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');

test('first visit presents a skippable cinematic intro and guided install flow', () => {
  for (const id of ['onboarding', 'skip-intro', 'install-manager', 'manager-installed', 'install-userscript', 'script-installed', 'finish-onboarding', 'setup-guide']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing onboarding control: ' + id);
  }
  for (const step of ['0', '1', '2', '3']) assert.ok(html.includes('data-onboarding-step="' + step + '"'));
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Skip intro — take me to setup/);
  assert.match(html, /Skip setup for now/);
  assert.match(html, /raw\.githubusercontent\.com\/Chimthuwu\/chatvault\/main\/userscripts\/chatvault\.user\.js/);
  assert.match(html, /tampermonkey\.net/);
});

test('onboarding remembers completion, can be reopened, and does not interrupt one-click imports', () => {
  assert.match(app, /chatvault:onboarding:v1/);
  assert.match(app, /localStorage\.getItem\(ONBOARDING_KEY\)/);
  assert.match(app, /localStorage\.setItem\(ONBOARDING_KEY/);
  assert.match(app, /setup-guide.*openOnboarding/s);
  assert.match(app, /!onboardingChoice && !isHandoffArrival/);
  assert.match(app, /window\.open\('https:\/\/chatgpt\.com\//);
});

test('onboarding has responsive layout and respects reduced-motion preferences', () => {
  assert.match(css, /\.cinematic-stage/);
  assert.match(css, /@keyframes file-arrive/);
  assert.match(css, /@media \(max-width:650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('application module passes Node syntax validation', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../site/app.js', import.meta.url))], { stdio: 'pipe' });
});
