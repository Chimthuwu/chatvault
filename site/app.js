// ChatVault web app — all conversions happen locally; only /api/resolve touches the network.
import {
  toConversation, parseImport, renderMarkdown, renderHtml, platformForHost,
  downloadBlob, messageToText, roleLabel, slugify, openPrintWindow
} from './core.js';
import { makeZip, makePdf, blobBytes } from './archive.js';
import { beautifyMarkdown, buildIntelligenceReport, buildEditorialPrompt, detectInputType } from './beautify.js';

const $ = id => document.getElementById(id);
const state = { conversation: null, beautified: null, mode: 'url' };

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

  // Open synchronously from the click handler so popup blockers allow it.
  const popup = window.open(target.href, '_blank');
  if (!popup) {
    setStatus('Your browser blocked the share tab. Allow pop-ups for ChatVault, then try again.', true);
    return;
  }

  const token = globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : 'cv-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  let timeout = null;
  const cleanup = () => {
    if (timeout !== null) window.clearTimeout(timeout);
    window.removeEventListener('message', onMessage);
    state.browserResolver = null;
  };
  const onMessage = event => {
    if (event.origin !== window.location.origin) return;
    const result = event.data;
    if (!result || result.type !== 'chatvault:browser-extract-result' || result.token !== token) return;
    if (!result.success || !result.conversation || !Array.isArray(result.conversation.messages) || !result.conversation.messages.length) {
      cleanup();
      setStatus(result.error || 'The userscript could not read messages from that share page.', true);
      showResolverFallback(true);
      return;
    }
    cleanup();
    try { popup.close(); } catch { /* The browser may have detached the tab. */ }
    loadConversation(result.conversation);
    showResolverFallback(false);
    setStatus('✓ ' + result.conversation.messages.length + ' messages returned as ChatVault JSON from the browser tab.');
  };

  window.addEventListener('message', onMessage);
  state.browserResolver = { token: token, popup: popup };
  setStatus('Waiting for the ChatVault userscript to read the share page and return JSON…');
  timeout = window.setTimeout(() => {
    cleanup();
    setStatus('No JSON came back. Check that the updated ChatVault userscript is installed and that the share page finished loading.', true);
    showResolverFallback(true);
  }, 60000);
  window.postMessage({
    type: 'chatvault:browser-extract-request', token: token, url: target.href
  }, window.location.origin);
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
    setStatus(`✓ ${conv.messages.length} messages extracted from ${conv.metadata?.platform || 'import'}. Choose a download below.`);
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

function loadConversation(conv) {
  state.conversation = conv;
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
    state.beautified = { source, beautified, report, prompt, style, conv };

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
      { name: 'editorial-prompt.md', data: result.prompt }
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
$('copy-beautified').addEventListener('click', async () => {
  if (!state.beautified) return setBeautifyStatus('Beautify a document first.', true);
  try {
    await navigator.clipboard.writeText(state.beautified.beautified);
    setBeautifyStatus('✓ Beautified Markdown copied.');
  } catch { setBeautifyStatus('Clipboard blocked — use the download instead.', true); }
});
