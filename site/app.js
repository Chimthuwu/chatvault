// ChatVault web app — all conversions happen locally; only /api/resolve touches the network.
import {
  toConversation, parseImport, renderMarkdown, renderHtml, platformForHost,
  downloadBlob, messageToText, roleLabel, slugify, openPrintWindow, extractContinuationReference, continuationTitlesMatch
} from './core.js';
import { makeZip, makePdf, blobBytes } from './archive.js';
import { beautifyMarkdown, buildIntelligenceReport, buildEditorialPrompt, buildAgentHandoff, detectInputType } from './beautify.js';

const $ = id => document.getElementById(id);
const state = { conversation: null, beautified: null, mode: 'url', browserResolver: null, autoBeautify: false };

function setStatus(message, error = false) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('error', error);
}
function setBusy(busy) {
  $('extract-btn').disabled = busy;
  $('extract-btn').textContent = busy ? 'Working…' : 'Extract conversation';
}
function showResolverFallback(show) {
  $('resolver-fallback').classList.toggle('hidden', !show);
}

function relayBrowserResult(result) {
  if (!result || !state.browserResolver || result.token !== state.browserResolver.token) return;
  const resolver = state.browserResolver;
  if (resolver.timeout) window.clearTimeout(resolver.timeout);
  state.browserResolver = null;
  try { sessionStorage.removeItem('chatvault:chain:' + result.token); } catch {}
  if (resolver.chain) {
    handleContinuationParentResult(result, resolver.chain);
    return;
  }
  if (!result.success || !result.conversation || !Array.isArray(result.conversation.messages) || !result.conversation.messages.length) {
    setStatus(result.error || 'The userscript could not read messages from that share page.', true);
    showResolverFallback(true);
    return;
  }
  loadConversation(result.conversation);
  showResolverFallback(false);
  if (!extractContinuationReference(result.conversation.messages)) {
    setStatus('✓ ' + result.conversation.messages.length + ' messages returned to ChatVault in the same tab.');
    if (state.autoBeautify) void autoBeautifyImportedConversation();
  } else {
    resolveContinuationAncestors(result.conversation);
  }
}
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || !event.data) return;
  if (event.data.type === 'chatvault:browser-extract-result') relayBrowserResult(event.data);
  if (event.data.type === 'chatvault:browser-extract-started' &&
      state.browserResolver && event.data.token === state.browserResolver.token) {
    setStatus('Opening the ChatGPT page in this tab. ChatVault will return automatically after extraction…');
    window.location.assign(state.browserResolver.targetUrl);
  }
});
const returnedToken = new URLSearchParams(location.hash.slice(1)).get('cv-return');
if (returnedToken) {
  let chain = null;
  try { chain = JSON.parse(sessionStorage.getItem('chatvault:chain:' + returnedToken) || 'null'); } catch {}
  state.browserResolver = { token: returnedToken, chain };
}
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ['url', 'json', 'text'].forEach(m => $('panel-' + m).classList.toggle('hidden', m !== mode));
  $('resolver-fallback').classList.add('hidden');
  setStatus('Ready when you are ✦');
}
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

function parseTranscript(text) {
  const raw = [];
  let role = null, buffer = [];
  const flush = () => {
    const content = buffer.join('\n').trim();
    if (role && content) raw.push({ role, content });
    buffer = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(You|User|Human|Assistant|Model|AI|Bot)\s*:\s*(.*)$/i);
    if (match) {
      flush();
      role = /^(you|user|human)$/i.test(match[1]) ? 'user' : 'assistant';
      buffer = [match[2]];
    } else buffer.push(line);
  }
  flush();
  if (!raw.length && text.trim()) raw.push({ role: 'user', content: text.trim() });
  return toConversation({
    title: 'Pasted transcript', source: 'local paste', messages: raw,
    platform: 'transcript', method: 'transcript parser'
  });
}

function requestBrowserExtraction(url, chain = null) {
  if (state.browserResolver) return false;
  const token = globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'cv-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const returnUrl = location.origin + location.pathname + location.search + '#cv-return=' + encodeURIComponent(token);
  if (chain) {
    try { sessionStorage.setItem('chatvault:chain:' + token, JSON.stringify(chain)); }
    catch {
      setStatus('Could not preserve the continuation import while navigating. The original conversation is safe; retry the import.', true);
      return false;
    }
  }
  state.browserResolver = {
    token, targetUrl: url, chain,
    timeout: window.setTimeout(() => {
      if (state.browserResolver?.token !== token) return;
      state.browserResolver = null;
      try { sessionStorage.removeItem('chatvault:chain:' + token); } catch {}
      if (chain) {
        finishContinuationFlow(chain, 'Automatic retrieval timed out. The imported conversation is safe; its missing parent remains available to retry.');
      } else {
        setStatus('The browser handoff timed out. Check that the updated userscript is installed and try again.', true);
        showResolverFallback(true);
      }
    }, 120000)
  };
  setStatus(chain ? 'Automatically retrieving the previous conversation…' : 'Preparing same-tab browser extraction…');
  window.postMessage({ type: 'chatvault:browser-extract-request', token, url, returnUrl }, window.location.origin);
  return true;
}

function archiveEntryForConversationId(id) {
  return readArchive().find(entry => String(entry.conversation?.id) === String(id)) || null;
}

function resolveContinuationAncestors(conversation, flow = null) {
  const currentId = String(conversation.id || '');
  const currentEntry = archiveEntryForConversationId(currentId);
  if (currentEntry?.detachedFromParent) {
    if (flow) finishContinuationFlow(flow);
    return;
  }
  const reference = extractContinuationReference(conversation.messages);
  if (!reference) {
    if (flow) finishContinuationFlow(flow);
    return;
  }
  const nextFlow = flow || {
    fetchedIds: [currentId],
    visitedIds: [currentId],
    expectedParentId: null
  };
  if (nextFlow.visitedIds.includes(reference.parentId)) {
    finishContinuationFlow(nextFlow, 'A circular continuation reference was detected. No duplicate conversation was added.');
    return;
  }
  if (nextFlow.visitedIds.length >= 25) {
    finishContinuationFlow(nextFlow, 'The continuation chain reached the 25-conversation safety limit.');
    return;
  }
  nextFlow.visitedIds.push(reference.parentId);
  const existing = archiveEntryForConversationId(reference.parentId);
  if (existing) {
    if (!nextFlow.fetchedIds.includes(String(existing.conversation.id))) nextFlow.fetchedIds.push(String(existing.conversation.id));
    resolveContinuationAncestors(existing.conversation, nextFlow);
    return;
  }
  nextFlow.expectedParentId = reference.parentId;
  if (!requestBrowserExtraction(reference.parentUrl, nextFlow)) {
    finishContinuationFlow(nextFlow, 'Could not start automatic retrieval of the previous conversation.');
  }
}

function handleContinuationParentResult(result, flow) {
  if (!result.success || !result.conversation || !Array.isArray(result.conversation.messages) || !result.conversation.messages.length) {
    finishContinuationFlow(flow, result.error || 'The previous conversation could not be retrieved. The current conversation has been preserved.');
    return;
  }
  const parent = result.conversation;
  const expected = String(flow.expectedParentId || '');
  const sourceId = (() => {
    try { return new URL(parent.source).pathname.match(/\/c\/([A-Za-z0-9_-]+)/)?.[1] || ''; } catch { return ''; }
  })();
  if (expected && String(parent.id) !== expected && sourceId !== expected) {
    finishContinuationFlow(flow, 'ChatGPT returned a different conversation than the continuation link requested. It was not attached.');
    return;
  }
  saveToArchive(parent);
  const parentId = String(parent.id || expected);
  if (!flow.fetchedIds.includes(parentId)) flow.fetchedIds.push(parentId);
  resolveContinuationAncestors(parent, flow);
}

function finishContinuationFlow(flow, warning = '') {
  const entries = readArchive();
  const conversations = (flow.fetchedIds || [])
    .map(id => entries.find(entry => String(entry.conversation?.id) === String(id))?.conversation)
    .filter(Boolean)
    .reverse();
  renderArchive();
  const automatic = conversations.length > 1 &&
    conversations.every((conversation, index) => index === 0 ||
      continuationTitlesMatch(conversations[index - 1].title, conversation.title));
  if (automatic) {
    const root = conversations[0];
    const combined = toConversation({
      id: 'chain-' + String(root.id),
      title: root.title,
      source: 'ChatVault automatically assembled continuation chain',
      messages: conversations.flatMap(conversation => conversation.messages || []),
      platform: root.metadata?.platform || 'chatgpt',
      method: 'Automatic continuation assembly',
      warnings: warning ? [warning] : []
    });
    loadConversation(combined, { save: false });
    setStatus(warning
      ? 'Retrieved the matching continuation history, but one earlier link needs attention: ' + warning
      : '✓ Automatically attached ' + (conversations.length - 1) + ' matching continuation(s). ' + combined.messages.length + ' messages are ready to export.');
  } else if (conversations.length > 1) {
    setStatus('✓ Retrieved ' + (conversations.length - 1) + ' previous conversation(s). Differently titled chats remain separate and linked in your Local Library.' + (warning ? ' ' + warning : ''));
  } else if (warning) {
    setStatus(warning, true);
  }
  if (state.autoBeautify) void autoBeautifyImportedConversation();
}

function startBrowserExtraction() {
  if (state.browserResolver) return;
  const raw = $('url-input').value.trim();
  let target;
  let platform;
  try {
    target = new URL(raw);
    if (target.protocol !== 'https:' || target.username || target.password ||
        (target.port && target.port !== '443')) {
      throw new Error('Use a public HTTPS share URL without credentials or a custom port.');
    }
    platform = platformForHost(target.hostname);
    const shareId = target.pathname.split('/').filter(Boolean).pop() || '';
    if (!platform || !platform.share.test(target.pathname) ||
        !/^[A-Za-z0-9_-]{4,256}$/.test(shareId)) {
      throw new Error('That is not a supported public share URL. Check the link and try again.');
    }
  } catch (error) {
    setStatus(error.message || 'Invalid share URL.', true);
    return;
  }

  requestBrowserExtraction(target.href);
}
async function extract() {
  if (state.mode === 'url') {
    startBrowserExtraction();
    return;
  }
  setBusy(true);
  try {
    let conv;
    if (state.mode === 'url') {
      const input = $('url-input').value.trim();
      if (!input) throw new Error('Paste a public share URL first.');
      setStatus('Fetching the public share page…');
      const response = await fetch('/api/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
      conv = data.conversation;
    } else if (state.mode === 'json') {
      const input = $('json-input').value.trim();
      if (!input) throw new Error('Paste a JSON conversation export first.');
      setStatus('Reading JSON locally…');
      conv = parseImport(input, 'local JSON import');
    } else {
      const input = $('text-input').value.trim();
      if (!input) throw new Error('Paste a transcript first.');
      setStatus('Parsing transcript locally…');
      conv = parseTranscript(input);
    }
    if (!conv?.messages?.length) throw new Error('No messages were found in that input.');
    loadConversation(conv);
    resolveContinuationAncestors(conv);
    if (!extractContinuationReference(conv.messages)) setStatus(`✓ ${conv.messages.length} messages extracted from ${conv.metadata?.platform || 'import'}. Choose a download below.`);
  } catch (error) {
    const message = error.message || 'Extraction failed.';
    const blocked = /platform blocked this server-side request|HTTP 403|HTTP 429/i.test(message);
    showResolverFallback(blocked);
    setStatus(blocked
      ? 'The platform refused server-side access. Use the browser extraction button to return JSON directly from the share tab.'
      : message, true);
  } finally {
    setBusy(false);
  }
}


const ARCHIVE_KEY = 'chatvault.archive.v1';
function readArchive() {
  try {
    const value = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && item.conversation?.messages) : [];
  } catch { return []; }
}
function archiveIdentity(conv) {
  const platform = conv.metadata?.platform || 'generic';
  const id = conv.id && !['conversation', 'current-page'].includes(conv.id)
    ? String(conv.id)
    : (conv.source || conv.exportedAt || conv.title);
  return platform + ':' + id;
}
function saveToArchive(conv) {
  const entries = readArchive();
  const key = archiveIdentity(conv);
  const existing = entries.findIndex(item => item.key === key);
  const entry = {
    key,
    importedAt: new Date().toISOString(),
    conversation: conv,
    continuation: extractContinuationReference(conv.messages)
  };
  if (existing >= 0) entries[existing] = { ...entries[existing], ...entry, importedAt: entries[existing].importedAt };
  else entries.unshift(entry);
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries.slice(0, 500)));
    renderArchive();
    return true;
  } catch (error) {
    console.warn('[ChatVault] Could not persist local archive:', error);
    return false;
  }
}
function renderArchive() {
  const root = $('archive-list');
  if (!root) return;
  const entries = readArchive();
  if (!entries.length) {
    root.innerHTML = '<p class="archive-empty">Imported conversations will appear here. Matching continuations are retrieved and attached automatically.</p>';
    return;
  }
  const byId = new Map(entries.map(entry => [String(entry.conversation.id), entry]));
  const children = new Map();
  for (const entry of entries) {
    const parentId = entry.continuation?.parentId;
    if (parentId && !entry.detachedFromParent) {
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(entry);
    }
  }
  const roots = entries.filter(entry => entry.detachedFromParent || !entry.continuation ||
    !byId.has(String(entry.continuation.parentId)));
  const rendered = new Set();
  const sameTitleDescendants = entry => {
    const found = [];
    const visited = new Set([entry.key]);
    const walk = parent => {
      for (const child of children.get(String(parent.conversation.id)) || []) {
        if (visited.has(child.key) || !continuationTitlesMatch(parent.conversation.title, child.conversation.title)) continue;
        visited.add(child.key);
        found.push(child);
        walk(child);
      }
    };
    walk(entry);
    return found;
  };
  const makeNode = (entry, depth = 0) => {
    if (rendered.has(entry.key)) return '';
    rendered.add(entry.key);
    const conv = entry.conversation;
    const title = escapeArchiveText(conv.title || 'Untitled conversation');
    const attached = sameTitleDescendants(entry);
    attached.forEach(child => rendered.add(child.key));
    const totalMessages = [entry, ...attached].reduce((sum, item) => sum + Number(item.conversation.messages?.length || 0), 0);
    const distinctChildren = [entry, ...attached].flatMap(parent =>
      (children.get(String(parent.conversation.id)) || [])
        .filter(child => !continuationTitlesMatch(parent.conversation.title, child.conversation.title))
    );
    const missing = entry.continuation && !entry.detachedFromParent && !byId.has(String(entry.continuation.parentId));
    const marker = missing
      ? '<span class="archive-state missing">PARENT NOT RETRIEVED</span>'
      : attached.length
        ? '<span class="archive-state linked">AUTO-ATTACHED</span>'
        : depth > 0
          ? '<span class="archive-state separate">DIFFERENT TITLE</span>'
          : '';
    const detachControls = attached.map(child =>
      '<button class="archive-detach" type="button" data-detach-continuation="' + escapeArchiveText(child.key) + '">Detach ' +
      escapeArchiveText(child.conversation.title || 'continuation') + '</button>'
    ).join('') + (entry.continuation && !entry.detachedFromParent
      ? '<button class="archive-detach" type="button" data-detach-continuation="' + escapeArchiveText(entry.key) + '">Unlink from previous chat</button>'
      : '');
    return '<div class="archive-node" style="--depth:' + Math.min(depth, 8) + '">' +
      '<div class="archive-node-main"><span class="archive-branch" aria-hidden="true">↳</span><div class="archive-node-copy"><strong>' + title +
      '</strong><small>' + totalMessages + ' messages · ' + escapeArchiveText(conv.metadata?.platform || 'import') +
      (attached.length ? ' · ' + (attached.length + 1) + ' parts automatically attached' : '') + '</small></div>' + marker + '</div>' +
      '<button class="archive-export" type="button" data-chain-root="' + escapeArchiveText(entry.key) + '">Export conversation ↓</button>' +
      detachControls +
      (missing ? '<a class="archive-parent-link" href="' + escapeArchiveText(entry.continuation.parentUrl) + '" target="_blank" rel="noopener noreferrer">Retry previous conversation ↗</a>' : '') +
      distinctChildren.map(child => makeNode(child, depth + 1)).join('') + '</div>';
  };
  let markup = roots.map(entry => makeNode(entry)).join('');
  for (const entry of entries) if (!rendered.has(entry.key)) markup += makeNode(entry);
  root.innerHTML = markup;
}
function escapeArchiveText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function loadConversation(conv, { save = true } = {}) {
  state.conversation = conv;
  const saved = save ? saveToArchive(conv) : true;
  const parent = extractContinuationReference(conv.messages);
  if (parent) setStatus((saved ? '✓ Saved to your local archive. ' : '') + 'Continuation detected: this chat continues “' + parent.parentTitle + '”.');
  $('preview').classList.remove('hidden');
  $('exports').classList.remove('hidden');
  $('preview-title').textContent = conv.title || 'Conversation';
  $('preview-meta').textContent = `${conv.messages.length} messages · ${conv.metadata?.platform || 'import'}`;
  $('preview-messages').replaceChildren(...conv.messages.slice(0, 8).map(message => {
    const row = document.createElement('div');
    row.className = 'preview-msg ' + (message.role === 'user' ? 'user' : '');
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = roleLabel(message.role);
    const snippet = document.createElement('div');
    snippet.className = 'snippet';
    snippet.textContent = messageToText(message);
    row.append(role, snippet);
    return row;
  }));
  const warnings = $('warnings');
  const list = conv.metadata?.warnings || [];
  warnings.classList.toggle('hidden', !list.length);
  warnings.textContent = list.map(w => '⚠️ ' + w).join('\n');
}

async function exportAs(format) {
  if (!state.conversation) { setStatus('Extract a conversation first.', true); return; }
  const conv = state.conversation;
  const base = slugify(conv.title);
  try {
    setStatus(`Building ${format}…`);
    const md = renderMarkdown(conv);
    if (format === 'md') return downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), base + '.md');
    if (format === 'html') return downloadBlob(new Blob([renderHtml(conv)], { type: 'text/html;charset=utf-8' }), base + '.html');
    if (format === 'json') return downloadBlob(new Blob([JSON.stringify(conv, null, 2)], { type: 'application/json' }), base + '.json');
    if (format === 'pdf') return downloadBlob(makePdf(conv), base + '.pdf');
    if (format === 'print') return openPrintWindow(renderHtml(conv, { print: true }));
    if (format === 'zip') {
      const [pdf, html, json] = await Promise.all([
        blobBytes(makePdf(conv)),
        blobBytes(new Blob([renderHtml(conv)], { type: 'text/html' })),
        blobBytes(new Blob([JSON.stringify(conv, null, 2)], { type: 'application/json' }))
      ]);
      return downloadBlob(await makeZip([
        { name: base + '.md', data: md },
        { name: base + '.pdf', data: pdf },
        { name: base + '.html', data: html },
        { name: base + '.json', data: json }
      ]), base + '.zip');
    }
    setStatus(`✓ ${format.toUpperCase()} saved. Check your downloads.`);
  } catch (error) {
    setStatus('Export failed: ' + (error.message || error), true);
  }
}


$('archive-list').addEventListener('click', event => {
  const detachButton = event.target.closest('[data-detach-continuation]');
  if (detachButton) {
    const entries = readArchive();
    const entry = entries.find(item => item.key === detachButton.dataset.detachContinuation);
    if (!entry) return;
    entry.detachedFromParent = true;
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries));
      renderArchive();
      setStatus('✓ Continuation detached. Both source conversations are preserved in your Local Library.');
    } catch (error) {
      setStatus('Could not detach this continuation: ' + (error.message || error), true);
    }
    return;
  }
  const button = event.target.closest('[data-chain-root]');
  if (!button) return;
  const entries = readArchive();
  const byId = new Map(entries.map(entry => [String(entry.conversation.id), entry]));
  const root = entries.find(entry => entry.key === button.dataset.chainRoot);
  if (!root) return;
  const ordered = [];
  const visited = new Set();
  const visit = entry => {
    if (!entry || visited.has(entry.key)) return;
    visited.add(entry.key);
    ordered.push(entry);
    const next = entries.filter(candidate => !candidate.detachedFromParent && candidate.continuation?.parentId === String(entry.conversation.id) && continuationTitlesMatch(entry.conversation.title, candidate.conversation.title))
      .sort((a, b) => a.importedAt.localeCompare(b.importedAt));
    next.forEach(visit);
  };
  visit(root);
  const messages = ordered.flatMap(entry => entry.conversation.messages || []);
  const combined = toConversation({
    id: 'chain-' + root.key,
    title: root.conversation.title || 'Conversation chain',
    source: 'ChatVault local conversation chain',
    messages,
    platform: root.conversation.metadata?.platform || 'chatgpt',
    method: 'Conversation chain archive',
    warnings: ordered.some(entry => entry.continuation && !byId.has(String(entry.continuation.parentId)))
      ? ['One or more earlier conversations in this chain have not been imported. This export contains only archived conversations.'] : []
  });
  state.conversation = combined;
  $('preview').classList.remove('hidden');
  $('exports').classList.remove('hidden');
  $('preview-title').textContent = combined.title + ' — complete chain';
  $('preview-meta').textContent = ordered.length + ' conversations · ' + messages.length + ' messages';
  $('preview-messages').replaceChildren(...messages.slice(0, 8).map(message => {
    const row = document.createElement('div');
    row.className = 'preview-msg ' + (message.role === 'user' ? 'user' : '');
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = roleLabel(message.role);
    const snippet = document.createElement('div');
    snippet.className = 'snippet';
    snippet.textContent = messageToText(message);
    row.append(role, snippet);
    return row;
  }));
  setStatus('✓ Combined ' + ordered.length + ' imported conversation(s). Choose an export format below.');
  $('preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('extract-btn').addEventListener('click', extract);
document.querySelectorAll('[data-export]').forEach(btn => btn.addEventListener('click', () => exportAs(btn.dataset.export)));
$('copy-btn').addEventListener('click', async () => {
  if (!state.conversation) return setStatus('Extract a conversation first.', true);
  try {
    await navigator.clipboard.writeText(renderMarkdown(state.conversation));
    setStatus('✓ Markdown copied to clipboard.');
  } catch { setStatus('Clipboard blocked by the browser. Use the Markdown download instead.', true); }
});
$('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') extract(); });
$('json-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    $('json-input').value = await file.text();
    setMode('json');
    setStatus(`Loaded ${file.name}. Click “Extract conversation” to import it locally.`);
  } catch {
    setStatus('Could not read that file. Try opening the JSON and pasting its contents.', true);
  }
});
$('fallback-browser').addEventListener('click', startBrowserExtraction);
$('fallback-json').addEventListener('click', () => {
  setMode('json');
  $('json-file').click();
});

// ---- Phase 2: Beautify & Archive ----
function setBeautifyStatus(message, error = false) {
  const el = $('beautify-status');
  el.textContent = message;
  el.classList.toggle('error', error);
}
function textAsConversation(text, title) {
  return toConversation({
    title, source: 'local document', messages: [{ role: 'assistant', content: text }],
    platform: 'document', method: 'document import'
  });
}
function runBeautify() {
  try {
    setBeautifyStatus('Analyzing document structure…');
    let source = $('beautify-input').value.trim();
    let conv = null;
    let meta = {};
    if (!source && state.conversation) source = renderMarkdown(state.conversation);
    if (!source) throw new Error('Paste a document above, or extract a conversation first.');

    if (detectInputType(source) === 'json') {
      conv = parseImport(source, 'local JSON import');
      source = renderMarkdown(conv);
      meta = {
        source: conv.source, exported: conv.exportedAt, messages: conv.messages.length,
        platform: conv.metadata?.platform, extraction: conv.metadata?.extractionMethod
      };
    }
    const style = $('beautify-style').value;
    setBeautifyStatus(`Applying the ${style} profile…`);
    const beautified = beautifyMarkdown(source, {
      style, metadata: meta,
      toc: $('opt-toc').checked,
      metadataHeader: $('opt-metadata').checked
    });
    const report = $('opt-report').checked ? buildIntelligenceReport(source) : '';
    const prompt = buildEditorialPrompt(source);
    const handoff = buildAgentHandoff(source);
    state.beautified = { source, beautified, report, prompt, handoff, style, conv };

    $('before-md').textContent = source;
    $('after-md').textContent = beautified;
    $('before-stats').textContent = `${source.split('\n').length} lines · ${source.length} chars`;
    $('after-stats').textContent = `${beautified.split('\n').length} lines · ${beautified.length} chars`;
    $('diff-view').classList.remove('hidden');
    setBeautifyStatus(`✓ Beautified with ${style}. Original preserved in the left pane.`);
  } catch (error) {
    setBeautifyStatus(error.message || 'Beautify failed.', true);
  }
}
async function downloadBeautifiedArchive() {
  const result = state.beautified;
  if (!result) return setBeautifyStatus('Beautify a document first.', true);
  try {
    setBeautifyStatus('Packing the archive…');
    const files = [
      { name: 'original.md', data: result.source },
      { name: result.style + '.md', data: result.beautified },
      { name: 'editorial-prompt.md', data: result.prompt },
      { name: 'agent-handoff.md', data: result.handoff }
    ];
    if (result.report) files.push({ name: 'intelligence-report.md', data: result.report });
    files.push({ name: 'beautified.pdf', data: await blobBytes(makePdf(textAsConversation(result.beautified, 'Beautified export'))) });
    if (result.conv) files.push({ name: 'source.json', data: JSON.stringify(result.conv, null, 2) });
    downloadBlob(await makeZip(files), 'chatvault-beautified.zip');
    setBeautifyStatus(`✓ Archive saved with ${files.length} files.`);
  } catch (error) {
    setBeautifyStatus('Archive failed: ' + (error.message || error), true);
  }
}
$('beautify-btn').addEventListener('click', runBeautify);
$('dl-archive').addEventListener('click', downloadBeautifiedArchive);
$('use-conversation').addEventListener('click', () => {
  if (!state.conversation) return setBeautifyStatus('Extract a conversation first.', true);
  $('beautify-input').value = renderMarkdown(state.conversation);
  setBeautifyStatus('Loaded the extracted conversation. Pick a style and hit Beautify.');
});
$('dl-beautified').addEventListener('click', () => {
  if (!state.beautified) return setBeautifyStatus('Beautify a document first.', true);
  downloadBlob(new Blob([state.beautified.beautified], { type: 'text/markdown;charset=utf-8' }), 'chatvault-beautified.md');
  setBeautifyStatus('✓ Beautified Markdown saved.');
});
$('dl-agent-handoff').addEventListener('click', () => {
  if (!state.beautified) return setBeautifyStatus('Beautify a document first.', true);
  downloadBlob(new Blob([state.beautified.handoff], { type: 'text/markdown;charset=utf-8' }), 'chatvault-agent-handoff.md');
  setBeautifyStatus('✓ Agent Handoff saved. Give this to your agent; add clean.md when it needs full context.');
});
$('copy-beautified').addEventListener('click', async () => {
  if (!state.beautified) return setBeautifyStatus('Beautify a document first.', true);
  try {
    await navigator.clipboard.writeText(state.beautified.beautified);
    setBeautifyStatus('✓ Beautified Markdown copied.');
  } catch { setBeautifyStatus('Clipboard blocked — use the download instead.', true); }
});

async function autoBeautifyImportedConversation() {
  if (!state.autoBeautify || !state.conversation) return;
  state.autoBeautify = false;
  try {
    $('beautify-input').value = renderMarkdown(state.conversation);
    $('beautify-style').value = 'report';
    $('beautify').scrollIntoView({ behavior: 'smooth', block: 'start' });
    runBeautify();
    if (!state.beautified) throw new Error('The conversation was archived, but automatic beautification did not complete.');
    await downloadBeautifiedArchive();
    if (!$('beautify-status').textContent.startsWith('✓')) {
      throw new Error($('beautify-status').textContent || 'The ZIP archive could not be created.');
    }
    setStatus('✓ Conversation imported, saved to Local Library, beautified and packaged as a ZIP.');
  } catch (error) {
    setStatus('Conversation imported and archived, but beautification needs attention: ' + (error.message || error), true);
  }
}

// Restore the user's local archive on page load.
renderArchive();

// One-click Tampermonkey handoff: ?cv-share=<public share URL>&cv-auto=1
const toolbarShareUrl = new URLSearchParams(location.search).get('cv-share');
if (toolbarShareUrl) {
  state.autoBeautify = new URLSearchParams(location.search).get('cv-auto') === '1';
  setMode('url');
  $('url-input').value = toolbarShareUrl;
  history.replaceState(null, '', location.pathname + location.hash);
  setStatus('One-click import received. Starting browser-side extraction…');
  window.setTimeout(() => extract(), 0);
}



/* First-visit setup walkthrough. Extension installation is confirmed by the user:
   browser APIs intentionally do not attempt to fingerprint installed extensions. */
const ONBOARDING_KEY = 'chatvault:onboarding:v1';
const onboarding = $('onboarding');
let onboardingStep = 0;
let onboardingPreviousFocus = null;
function browserInstallTarget() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return { name: 'Microsoft Edge', url: 'https://www.tampermonkey.net/index.php?browser=edge' };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', url: 'https://www.tampermonkey.net/index.php?browser=firefox' };
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return { name: 'Google Chrome', url: 'https://www.tampermonkey.net/index.php?browser=chrome' };
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return { name: 'Safari', url: 'https://www.tampermonkey.net/index.php?browser=safari' };
  return { name: 'your browser', url: 'https://www.tampermonkey.net/' };
}
function showOnboardingStep(step) {
  onboardingStep = Math.max(0, Math.min(3, step));
  onboarding.querySelectorAll('[data-onboarding-step]').forEach(panel => {
    panel.classList.toggle('hidden', Number(panel.dataset.onboardingStep) !== onboardingStep);
  });
  onboarding.querySelectorAll('[data-progress]').forEach(item => {
    item.classList.toggle('active', Number(item.dataset.progress) <= onboardingStep);
  });
  const activeHeading = onboarding.querySelector('[data-onboarding-step="' + onboardingStep + '"] h1, [data-onboarding-step="' + onboardingStep + '"] h2');
  if (activeHeading) onboarding.querySelector('.onboarding-body').setAttribute('aria-label', activeHeading.textContent);
}
function openOnboarding() {
  onboardingPreviousFocus = document.activeElement;
  onboarding.classList.remove('hidden');
  document.body.classList.add('onboarding-open');
  showOnboardingStep(0);
  $('onboarding-close').focus();
}
function closeOnboarding({ completed = false } = {}) {
  onboarding.classList.add('hidden');
  document.body.classList.remove('onboarding-open');
  try { localStorage.setItem(ONBOARDING_KEY, completed ? 'completed' : 'dismissed'); } catch {}
  if (onboardingPreviousFocus?.focus) onboardingPreviousFocus.focus();
}
function updateOnboardingGates() {
  onboarding.querySelectorAll('[data-requires]').forEach(button => {
    button.disabled = !$(button.dataset.requires).checked;
  });
}
const managerTarget = browserInstallTarget();
$('install-manager').href = managerTarget.url;
$('browser-install-label').textContent = managerTarget.name + ' · official extension';
$('manager-installed').addEventListener('change', updateOnboardingGates);
$('script-installed').addEventListener('change', updateOnboardingGates);
onboarding.querySelectorAll('[data-onboarding-next]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.requires && !$(button.dataset.requires).checked) return;
  showOnboardingStep(onboardingStep + 1);
}));
onboarding.querySelectorAll('[data-onboarding-back]').forEach(button => button.addEventListener('click', () => showOnboardingStep(onboardingStep - 1)));
$('skip-intro').addEventListener('click', () => showOnboardingStep(1));
$('onboarding-close').addEventListener('click', () => closeOnboarding());
$('onboarding-skip-setup').addEventListener('click', () => closeOnboarding());
$('close-onboarding').addEventListener('click', () => closeOnboarding({ completed: true }));
$('finish-onboarding').addEventListener('click', () => {
  closeOnboarding({ completed: true });
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
});
$('setup-guide').addEventListener('click', openOnboarding);
onboarding.addEventListener('click', event => {
  if (event.target.classList.contains('onboarding-backdrop')) closeOnboarding();
});
document.addEventListener('keydown', event => {
  if (onboarding.classList.contains('hidden')) return;
  if (event.key === 'Escape') { closeOnboarding(); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...onboarding.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
let onboardingChoice = null;
try { onboardingChoice = localStorage.getItem(ONBOARDING_KEY); } catch {}
const isHandoffArrival = new URLSearchParams(location.search).has('cv-share');
if (!onboardingChoice && !isHandoffArrival) window.setTimeout(openOnboarding, 350);
