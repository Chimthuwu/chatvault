// URL allowlist + SSRF hardening. Only public share URLs of supported platforms are fetchable.
import { PLATFORMS } from '../../site/core.js';

const MAX_INPUT = 2048;

export class UrlError extends Error {
  constructor(message) { super(message); this.name = 'UrlError'; this.status = 400; }
}

export function validateShareUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new UrlError('Paste a public share URL first.');
  const raw = input.trim();
  if (raw.length > MAX_INPUT) throw new UrlError('That URL is too long.');
  let url;
  try { url = new URL(raw); }
  catch { throw new UrlError('That is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new UrlError('Only https:// share links are accepted.');
  if (url.username || url.password) throw new UrlError('URLs with credentials are not accepted.');
  if (url.port && url.port !== '443') throw new UrlError('Only the default HTTPS port is accepted.');

  const hostname = url.hostname.toLowerCase();
  if (/\/(c|conversation)\//.test(url.pathname)) {
    throw new UrlError('Private /c/ conversation links are not supported. Open your own chat in the browser and use the userscript, or paste a JSON export.');
  }
  const platform = PLATFORMS.find(p => p.hosts.some(h => hostname === h || hostname.endsWith('.' + h)));
  if (!platform) throw new UrlError(`Unsupported host. Supported: ${PLATFORMS.map(p => p.label).join(', ')}.`);
  if (!platform.share.test(url.pathname)) {
    throw new UrlError(`That ${platform.label} URL is not a recognized public share link. Only public shares can be fetched.`);
  }

  const id = url.pathname.split('/').filter(Boolean).slice(-1)[0] || '';
  if (!/^[A-Za-z0-9_-]{4,256}$/.test(id)) throw new UrlError('Share identifier looks invalid.');

  return {
    platform,
    url: new URL(`https://${platform.hosts[0]}${url.pathname.replace(/\/+$/, '')}`)
  };
}

export function safeRedirect(location, original) {
  if (!location) throw new UrlError('Redirect without a destination.');
  let next;
  try { next = new URL(location, original); }
  catch { throw new UrlError('Invalid redirect destination.'); }
  if (next.protocol !== 'https:' || next.hostname !== original.hostname ||
      !next.pathname.startsWith('/share/')) {
    throw new UrlError('Blocked an unsafe redirect away from the public share page.');
  }
  return next;
}
