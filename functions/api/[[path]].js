// Pages mirror: forward API traffic to the canonical Worker.
// The static app (HTML/CSS/JS) is served by Pages itself.
const ORIGIN = 'https://chatvault.nyan-anonymous-d45.workers.dev';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = ORIGIN + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const method = request.method.toUpperCase();
  const response = await fetch(new Request(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  }));
  // CORS from the Worker is permissive; keep the response otherwise untouched.
  return response;
}
