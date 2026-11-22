// Dependency-free ZIP and PDF writers for ChatVault.
// ZIP uses the STORE method (no compression library needed).
// PDF is a real, text-selectable A4 document using the standard Helvetica fonts.
// Non-WinAnsi characters are transliterated; use "Print-perfect PDF" for full Unicode/images.

import { messageToText, roleLabel } from './core.js';

const encoder = new TextEncoder();

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  return encoder.encode(String(data));
}

// files: [{ name: 'a.md', data: string | Uint8Array }]
export function makeZip(files) {
  const entries = files.map(f => ({ name: encoder.encode(f.name), data: toBytes(f.data) }));
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const entry of entries) {
    const crc = crc32(entry.data);
    const local = [
      ...u32(0x04034B50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(entry.data.length), ...u32(entry.data.length),
      ...u16(entry.name.length), ...u16(0)
    ];
    chunks.push(new Uint8Array(local), entry.name, entry.data);
    central.push({
      header: new Uint8Array([
        ...u32(0x02014B50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(entry.data.length), ...u32(entry.data.length),
        ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]),
      name: entry.name
    });
    offset += local.length + entry.name.length + entry.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.header.length + c.name.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054B50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0)
  ]);
  return new Blob([...chunks, ...central.flatMap(c => [c.header, c.name]), end], { type: 'application/zip' });
}

const SUBSTITUTIONS = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '•': '*',
  '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '×': 'x', ' ': ' ', '′': "'", '″': '"'
};

function pdfText(value) {
  let out = '';
  for (const ch of String(value)) {
    if (SUBSTITUTIONS[ch] !== undefined) { out += SUBSTITUTIONS[ch]; continue; }
    const code = ch.codePointAt(0);
    if (code >= 32 && code <= 126) { out += ch; continue; }
    if (code >= 160 && code <= 255) { out += String.fromCharCode(code); continue; }
    out += '?';
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width && current) { lines.push(current); current = word; }
    else current = current ? current + ' ' + word : word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function pdfLines(conv) {
  const lines = [{ text: conv.title || 'Conversation', font: 'F2', size: 17 }];
  lines.push({ text: `Source: ${conv.source || 'local import'}`, size: 9 });
  lines.push({ text: `Exported: ${conv.exportedAt || ''}  |  Platform: ${conv.metadata?.platform || 'generic'}`, size: 9 });
  lines.push({ text: `Messages: ${conv.messages?.length || 0}`, size: 9 });
  lines.push({ text: ' ', size: 9 });
  for (const [i, m] of (conv.messages || []).entries()) {
    lines.push({ text: `--- ${i + 1}. ${roleLabel(m.role)} ${m.timestamp ? '(' + m.timestamp + ')' : ''} ---`, font: 'F2', size: 11 });
    for (const raw of messageToText(m).split('\n')) {
      if (raw.length > 96) lines.push(...wrap(raw, 96).map(text => ({ text, size: 10 })));
      else lines.push({ text: raw, size: 10 });
    }
    lines.push({ text: ' ', size: 10 });
  }
  for (const warning of conv.metadata?.warnings || []) lines.push({ text: 'WARNING: ' + warning, size: 9 });
  return lines;
}

// Minimal, valid PDF 1.4 with selectable text. Returns a Blob.
export function makePdf(conv) {
  const lines = pdfLines(conv);
  const pages = [];
  let current = [];
  let y = 796;
  for (const line of lines) {
    const leading = (line.size || 10) + 4;
    if (y < 62) { pages.push(current); current = []; y = 796; }
    current.push(`BT /${line.font || 'F1'} ${line.size || 10} Tf 52 ${y} Td (${pdfText(line.text)}) Tj ET`);
    y -= leading;
  }
  if (current.length || !pages.length) pages.push(current);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  ];
  for (const content of pages) {
    const stream = content.join('\n') + '\n';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([encoder.encode(pdf)], { type: 'application/pdf' });
}

export async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}
