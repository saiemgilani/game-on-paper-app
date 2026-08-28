import { defineMiddleware } from 'astro:middleware';
import { getSecret } from 'astro:env/server';
import {
  createCollector, gopStorage, sendToIngest, clientIp, type GopCollector,
} from './utils/telemetry';
import { checkBasicAuth } from './resources/admin';

const GAME_ID_RE = /\/game\/(\d+)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    const ok = checkBasicAuth(context.request.headers.get('authorization'),
      getSecret('ADMIN_USER'), getSecret('ADMIN_PASS'));
    if (!ok) {
      return new Response('auth required', {
        status: 401, headers: { 'WWW-Authenticate': 'Basic realm="gop-admin"' } });
    }
  }

  const key = getSecret('GOP_INGEST_KEY') ?? '';
  const enabled = (getSecret('TELEMETRY_ENABLED') ?? '1') !== '0' && !!key;
  if (!enabled || url.pathname.startsWith('/api/client-log')) return next();

  const collector = createCollector();
  collector.game_id = (url.pathname.match(GAME_ID_RE) || [])[1] ?? null;
  const t0 = Date.now();
  let response: Response;
  try {
    response = await gopStorage.run(collector, () => next());
  } catch (err) {
    collector.render_outcome = 'failed';
    collector.events.push({ table: 'error_log', row: {
      service: 'astro', level: 'error',
      message: String((err as Error)?.message ?? err).slice(0, 500),
      stack: String((err as Error)?.stack ?? '').slice(0, 4000),
      path: url.pathname.slice(0, 300), game_id: collector.game_id, context: null } });
    emit(context, collector, url, null, 500, t0, key);
    throw err;
  }
  emit(context, collector, url, response, response.status, t0, key);
  return response;
});

function emit(context: any, c: GopCollector, url: URL, res: Response | null, status: number, t0: number, key: string) {
  try {
    // skip static asset noise; page/API/upstream signal only
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/_astro/')) return;
    const h = context.request.headers;
    c.events.push({ table: 'request_log', row: {
      service: 'astro',
      method: context.request.method,
      path: url.pathname.slice(0, 300),
      route_pattern: (context.routePattern as string | undefined) ?? url.pathname.slice(0, 300),
      status,
      duration_ms: Date.now() - t0,
      ip: clientIp(h, safeClientAddress(context)),
      ua: (h.get('user-agent') ?? '').slice(0, 400),
      referrer: (h.get('referer') ?? '').slice(0, 400) || null,
      game_id: c.game_id,
      // content-length is absent on streamed SSR responses; null then, by design
      bytes_out: parseIntOrNull(res?.headers.get('content-length')),
      // what the app *asked* the CDN to do. An edge HIT never reaches the
      // Worker at all, so a true hit/miss verdict is not observable here --
      // this records caching intent, which is the actionable half.
      cache_status: c.cache_status ?? res?.headers.get('cache-control')?.slice(0, 80) ?? null,
      render_outcome: c.render_outcome,
      missing_datasets: c.missing_datasets,
    } });
    const pythonBase = getSecret('PYTHON_HTTP_URL') || 'http://python:5000';
    const p = sendToIngest(c.events, { url: `${pythonBase}/gop/ingest`, key });
    // Workers: keep the isolate alive for the POST; node dev: fire-and-forget.
    // NOTE: locals.runtime.ctx THROWS in @astrojs/cloudflare v14 (removed API);
    // the execution context now lives at locals.cfContext.
    (context.locals as any)?.cfContext?.waitUntil?.(p);
  } catch {
    /* fail-open */
  }
}

function parseIntOrNull(v: string | null | undefined): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : null;
}

function safeClientAddress(context: any): string | null {
  try { return context.clientAddress ?? null; } catch { return null; }
}
