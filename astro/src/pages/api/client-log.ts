import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { clientIp, sendToIngest, validateClientEvent } from '../../lib/telemetry';

export const prerender = false;

// Per-isolate token bucket: 60 events/min/ip. Imperfect on Workers (memory is
// per-isolate) — acceptable; the whole path is fail-open.
const buckets = new Map<string, { n: number; t0: number }>();

export const POST: APIRoute = async (context) => {
  try {
    if (buckets.size > 10000) buckets.clear();
    const ip = clientIp(context.request.headers, safeAddr(context)) ?? 'unknown';
    const now = Date.now();
    const b = buckets.get(ip) ?? { n: 0, t0: now };
    if (now - b.t0 > 60000) { b.n = 0; b.t0 = now; }
    b.n++;
    buckets.set(ip, b);
    if (b.n > 60) return json({ ok: false }, 429);

    const body = await context.request.json().catch(() => null);
    const event = validateClientEvent(body ?? {}, context.request.headers.get('user-agent') ?? '',
      ip === 'unknown' ? null : ip);
    if (!event) return json({ ok: false }, 400);

    const key = getSecret('GOP_INGEST_KEY') ?? '';
    const pythonBase = getSecret('PYTHON_HTTP_URL') || 'http://python:7000';
    const p = sendToIngest([event], { url: `${pythonBase}/gop/ingest`, key });
    (context.locals as any)?.runtime?.ctx?.waitUntil?.(p);
    return json({ ok: true }, 200);
  } catch {
    return json({ ok: true }, 200); // fail-open even here
  }
};

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeAddr(context: any): string | null {
  try { return context.clientAddress ?? null; } catch { return null; }
}
