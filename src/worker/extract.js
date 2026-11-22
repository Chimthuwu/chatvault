// Best-effort server-side extraction of public share pages.
// Modern ChatGPT pages carry data in React Flight / RSC streams; older ones use __NEXT_DATA__.
// Unknown formats throw a descriptive error — we never return a half-conversation as success.
import { normalizeMessages, toConversation } from '../../site/core.js';

const MAX_HTML = 8 * 1024 * 1024;
const MAX_CANDIDATES = 4000;

export class ExtractError extends Error {
  constructor(message) { super(message); this.name = 'ExtractError'; this.status = 422; }
}

export function detectPayload(html) {
  if (/self\.__next_f\s*\.push|self\.__next_f\s*=/.test(html)) return 'react-flight';
  if (html.includes('__NEXT_DATA__')) return 'legacy-next';
  if (/<script[^>]+type=["']application\/json["']/.test(html)) return 'embedded-json';
  if (/id=["']__NEXT_DATA__["']/.test(html)) return 'legacy-next';
  return 'unknown';
}

// Extract balanced {...} and [...] substrings from a string without a JSON parser dependency.
function jsonValues(text, limit = MAX_CANDIDATES) {
  const found = [];
  const stack = [];
  let start = -1, inString = false, escaped = false;
  for (let i = 0; i < text.length && found.length < limit; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') {
      if (!stack.length) start = i;
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (!stack.length) continue;
      if (stack[stack.length - 1] !== ch) { stack.length = 0; start = -1; continue; }
      stack.pop();
      if (!stack.length && start >= 0) {
        const candidate = text.slice(start, i + 1);
        if (candidate.length < 400000) {
          try { found.push(JSON.parse(candidate)); } catch { /* not JSON */ }
        }
        start = -1;
      }
    }
  }
  return found;
}

export function collectCandidates(html) {
  if (html.length > MAX_HTML) throw new ExtractError('Share page exceeds the 8 MB size limit.');
  const candidates = [];

  for (const match of html.matchAll(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { candidates.push(JSON.parse(match[1])); } catch { /* skip */ }
  }
  for (const match of html.matchAll(/self\.__next_f\s*\.push\(\s*(\[[\s\S]*?\])\s*\)/g)) {
    try {
      const record = JSON.parse(match[1]);
      for (const part of record) if (typeof part === 'string') candidates.push(...jsonValues(part, 300));
    } catch { /* skip */ }
  }
  for (const match of html.matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { candidates.push(JSON.parse(match[1])); } catch { /* skip */ }
  }
  candidates.push(...jsonValues(html, 1200));
  return candidates;
}

function looksLikeMessages(value) {
  return Array.isArray(value) && value.length > 0 && value.some(m => m && typeof m === 'object' &&
    (m.author?.role || m.role || m.sender) &&
    (m.content !== undefined || m.text !== undefined || m.parts !== undefined));
}
function looksLikeMapping(value) {
  return !!(value && typeof value === 'object' && value.mapping && typeof value.mapping === 'object' &&
    Object.values(value.mapping).some(n => n?.message));
}

function deepFind(root, predicate, depth = 0, seen = new WeakSet()) {
  if (!root || typeof root !== 'object' || depth > 10 || seen.has(root)) return null;
  seen.add(root);
  if (predicate(root)) return root;
  for (const value of Object.values(root)) {
    if (value && typeof value === 'object') {
      const hit = deepFind(value, predicate, depth + 1, seen);
      if (hit) return hit;
    }
  }
  return null;
}

function mappingToRaw(container) {
  const mapping = container.mapping;
  const current = container.current_node || container.current_node_id;
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
  if (!ordered.length) for (const node of Object.values(mapping)) if (node?.message) ordered.push(node.message);
  return ordered;
}

export function extractConversation(html, source, platformLabel = 'chatgpt') {
  const format = detectPayload(html);
  if (format === 'unknown') {
    throw new ExtractError('No supported conversation payload found. The share page may require JavaScript or be access-restricted — try the browser userscript or paste a JSON export.');
  }
  const candidates = collectCandidates(html);
  let raw = [];
  let normalized = [];
  for (const candidate of candidates) {
    if (looksLikeMapping(candidate)) raw = mappingToRaw(candidate);
    else if (looksLikeMessages(candidate)) raw = candidate;
    else {
      const found = deepFind(candidate, v => looksLikeMapping(v) || looksLikeMessages(v));
      if (found) raw = looksLikeMapping(found) ? mappingToRaw(found) : found;
    }
    normalized = normalizeMessages(raw);
    if (normalized.length) break;
  }
  const messages = normalized;
  if (!messages.length) {
    throw new ExtractError(`Payload detected (${format}) but no messages could be reconstructed. Paste a JSON export for a guaranteed local conversion.`);
  }
  let title = 'Shared conversation';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (titleMatch) title = titleMatch[1].replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim().slice(0, 200);
  const id = source.split('/').filter(Boolean).pop() || 'share';
  return toConversation({
    id, title, source, messages, platform: platformLabel,
    method: `server:${format}`,
    warnings: messages.length < raw.length ? ['Some payload records could not be normalized and were skipped.'] : []
  });
}
