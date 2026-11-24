// ChatVault core — shared, dependency-free conversation model + exporters.
// Used by the web app, the Worker API, the Hermes skill CLI and the userscript.
// No DOM and no network access in this file.

export const PLATFORMS = [
  { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], share: /^\/share\/[^/]+/, structured: true },
  { id: 'claude', label: 'Claude', hosts: ['claude.ai'], share: /^\/share\/[^/]+/, structured: false },
  { id: 'gemini', label: 'Gemini', hosts: ['gemini.google.com', 'g.co'], share: /^\/(gemini\/)?share\/[^/]+/, structured: false },
  { id: 'grok', label: 'Grok', hosts: ['grok.com', 'x.com'], share: /^\/grok\/share\//, structured: false },
  { id: 'deepseek', label: 'DeepSeek', hosts: ['chat.deepseek.com'], share: /^\/s\//, structured: false },
  { id: 'perplexity', label: 'Perplexity', hosts: ['www.perplexity.ai', 'perplexity.ai'], share: /^\/search\//, structured: false },
  { id: 'copilot', label: 'Copilot', hosts: ['copilot.microsoft.com', 'bing.com'], share: /\/chat\//, structured: false }
];

export function platformForHost(hostname = '') {
  const host = String(hostname).toLowerCase().replace(/^www\./, '');
  return PLATFORMS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h))) || null;
}

export function slugify(value, max = 90) {
  return String(value || '')
    .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, max) || 'conversation';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

export function contentToText(block) {
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

export function messageToText(message) {
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

export function normalizeMessages(raw) {
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

export function toConversation({ id = 'conversation', title = 'Conversation', source = '', messages = [], platform = 'generic', method = 'import', warnings = [] }) {
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


/**
 * Normalize ChatGPT continuation suffixes for safe same-title grouping.
 * Only a trailing numeric copy suffix is removed; unrelated title differences remain.
 */
export function normalizeConversationTitle(title = '') {
  return String(title || '')
    .normalize('NFKC')
    .replace(/\s+\(\d+\)\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function continuationTitlesMatch(a, b) {
  const left = normalizeConversationTitle(a);
  const right = normalizeConversationTitle(b);
  return !!left && left === right;
}

/**
 * Detect ChatGPT's explicit "Continued from [title](.../c/<id>)" marker.
 * Returns a parent reference only for a valid ChatGPT conversation URL.
 */
export function extractContinuationReference(messages = []) {
  const opening = (messages || []).slice(0, 5).map(messageToText).join('\n');
  const match = opening.match(/Continued\s+from\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/i)
    || opening.match(/Continued\s+from\s+(https?:\/\/\S+)/i);
  if (!match) return null;
  const urlText = match[2] || match[1];
  let url;
  try { url = new URL(urlText); } catch { return null; }
  if (url.protocol !== 'https:' ||
      (!/(^|\.)chatgpt\.com$/.test(url.hostname) && url.hostname !== 'chat.openai.com')) return null;
  const parentId = url.pathname.match(/\/c\/([A-Za-z0-9_-]+)/)?.[1];
  if (!parentId) return null;
  return {
    parentId,
    parentTitle: match[2] ? match[1].trim() : 'Previous conversation',
    parentUrl: url.href
  };
}

function timeLine(message) {
  if (!message.timestamp) return '';
  const t = typeof message.timestamp === 'number'
    ? new Date(message.timestamp > 1e12 ? message.timestamp : message.timestamp * 1000).toISOString()
    : String(message.timestamp);
  return `<time>${t}</time>\n\n`;
}

export function roleLabel(role) {
  return { user: 'You', assistant: 'Assistant', system: 'System', tool: 'Tool' }[role] || role;
}

export function renderMarkdown(conv) {
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

export function renderHtml(conv, { print = false } = {}) {
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
export function parseImport(text, source = 'local import') {
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

export function validateConversation(value) {
  return !!(value && typeof value === 'object' && Array.isArray(value.messages) && value.messages.length <= 20000 &&
    value.messages.every(m => m && typeof m === 'object' && Array.isArray(m.content)));
}

export function downloadBlob(blob, filename) {
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

export function openPrintWindow(html) {
  if (typeof window === 'undefined') throw new Error('openPrintWindow requires a browser');
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Popup blocked. Allow popups for this site and try again.');
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  return popup;
}
