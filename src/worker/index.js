// ChatVault Worker — small, predictable API. No storage, no credentials, no content logging.
import { PLATFORMS, renderMarkdown, renderHtml, validateConversation } from '../../site/core.js';
import { validateShareUrl, safeRedirect, UrlError } from './security.js';
import { extractConversation, ExtractError } from './extract.js';

const MAX_BODY = 4 * 1024 * 1024;
const MAX_HTML = 8 * 1024 * 1024;
const RATE_LIMIT = 20; // per minute, per isolate/IP — best effort

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  hits.set(ip, entry);
  if (hits.size > 5000) hits.clear();
  return entry.count > RATE_LIMIT;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}
function text(body, name, type) {
  return new Response(body, {
    headers: {
      ...CORS,
      'Content-Type': `${type}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store'
    }
  });
}

async function readBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY) throw new UrlError('Request is too large.');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) throw new UrlError('Request is too large.');
  try { return JSON.parse(raw); }
  catch { throw new UrlError('Request body must be valid JSON.'); }
}

async function fetchSharePage(url) {
  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'ChatVault/3.0 (+public share exporter)'
    }
  });
  if (response.status >= 300 && response.status < 400) {
    safeRedirect(response.headers.get('Location'), url);
    throw new ExtractError('The share link redirected. Resolve the canonical public URL first.');
  }
  if (response.status === 404 || response.status === 410) throw new ExtractError('That share is unavailable or was deleted.');
  if (response.status === 403 || response.status === 429) throw new ExtractError('The platform blocked this server-side request. Use the browser userscript or paste a JSON export.');
  if (!response.ok) throw new ExtractError(`Share retrieval failed: HTTP ${response.status}.`);
  const type = response.headers.get('Content-Type') || '';
  if (!/text\/html|application\/xhtml/.test(type)) throw new ExtractError('Unexpected content type from the share page.');
  const declared = Number(response.headers.get('Content-Length') || 0);
  if (declared > MAX_HTML) throw new ExtractError('Share page exceeds the 8 MB size limit.');
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > MAX_HTML) throw new ExtractError('Share page exceeds the 8 MB size limit.');
  return html;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (url.pathname.startsWith('/api/') && rateLimited(ip)) {
      return json({ success: false, error: 'Rate limit reached. Try again in a minute.' }, 429);
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ success: true, service: 'ChatVault', version: '3.0.0' });
      }
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({
          success: true,
          platforms: PLATFORMS.map(({ id, label, hosts }) => ({ id, label, hosts })),
          limits: { maxBodyBytes: MAX_BODY, maxShareBytes: MAX_HTML, requestsPerMinute: RATE_LIMIT },
          formats: ['markdown', 'html', 'json', 'pdf', 'zip']
        });
      }
      if (url.pathname === '/api/resolve' && request.method === 'POST') {
        const body = await readBody(request);
        const { platform, url: canonical } = validateShareUrl(body.url);
        const html = await fetchSharePage(canonical);
        const conversation = extractConversation(html, canonical.toString(), platform.id);
        return json({ success: true, conversation, warnings: conversation.metadata.warnings });
      }
      const exportMatch = url.pathname.match(/^\/api\/export\/(markdown|html|json)$/);
      if (exportMatch && request.method === 'POST') {
        const body = await readBody(request);
        const conv = body.conversation;
        if (!validateConversation(conv)) throw new UrlError('Invalid conversation object.');
        const base = (conv.title || 'chatvault-export').replace(/[<>:"\/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '-').slice(0, 80);
        if (exportMatch[1] === 'markdown') return text(renderMarkdown(conv), `${base}.md`, 'text/markdown');
        if (exportMatch[1] === 'html') return text(renderHtml(conv), `${base}.html`, 'text/html');
        return text(JSON.stringify(conv, null, 2), `${base}.json`, 'application/json');
      }
      return json({ success: false, error: 'Not found' }, 404);
    } catch (error) {
      const status = error instanceof UrlError || error instanceof ExtractError ? error.status : 500;
      return json({
        success: false,
        error: status === 500 ? 'Internal error while processing that request.' : error.message
      }, status);
    }
  }
};
