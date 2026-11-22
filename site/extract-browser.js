// Browser-side extraction adapters.
// ChatGPT uses its structured backend response (the path that produced the first successful export).
// Every other platform uses layered DOM selectors with a generic heuristic fallback.
// ESM for the web app; the userscript build strips imports/exports and inlines this file.
import { normalizeMessages, toConversation, messageToText } from './core.js';

export const DOM_PLATFORMS = [
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

export function detectPagePlatform() {
  const host = (typeof location !== 'undefined' ? location.hostname : '').toLowerCase();
  return DOM_PLATFORMS.find(p => p.hosts.some(h => host === h || host.endsWith('.' + h))) ||
    { id: 'generic', label: 'Chat', selectors: ['article', '[role="article"]', '[data-testid*="message"]'] };
}

export function nodeToMarkdown(node) {
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

export function extractFromDOM(root = document, platform = detectPagePlatform()) {
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

export function getChatRoute() {
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

export async function fetchChatBackend(route) {
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

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function findConversationObject(root) {
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

export function getRawMessages(conversation) {
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

export function getMessageText(message) {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!isObject(content)) return '';
  if (typeof content.text === 'string') return content.text;
  const parts = content.parts || content.content || [];
  return Array.isArray(parts) ? parts.map(renderPart).filter(Boolean).join('\n\n') : '';
}

export function normalizeChatMessages(rawMessages) {
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

export async function collectCurrentConversation() {
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
