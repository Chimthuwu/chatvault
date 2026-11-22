// ChatVault web app — all conversions happen locally; only /api/resolve touches the network.
import {
  toConversation, parseImport, renderMarkdown, renderHtml,
  downloadBlob, messageToText, roleLabel, slugify, openPrintWindow
} from './core.js';
import { makeZip, makePdf, blobBytes } from './archive.js';

const $ = id => document.getElementById(id);
const state = { conversation: null, mode: 'url' };

function setStatus(message, error = false) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('error', error);
}
function setBusy(busy) {
  $('extract-btn').disabled = busy;
  $('extract-btn').textContent = busy ? 'Working…' : 'Extract conversation';
}
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  ['url', 'json', 'text'].forEach(m => $('panel-' + m).classList.toggle('hidden', m !== mode));
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

async function extract() {
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
    setStatus(error.message || 'Extraction failed.', true);
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
