// Build the self-contained userscript from the shared modules + header + UI.
// Keeping one source of truth means the web app, CLI and userscript export identically.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const parts = [
  'templates/userscript-header.js',
  'site/core.js',
  'site/archive.js',
  'site/extract-browser.js',
  'userscripts/chatvault-main.js'
];

let output = '// GENERATED FILE — do not edit. Run: npm run build:userscript\n';
for (const part of parts) {
  const source = await readFile(new URL(part, root), 'utf8');
  const stripped = source
    .replace(/^import[^\n]*from\s+['"]\.\/[^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+/gm, '');
  output += `\n/* ===== ${part} ===== */\n${stripped.trim()}\n`;
}
await writeFile(new URL('userscripts/chatvault.user.js', root), output, 'utf8');
console.log(`built userscripts/chatvault.user.js (${output.length} chars)`);
