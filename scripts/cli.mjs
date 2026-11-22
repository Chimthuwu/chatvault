#!/usr/bin/env node
// ChatVault CLI — convert a local JSON export into all formats, no network.
// Usage: node scripts/cli.mjs --input export.json --out ./my-chat [--title "My chat"]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseImport, renderMarkdown, renderHtml, slugify } from '../site/core.js';
import { makePdf, makeZip, blobBytes } from '../site/archive.js';

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const inputPath = arg('--input', arg('-i'));
const outDir = resolve(arg('--out', arg('-o', './chatvault-out')));
if (!inputPath) {
  console.error('Usage: node scripts/cli.mjs --input <file.json> [--out <dir>] [--title "Name"]');
  process.exit(1);
}

try {
  const raw = await readFile(inputPath, 'utf8');
  const conv = parseImport(raw, resolve(inputPath));
  const overrideTitle = arg('--title');
  if (overrideTitle) conv.title = overrideTitle;
  const base = slugify(conv.title);
  await mkdir(outDir, { recursive: true });
  const md = renderMarkdown(conv);
  const html = renderHtml(conv);
  const pdf = makePdf(conv);
  const [pdfBytes, htmlBytes, jsonBytes] = await Promise.all([
    blobBytes(pdf),
    blobBytes(new Blob([html])),
    blobBytes(new Blob([JSON.stringify(conv, null, 2)]))
  ]);
  const zip = await makeZip([
    { name: base + '.md', data: md },
    { name: base + '.pdf', data: pdfBytes },
    { name: base + '.html', data: htmlBytes },
    { name: base + '.json', data: jsonBytes }
  ]);
  const files = [
    [base + '.md', md], [base + '.pdf', pdfBytes], [base + '.html', htmlBytes],
    [base + '.json', jsonBytes], [base + '.zip', await blobBytes(zip)]
  ];
  for (const [name, data] of files) await writeFile(join(outDir, name), data);
  console.log(`ChatVault: ${conv.messages.length} messages → ${outDir}`);
  files.forEach(([name, data]) => console.log(`  ${name} (${data.length} bytes)`));
} catch (error) {
  console.error('ChatVault: ' + error.message);
  process.exit(1);
}
