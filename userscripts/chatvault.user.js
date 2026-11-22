// GENERATED FILE — do not edit. Run: npm run build:userscript

/* ===== templates/userscript-header.js ===== */
// ==UserScript==
// @name         ChatVault — Export any LLM chat (MD / PDF / ZIP)
// @namespace    https://github.com/Chimthuwu/chatvault
// @version      3.0.0
// @description  Export ChatGPT, Claude, Gemini, Grok, DeepSeek and other chats to Markdown, PDF, HTML or ZIP. Local, no API key.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://claude.ai/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @match        https://x.com/*
// @match        https://chat.deepseek.com/*
// @match        https://perplexity.ai/*
// @match        https://www.perplexity.ai/*
// @match        https://copilot.microsoft.com/*
// @match        https://www.bing.com/chat/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

/* ===== site/core.js ===== */
// ChatVault core — shared, dependency-free conversation model + exporters.
// Used by the web app, the Worker API, the Hermes skill CLI and the userscript.
// No DOM and no network access in this file.

const PLATFORMS = [
  { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], share: /^\/share\/[^/]+/, structured: true },
  { id: 'claude', label: 'Claude', hosts: ['claude.ai'], share: /^\/share\/[^/]+/, structured: false },
  { id: 'gemini', label: 'Gemini', hosts: ['gemini.google.com', 'g.co'], share: /^\/(gemini\/)?share\/[^/]+/, structured: false },
  { id: 'grok', label: 'Grok', hosts: ['grok.com', 'x.com'], share: /^\/grok\/share\//, structured: false },
  { id: 'deepseek', label: 'DeepSeek', hosts: ['chat.deepseek.com'], share: /^\/s\//, structured: false },
  { id: 'perplexity', label: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'], share: /^\/search\//, structured: false },
  { id: 'copilot', label: 'Copilot', hosts: ['copilot.microsoft.com', 'bing.com'], share: /\/chat\//, structured: false }
];

function platformForHost(hostname = '') {
  const host = String(hostname).toLowerCase().replace(/^www\./, '');
  return PLATFORMS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h))) || null;
}

function slugify(value, max = 90) {
  return String(value || '')
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, max) || 'conversation';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function contentToText(block) {
  if (!block) return '';
  if (typeof block === 'string') return block;
  switch (block.type) {
    case 'text': return String(block.text || '');
    case 'code': return '```' + (block.language || '') + '\n' + String(block.text || '') + '\n```';
    case 'math': return '$$\n' + String(block.text || '') + '\n$$';
    case 'image': return block.url ? `![${block.alt || 'Image'}](${block.url})` : `[Image: ${block.alt || 'unavailable'}]`;
    case 'file': return block.url ? `[${block.name || 'Attachment'}](${block.url})` : `[Attachment: ${block.name || 'file'}]`;
    case 'table': {
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (!rows.length) return '';
      const cells = rows.map(r => '| ' + (Array.isArray(r) ? r : []).map(c => String(c ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |');
      return cells[0] + '\n| ' + cells[0].split('|').slice(1, -1).map(() => '---').join(' | ') + ' |\n' + cells.slice(1).join('\n');
    }
    case 'tool_call': case 'tool_result':
      return `**${block.type}**${block.toolName ? ` (${block.toolName})` : ''}\n\n${String(block.text || '')}`;
    default:
      return String(block.text || block.content || '');
  }
}

function messageToText(message) {
  return (message.content || []).map(contentToText).filter(Boolean).join('\n\n').trim();
}

function roleFrom(value) {
  const role = String(value ?? '').toLowerCase();
  if (role === 'human' || role === 'user' || role === 'you') return 'user';
  if (['assistant', 'model', 'ai', 'bot', 'gpt', 'system-assistant'].includes(role)) return 'assistant';
  if (role === 'system') return 'system';
  if (['tool', 'function', 'tool_result'].includes(role)) return 'tool';
  return null;
}

function blocksFrom(value) {
  if (Array.isArray(value)) {
    return value.map(v => typeof v === 'string' ? { type: 'text', text: v } : v).filter(Boolean);
  }
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string' && Object.keys(value).length <= 3) return [{ type: 'text', text: value.text }];
    if (Array.isArray(value.parts)) return blocksFrom(value.parts);
  }
  return [];
}

function normalizeMessages(raw) {
  const out = [];
  const seen = new Set();
  for (const item of raw || []) {
    if (!item || typeof item !== 'object') continue;
    const role = roleFrom(item.role ?? item.author?.role ?? item.author ?? item.sender);
    if (!role) continue;
    let content = blocksFrom(item.content ?? item.parts ?? item.text ?? item.message);
    content = content.map(b => {
      if (typeof b === 'string') return { type: 'text', text: b };
      if (b?.type === 'image' || b?.image_url || b?.asset_pointer) {
        const url = typeof b.image_url === 'string' ? b.image_url : b.image_url?.url;
        return { type: 'image', url: url || '', alt: b.alt || 'Image' };
      }
      if (b?.type === 'code' || typeof b?.code === 'string') {
        return { type: 'code', text: b.code ?? b.text ?? '', language: b.language || '' };
      }
      if (b?.type === 'text' || typeof b?.text === 'string') return { type: 'text', text: String(b.text || '') };
      return b;
    }).filter(b => b && (b.url || b.text || b.rows));
    if (!content.length) continue;
    const text = content.map(contentToText).join('\n');
    const id = String(item.id || `${role}:${text.slice(0, 120)}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      role,
      timestamp: item.timestamp || item.create_time || item.created_at || null,
      content,
      metadata: item.metadata || undefined
    });
  }
  return out;
}

function toConversation({ id = 'conversation', title = 'Conversation', source = '', messages = [], platform = 'generic', method = 'import', warnings = [] }) {
  const normalized = normalizeMessages(messages);
  return {
    id, title, source, exportedAt: new Date().toISOString(), messages: normalized,
    metadata: {
      platform,
      extractionMethod: method,
      messageCount: normalized.length,
      warnings: warnings.filter(Boolean)
    }
  };
}

function timeLine(message) {
  if (!message.timestamp) return '';
  const t = typeof message.timestamp === 'number'
    ? new Date(message.timestamp > 1e12 ? message.timestamp : message.timestamp * 1000).toISOString()
    : String(message.timestamp);
  return `<time>${t}</time>\n\n`;
}

function roleLabel(role) {
  return { user: 'You', assistant: 'Assistant', system: 'System', tool: 'Tool' }[role] || role;
}

function renderMarkdown(conv) {
  const meta = [
    `# ${conv.title || 'Conversation'}`,
    '',
    `> Source: ${conv.source || 'local import'}`,
    `> Exported: ${conv.exportedAt || new Date().toISOString()}`,
    `> Platform: ${conv.metadata?.platform || 'generic'}`,
    `> Extraction: ${conv.metadata?.extractionMethod || 'import'}`,
    `> Messages: ${conv.messages?.length || 0}`,
    ...(conv.metadata?.warnings || []).map(w => `> ⚠️ ${w}`),
    '',
    '---',
    ''
  ];
  const body = (conv.messages || []).map((m, i) =>
    `## ${i + 1}. ${roleLabel(m.role)}\n\n${timeLine(m)}${messageToText(m)}`
  ).join('\n\n---\n\n');
  return meta.join('\n') + body + '\n';
}

function renderMessageHtml(m, i) {
  const body = messageToText(m).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  return `<section class="message ${escapeHtml(m.role)}"><h2>${i + 1}. ${escapeHtml(roleLabel(m.role))}</h2>` +
    (m.timestamp ? `<p class="time">${escapeHtml(String(m.timestamp))}</p>` : '') +
    `<div class="body">${body}</div></section>`;
}

function renderHtml(conv, { print = false } = {}) {
  const warning = (conv.metadata?.warnings || []).length
    ? `<div class="warnings">${conv.metadata.warnings.map(w => `<p>⚠️ ${escapeHtml(w)}</p>`).join('')}</div>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(conv.title || 'Conversation')}</title>
<style>
:root{color-scheme:light}body{margin:0;background:#f5f7f7;color:#18302e;font:16px/1.65 system-ui,sans-serif}
header{max-width:860px;margin:0 auto;padding:42px 24px 20px}h1{font-size:2rem;margin:0 0 12px;color:#0d3b34}
.meta{color:#5b7773;font-size:.85rem;line-height:1.7}.warnings{max-width:860px;margin:0 auto 20px;padding:12px 18px;background:#fff6e5;border-left:4px solid #e0a32b}
main{max-width:860px;margin:0 auto;padding:0 24px 60px}.message{background:#fff;border:1px solid #d9e5e2;border-radius:12px;padding:20px 24px;margin:18px 0;break-inside:avoid}
.message.user{background:#eff8f5;border-left:4px solid #14a98c}.message h2{font-size:1rem;margin:0 0 8px;color:#0f6c5c;text-transform:uppercase;letter-spacing:.06em}
.time{font-size:.75rem;color:#7a918d;margin:0 0 12px}.body{white-space:normal;overflow-wrap:anywhere}
header+main{border-top:1px solid #d9e5e2}@page{size:A4;margin:18mm}
@media print{body{background:#fff}.message{box-shadow:none;border-color:#ccc}header{padding-top:0}}
</style></head><body>
<header><h1>${escapeHtml(conv.title || 'Conversation')}</h1>
<div class="meta">Source: ${escapeHtml(conv.source || 'local import')}<br>Exported: ${escapeHtml(conv.exportedAt || '')}<br>
Platform: ${escapeHtml(conv.metadata?.platform || 'generic')} · Messages: ${conv.messages?.length || 0}</div></header>
${warning}<main>${(conv.messages || []).map(renderMessageHtml).join('')}</main>
${print ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400));<\/script>' : ''}
</body></html>`;
}

// Parse a platform JSON export or a generic {role, content} array into a conversation.
function parseImport(text, source = 'local import') {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('That is not valid JSON. Paste a .json conversation export instead.'); }

  const deepFind = (root, predicate, depth = 0, seen = new WeakSet()) => {
    if (!root || typeof root !== 'object' || depth > 8 || seen.has(root)) return null;
    seen.add(root);
    if (predicate(root)) return root;
    for (const value of Object.values(root)) {
      if (value && typeof value === 'object') {
        const found = deepFind(value, predicate, depth + 1, seen);
        if (found) return found;
      }
    }
    return null;
  };
  const looksLikeMessages = v => Array.isArray(v) && v.length > 0 && v.some(m => m && typeof m === 'object' &&
    (m.author?.role || m.role || m.sender) && (m.content !== undefined || m.text !== undefined || m.content?.parts));

  let title = 'Imported conversation';
  let messages = null;

  if (Array.isArray(data)) {
    const exported = data.find(c => c && (c.mapping || c.chat_messages || Array.isArray(c.messages)));
    if (exported) data = exported;
  }
  if (data && typeof data === 'object') {
    title = data.title || data.name || data.conversation?.title || title;
    if (data.mapping) {
      const mapping = data.mapping;
      const current = data.current_node || data.current_node_id;
      const ordered = [];
      if (current && mapping[current]) {
        let id = current;
        const seen = new Set();
        while (id && mapping[id] && !seen.has(id)) {
          seen.add(id);
          if (mapping[id].message) ordered.unshift(mapping[id].message);
          id = mapping[id].parent;
        }
      }
      if (!ordered.length) {
        for (const node of Object.values(mapping)) if (node?.message) ordered.push(node.message);
      }
      messages = ordered;
    } else if (Array.isArray(data.chat_messages)) {
      messages = data.chat_messages;
    } else if (Array.isArray(data.messages)) {
      messages = data.messages;
    } else if (Array.isArray(data.conversation?.messages)) {
      messages = data.conversation.messages;
    } else {
      const found = deepFind(data, looksLikeMessages);
      if (found) messages = found;
    }
  }
  if (!messages) throw new Error('No messages found in that JSON. Try a ChatGPT/Claude/Gemini/Grok/DeepSeek export, or a plain array of {role, content} objects.');
  const normalized = normalizeMessages(messages);
  if (!normalized.length) throw new Error('Messages were found but none had a recognized role (user/assistant).');
  return toConversation({ title, source, messages: normalized, platform: 'import', method: 'JSON import' });
}

function validateConversation(value) {
  return !!(value && typeof value === 'object' && Array.isArray(value.messages) && value.messages.length <= 20000 &&
    value.messages.every(m => m && typeof m === 'object' && Array.isArray(m.content)));
}

function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') throw new Error('downloadBlob requires a browser');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function openPrintWindow(html) {
  if (typeof window === 'undefined') throw new Error('openPrintWindow requires a browser');
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Popup blocked. Allow popups for this site and try again.');
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return popup;
}

/* ===== site/archive.js ===== */
// Dependency-free ZIP and PDF writers for ChatVault.
// ZIP uses the STORE method (no compression library needed).
// PDF is a real, text-selectable A4 document using the standard Helvetica fonts.
// Non-WinAnsi characters are transliterated; use "Print-perfect PDF" for full Unicode/images.



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
function makeZip(files) {
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
function makePdf(conv) {
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

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/* ===== site/extract-browser.js ===== */
// Browser-side extraction adapters.
// ChatGPT uses its structured backend response (the path that produced the first successful export).
// Every other platform uses layered DOM selectors with a generic heuristic fallback.
// ESM for the web app; the userscript build strips imports/exports and inlines this file.


const DOM_PLATFORMS = [
  {
    id: 'claude', hosts: ['claude.ai'], label: 'Claude',
    selectors: ['[data-testid="user-message"]', '[data-testid="assistant-message"]', '.font-claude-response', '[data-message-author-role]']
  },
  {
    id: 'gemini', hosts: ['gemini.google.com', 'g.co'], label: 'Gemini',
    selectors: ['.user-query-bubble-with-background', '.model-response-text', '[data-test-id="user-message"]', 'message-content']
  },
  {
    id: 'grok', hosts: ['grok.com', 'x.com'], label: 'Grok',
    selectors: ['[data-testid^="message"]', '.message-content', '[data-message-author-role]']
  },
  {
    id: 'deepseek', hosts: ['chat.deepseek.com'], label: 'DeepSeek',
    selectors: ['[data-testid^="message"]', '.ds-markdown', '[data-message-author-role]']
  },
  {
    id: 'perplexity', hosts: ['perplexity.ai'], label: 'Perplexity',
    selectors: ['[data-testid^="message"]', '.prose', '[data-message-author-role]']
  },
  {
    id: 'copilot', hosts: ['copilot.microsoft.com', 'bing.com'], label: 'Copilot',
    selectors: ['[data-content="user-message"]', '[class*="response"]', '[data-message-author-role]']
  },
  {
    id: 'chatgpt', hosts: ['chatgpt.com', 'chat.openai.com'], label: 'ChatGPT',
    selectors: ['[data-message-author-role]', '[data-testid^="conversation-turn-"]', '[aria-label*="message from"]']
  }
];

function detectPagePlatform() {
  const host = (typeof location !== 'undefined' ? location.hostname : '').toLowerCase();
  return DOM_PLATFORMS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h))) ||
    { id: 'generic', label: 'Chat', selectors: ['article', '[role="article"]', '[data-testid*="message"]'] };
}

function nodeToMarkdown(node) {
  if (!node) return '';
  if (node.nodeType === 3) return String(node.textContent || '').replace(/\u00a0/g, ' ');
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  if (['button', 'svg', 'script', 'style', 'textarea', 'input', 'nav', 'footer'].includes(tag)) return '';
  if (tag === 'br') return '\n';
  const children = () => Array.from(node.childNodes).map(nodeToMarkdown).join('');
  if (tag === 'pre') {
    const code = node.querySelector('code');
    const language = code?.className?.match(/language-([\w+-]+)/)?.[1] || '';
    const source = (code || node).textContent.replace(/\n+$/, '');
    return `\n\n\`\`\`${language}\n${source}\n\`\`\`\n\n`;
  }
  if (tag === 'code') return '`' + node.textContent.replace(/`/g, '\\`') + '`';
  if (/^h[1-6]$/.test(tag)) return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + children() + '\n\n';
  if (tag === 'strong' || tag === 'b') return `**${children()}**`;
  if (tag === 'em' || tag === 'i') return `*${children()}*`;
  if (tag === 'a') {
    const href = node.getAttribute('href');
    const label = children().trim();
    return href ? `[${label || href}](${href})` : label;
  }
  if (tag === 'img') return `![${node.alt || 'Image'}](${node.src || ''})`;
  if (tag === 'li') return '- ' + children().trim() + '\n';
  if (tag === 'ul' || tag === 'ol') return '\n' + children() + '\n';
  if (tag === 'blockquote') return '\n' + children().trim().split('\n').map(l => '> ' + l).join('\n') + '\n';
  if (tag === 'tr') return '| ' + Array.from(node.children).map(nodeToMarkdown).join(' | ') + ' |\n';
  if (tag === 'td' || tag === 'th') return children();
  if (tag === 'table') return '\n\n' + children() + '\n';
  if (['p', 'div', 'section', 'article'].includes(tag)) return '\n\n' + children() + '\n\n';
  return children();
}

function roleFromNode(node) {
  const direct = node.getAttribute?.('data-message-author-role') || node.getAttribute?.('data-role');
  if (direct) return direct.toLowerCase();
  const aria = node.getAttribute?.('aria-label') || '';
  const match = aria.match(/message from (user|assistant|model|human)/i);
  if (match) return match[1].toLowerCase();
  const testid = node.getAttribute?.('data-testid') || '';
  if (/user/i.test(testid)) return 'user';
  if (/assistant|response|model|bot/i.test(testid)) return 'assistant';
  const cls = String(node.className || '');
  if (/user-query|user-message|human/i.test(cls)) return 'user';
  if (/assistant|model-response|claude-response|ds-markdown/i.test(cls)) return 'assistant';
  return null;
}

function extractFromDOM(root = document, platform = detectPagePlatform()) {
  const nodes = [];
  const seenNodes = new Set();
  for (const selector of platform.selectors) {
    for (const el of root.querySelectorAll(selector)) {
      if (!seenNodes.has(el)) { seenNodes.add(el); nodes.push(el); }
    }
  }
  const raw = [];
  for (const node of nodes) {
    let role = roleFromNode(node);
    if (!role) {
      const inner = node.querySelector('[data-message-author-role], [data-testid*="user-message"], .model-response-text');
      role = inner ? roleFromNode(inner) : null;
    }
    // Alternating heuristic for generic chats without role markers.
    if (!role) role = raw.length % 2 === 0 ? 'user' : 'assistant';
    const content = nodeToMarkdown(node).trim();
    if (!content) continue;
    raw.push({
      id: node.getAttribute?.('data-message-id') || `dom-${raw.length}`,
      role: role === 'human' ? 'user' : role === 'model' ? 'assistant' : role,
      content: [{ type: 'text', text: content }]
    });
  }
  return normalizeMessages(raw);
}

// ---- ChatGPT structured backend path (verified working against /c/ conversations) ----

function getChatRoute() {
  const path = location.pathname;
  const share = path.match(/\/share\/([^/]+)/);
  if (share) return { type: 'share', id: decodeURIComponent(share[1]) };
  const conversation = path.match(/\/c\/([^/]+)/);
  if (conversation) return { type: 'conversation', id: decodeURIComponent(conversation[1]) };
  return null;
}

async function getSessionToken() {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    const session = await response.json();
    return session.accessToken || session.access_token || null;
  } catch { return null; }
}

async function fetchChatBackend(route) {
  const token = await getSessionToken();
  const endpoint = route.type === 'share'
    ? `/backend-api/share/${encodeURIComponent(route.id)}`
    : `/backend-api/conversation/${encodeURIComponent(route.id)}`;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(endpoint, { method: 'GET', credentials: 'same-origin', headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`ChatGPT API returned HTTP ${response.status}`);
  return response.json();
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findConversationObject(root) {
  const queue = [root];
  const visited = new WeakSet();
  while (queue.length) {
    const current = queue.shift();
    if (!isObject(current) && !Array.isArray(current)) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (isObject(current.mapping) || Array.isArray(current.linear_conversation) || Array.isArray(current.messages)) return current;
    const values = Array.isArray(current) ? current : Object.values(current);
    for (const value of values) if (isObject(value) || Array.isArray(value)) queue.push(value);
  }
  throw new Error('Conversation structure not found in the API response.');
}

function getRawMessages(conversation) {
  const mapping = isObject(conversation.mapping) ? conversation.mapping : {};
  const sequence = conversation.linear_conversation;
  if (Array.isArray(sequence) && sequence.length) {
    const messages = [];
    for (const entry of sequence) {
      if (!isObject(entry)) continue;
      let message = entry.message;
      if (!message && entry.id && mapping[entry.id]) message = mapping[entry.id].message;
      if (!message && entry.author) message = entry;
      if (isObject(message)) messages.push(message);
    }
    if (messages.length) return messages;
  }
  if (Array.isArray(conversation.messages)) return conversation.messages.filter(isObject);
  const currentId = conversation.current_node || conversation.current_node_id;
  if (currentId && mapping[currentId]) {
    const path = [];
    const seen = new Set();
    let id = currentId;
    while (id && mapping[id] && !seen.has(id)) {
      seen.add(id);
      if (mapping[id].message) path.unshift(mapping[id].message);
      id = mapping[id].parent || null;
    }
    if (path.length) return path;
  }
  return Object.values(mapping)
    .filter(node => isObject(node) && isObject(node.message) && !node.message?.metadata?.is_visually_hidden_from_conversation)
    .sort((a, b) => Number(a.message.create_time || 0) - Number(b.message.create_time || 0))
    .map(node => node.message);
}

function renderPart(part) {
  if (typeof part === 'string') return part;
  if (!isObject(part)) return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.code === 'string') return `\n\`\`\`${part.language || ''}\n${part.code}\n\`\`\`\n`;
  if (part.type === 'image' || part.image_url || part.asset_pointer) {
    const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    return url ? `![Image](${url})` : '[Image attachment]';
  }
  if (part.type === 'file' || part.filename) return `[Attachment: ${part.filename || part.name || 'File'}]`;
  if (typeof part.content === 'string') return part.content;
  return '';
}

function getMessageText(message) {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!isObject(content)) return '';
  if (typeof content.text === 'string') return content.text;
  const parts = content.parts || content.content || [];
  return Array.isArray(parts) ? parts.map(renderPart).filter(Boolean).join('\n\n') : '';
}

function normalizeChatMessages(rawMessages) {
  const result = [];
  const seen = new Set();
  for (const message of rawMessages || []) {
    if (!isObject(message)) continue;
    const role = message.author?.role || message.role;
    if (!['user', 'assistant', 'tool', 'system'].includes(role)) continue;
    if (message.metadata?.is_visually_hidden_from_conversation) continue;
    const content = getMessageText(message).trim();
    if (!content) continue;
    const id = message.id || `${role}:${content.slice(0, 100)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const timestamp = message.create_time;
    result.push({
      id, role,
      content: [{ type: 'text', text: content }],
      timestamp: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null
    });
  }
  return result;
}

async function collectCurrentConversation() {
  const platform = detectPagePlatform();
  let messages = [];
  let conversation = null;
  let method = 'Rendered page DOM';
  const warnings = [];

  if (platform.id === 'chatgpt') {
    const route = getChatRoute();
    if (route) {
      try {
        const data = await fetchChatBackend(route);
        conversation = findConversationObject(data);
        messages = normalizeChatMessages(getRawMessages(conversation));
        if (messages.length) method = 'ChatGPT backend data';
      } catch (error) {
        warnings.push(`ChatGPT backend extraction failed (${error.message}); used page DOM fallback.`);
        console.warn('[ChatVault] backend extraction failed:', error);
      }
    }
  }
  if (!messages.length) messages = extractFromDOM(document, platform);
  if (!messages.length) {
    const diagnostics = {
      url: location.href,
      platform: platform.id,
      roleNodes: document.querySelectorAll('[data-message-author-role]').length,
      turns: document.querySelectorAll('[data-testid^="conversation-turn"]').length
    };
    console.error('[ChatVault] extraction diagnostics:', diagnostics);
    throw new Error('No messages found. Let the page finish loading, then try again. Check the browser console for [ChatVault] diagnostics.');
  }
  const title = conversation?.title ||
    document.title.replace(/\s*[-|]\s*(ChatGPT|Claude|Gemini|Grok|DeepSeek).*$/i, '').trim() ||
    'Conversation';
  return toConversation({
    id: conversation?.id || getChatRoute()?.id || 'current-page',
    title,
    source: location.href,
    messages,
    platform: platform.id,
    method,
    warnings
  });
}

/* ===== userscripts/chatvault-main.js ===== */
// ChatVault userscript UI. Inlined by scripts/build-userscript.mjs after the shared modules.
(() => {
  'use strict';
  if (window.__chatVaultV3Loaded) return;

  const host = location.hostname.toLowerCase();
  if (host === 'x.com' && !/grok/i.test(location.pathname)) return;
  if (host.endsWith('bing.com') && !/chat/i.test(location.pathname)) return;

  window.__chatVaultV3Loaded = true;
  const PREFIX = '[ChatVault]';

  const style = document.createElement('style');
  style.id = 'chatvault-style';
  style.textContent = `
    #cv3-toolbar {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; gap: 6px; padding: 7px; border-radius: 13px;
      background: #101c1b; border: 1px solid #28544c; box-shadow: 0 8px 30px #0009;
      font-family: system-ui, sans-serif;
    }
    #cv3-toolbar button {
      padding: 10px 13px; border-radius: 8px; border: 1px solid #316b5c;
      background: #183b33; color: #70ffcf; font: 700 12px system-ui, sans-serif;
      cursor: pointer; white-space: nowrap;
    }
    #cv3-toolbar button:hover { background: #235548; }
    #cv3-toolbar button:disabled { opacity: .5; cursor: wait; }
    #cv3-toolbar #cv3-zip { background: #125747; border-color: #00dca5; }
    #cv3-status {
      position: fixed; right: 20px; bottom: 76px; z-index: 2147483000;
      max-width: 380px; padding: 11px 15px; border-radius: 9px;
      background: #111a1a; border: 1px solid #28544c; color: #9fffd9;
      font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 8px 30px #0009;
      display: none; overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);

  const toolbar = document.createElement('div');
  toolbar.id = 'cv3-toolbar';
  const statusBox = document.createElement('div');
  statusBox.id = 'cv3-status';
  document.body.append(toolbar, statusBox);

  function status(message, error = false) {
    statusBox.textContent = message;
    statusBox.style.display = 'block';
    statusBox.style.color = error ? '#ffaaaa' : '#9fffd9';
    console[error ? 'error' : 'log'](PREFIX, message);
  }

  const buttons = {};
  for (const [key, label] of [['md', '↓ MD'], ['pdf', '↓ PDF'], ['print', '🖨 PRINT'], ['html', '↓ HTML'], ['zip', '↓ ZIP']]) {
    const button = document.createElement('button');
    button.id = 'cv3-' + key;
    button.textContent = label;
    if (key === 'zip') button.title = 'Markdown + PDF + HTML + JSON in one archive';
    buttons[key] = button;
    toolbar.appendChild(button);
  }

  async function run(format) {
    Object.values(buttons).forEach(b => { b.disabled = true; });
    try {
      status('Extracting conversation…');
      const conv = await collectCurrentConversation();
      const base = slugify(conv.title);
      const markdown = renderMarkdown(conv);

      if (format === 'md') {
        downloadBlob(new Blob(['\uFEFF', markdown], { type: 'text/markdown;charset=utf-8' }), base + '.md');
        return status(`✓ Markdown saved — ${conv.messages.length} messages.`);
      }
      if (format === 'html') {
        downloadBlob(new Blob([renderHtml(conv)], { type: 'text/html;charset=utf-8' }), base + '.html');
        return status('✓ HTML archive saved.');
      }
      if (format === 'print') {
        openPrintWindow(renderHtml(conv, { print: true }));
        return status('✓ Print dialog opened. Choose “Save as PDF”.');
      }

      status('Building PDF…');
      const pdf = makePdf(conv);
      if (format === 'pdf') {
        downloadBlob(pdf, base + '.pdf');
        return status(`✓ PDF saved — ${(pdf.size / 1024).toFixed(0)} KB.`);
      }

      status('Building ZIP archive…');
      const [pdfBytes, htmlBytes, jsonBytes] = await Promise.all([
        blobBytes(pdf),
        blobBytes(new Blob([renderHtml(conv)], { type: 'text/html' })),
        blobBytes(new Blob([JSON.stringify(conv, null, 2)], { type: 'application/json' }))
      ]);
      downloadBlob(await makeZip([
        { name: base + '.md', data: markdown },
        { name: base + '.pdf', data: pdfBytes },
        { name: base + '.html', data: htmlBytes },
        { name: base + '.json', data: jsonBytes }
      ]), base + '.zip');
      status(`✓ ZIP saved with 4 files — ${conv.messages.length} messages.`);
    } catch (error) {
      console.error(PREFIX, error);
      status(error.message || 'Export failed. Check the console.', true);
    } finally {
      Object.values(buttons).forEach(b => { b.disabled = false; });
    }
  }

  for (const [key, button] of Object.entries(buttons)) button.addEventListener('click', () => run(key));
  console.log(PREFIX, 'v3 ready — MD / PDF / PRINT / HTML / ZIP.');
})();
