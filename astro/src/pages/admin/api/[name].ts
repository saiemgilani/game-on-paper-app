import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';

export const prerender = false;

const ALLOWED = ['overview', 'games', 'upstream', 'errors', 'traffic', 'system', 'page'];

export const GET: APIRoute = async ({ params, url }) => {
  const name = params.name ?? '';
  if (!ALLOWED.includes(name)) return new Response('not found', { status: 404 });
  const py = getSecret('PYTHON_HTTP_URL') || 'http://python:5000';
  try {
    const r = await fetch(`${py}/gop/admin/${name}${url.search}`, {
      headers: { 'X-GOP-Key': getSecret('GOP_INGEST_KEY') ?? '' },
      signal: AbortSignal.timeout(10000),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ error: 'python unreachable' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
