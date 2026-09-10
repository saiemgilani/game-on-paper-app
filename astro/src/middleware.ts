import { defineMiddleware } from 'astro:middleware';
import { getSecret } from 'astro:env/server';
import {
  createCollector, gopStorage, sendToIngest, clientIp, type GopCollector,
} from './utils/telemetry';
import { checkBasicAuth } from './resources/admin';
import {
  PREVIEW_COOKIE, PREVIEW_LINK_PARAM, PREVIEW_PATH_PREFIX, previewSetCookie,
  readCookie, verifyPreviewCookie, verifyPreviewLink,
} from './utils/preview';
import { ADMIN_COOKIE, verifyAdminCookie } from './utils/adminSession';
import { legacyCfbTarget, staleRedirectTarget } from './utils/legacyCfb';
import { FLAGS, isFeatureEnabled } from './utils/features';

const GAME_ID_RE = /\/game\/(\d+)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Preview magic link: ?preview_key=<signed token> on any URL sets the
  // preview cookie and lands on the uncacheable /preview surface (the clean
  // URL is publicly cached, and a cache HIT never runs this middleware). One
  // click on any browser, no admin login. An invalid/expired token strips the
  // param and redirects to the PUBLIC path (no badge is the signal).
  // The redirect carries Set-Cookie, so it must never enter Workers Caching --
  // and this block runs FIRST, before the legacy /cfb redirects, because those
  // return 301s that forward the query string with no cache headers: a keyed
  // legacy URL would otherwise cache a redirect carrying the key (review on
  // #213). The key is stripped here in one hop no matter the URL shape.
  const linkToken = url.searchParams.get(PREVIEW_LINK_PARAM);
  if (linkToken !== null) {
    const clean = new URL(url);
    clean.searchParams.delete(PREVIEW_LINK_PARAM);
    // resolve legacy shapes now: /preview/* rewrites straight to routes, so a
    // legacy path would 404 inside the preview surface
    const cleanPath = legacyCfbTarget(clean.pathname) ?? staleRedirectTarget(clean.pathname) ?? clean.pathname;
    const secret = getSecret('ADMIN_PASS');
    const valid = !!secret && await verifyPreviewLink(linkToken, secret);
    // A valid link lands on the /preview/ surface, NOT the clean URL: the
    // clean URL is publicly cached, and a Workers Caching HIT never runs this
    // middleware -- the cookie would be ignored and the viewer would see the
    // public copy (exactly the reported bug). /preview/* is never cached.
    const headers = new Headers({
      Location: (valid ? PREVIEW_PATH_PREFIX : '') + cleanPath + clean.search,
      'Cache-Control': 'no-store',
    });
    if (valid && secret) {
      headers.append('Set-Cookie', await previewSetCookie(secret));
    }
    try { (context as any).cache?.set(false); } catch { /* cache provider absent in dev */ }
    return new Response(null, { status: 302, headers });
  }

  // The preview surface: /preview/<path> renders <path> with preview features
  // on, and is NEVER cached (path-based, like /admin -- see the guard below).
  // Cookie required: without one the viewer is bounced to the public path.
  // Cookie-based preview on normal URLs still works where the Worker runs
  // (cache misses, no-store pages); this surface is the one place it is
  // GUARANTEED to run, which is why the magic link and the badge live here.
  let previewRewrite: string | undefined;
  if (url.pathname === PREVIEW_PATH_PREFIX || url.pathname.startsWith(PREVIEW_PATH_PREFIX + '/')) {
    const rest = url.pathname.slice(PREVIEW_PATH_PREFIX.length) || '/';
    const target = legacyCfbTarget(rest) ?? staleRedirectTarget(rest) ?? rest;
    // Never rewrite into /admin: the admin auth gate below checks the ORIGINAL
    // pathname, so a rewrite would carry a view-only preview cookie past it
    // (Sourcery on #217). Nested /preview is not a route either; both bounce
    // out to be handled -- and authenticated -- as themselves.
    if (target.startsWith('/admin') || target.startsWith(PREVIEW_PATH_PREFIX)) {
      return context.redirect(target + url.search, 302);
    }
    const cookieOk = await verifyPreviewCookie(
      readCookie(context.request.headers.get('cookie'), PREVIEW_COOKIE), getSecret('ADMIN_PASS'));
    if (!cookieOk) {
      return context.redirect(target + url.search, 302);
    }
    context.locals.preview = true;
    previewRewrite = target + url.search;
  }


  // Legacy /cfb/* URLs, handled before routing so every historical link lands.
  // These were pointed at /index by the redirects map, which is not a route.
  const legacy = legacyCfbTarget(url.pathname);
  if (legacy) {
    return context.redirect(legacy + url.search, 301);
  }

  // Browsers cached the OLD broken 301s permanently, so they still resolve
  // /cfb/ to /index and /cfb/game/<id> to /game/<id>/index.html without ever
  // asking us again. Those targets have to work or those visitors stay 404'd.
  const stale = staleRedirectTarget(url.pathname);
  if (stale) {
    return context.redirect(stale + url.search, 301);
  }

  // Admin preview mode: a valid signed cookie renders 'preview'-state features
  // (utils/features.ts) on public pages. Verified once here; pages read
  // locals.preview. The response is then forced uncacheable below -- a preview
  // variant in Workers Caching would be served to everyone.
  const previewCookie = readCookie(context.request.headers.get('cookie'), PREVIEW_COOKIE);
  if (previewCookie) {
    context.locals.preview = await verifyPreviewCookie(previewCookie, getSecret('ADMIN_PASS'));
  }

  // The NFL surface is a 'preview' feature (utils/features.ts). The explicit
  // pages/nfl/** tree is reached only by a viewer holding the preview cookie --
  // via /preview/nfl/... (previewRewrite) or the cookie on the public URL, which
  // withPreviewCacheGuard keeps out of Workers Caching. Everyone else gets the
  // site's 404, cacheable like any other. An access gate on a namespace, the
  // same job the /admin block does below -- not a route rewrite: the URL and
  // the page file stay one-to-one.
  const effectivePath = previewRewrite ? new URL(previewRewrite, url).pathname : url.pathname;
  if ((effectivePath === '/nfl' || effectivePath.startsWith('/nfl/')) && !isFeatureEnabled('nfl', context.locals)) {
    previewRewrite = '/404';
  }

  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
    // Two ways in: the signed session cookie a browser gets from /admin/login,
    // or basic auth for scripted callers (the purge workflow curls with -u,
    // which sends its Authorization header proactively -- no 401 challenge
    // needed, so the browser popup is gone for good).
    const open = url.pathname === '/admin/login' || url.pathname === '/admin/api/login';
    const cookieOk = await verifyAdminCookie(
      readCookie(context.request.headers.get('cookie'), ADMIN_COOKIE), getSecret('ADMIN_PASS'));
    const basicOk = checkBasicAuth(context.request.headers.get('authorization'),
      getSecret('ADMIN_USER'), getSecret('ADMIN_PASS'));
    if (!open && !cookieOk && !basicOk) {
      if (url.pathname.startsWith('/admin/api/')) {
        return Response.json({ ok: false, error: 'auth required' },
          { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      return context.redirect('/admin/login', 302);
    }
    if (cookieOk || basicOk) {
      context.locals.adminAuthed = true;
      // vetted here, where auth is actually verified: the audit log must not
      // trust a raw Authorization header a cookie-authed caller could forge
      let actor = 'admin-cookie';
      if (basicOk) {
        try { actor = atob((context.request.headers.get('authorization') ?? '').slice(6)).split(':')[0] || 'basic'; } catch { actor = 'basic'; }
      }
      context.locals.adminActor = actor;
    }
  }

  const key = getSecret('GOP_INGEST_KEY') ?? '';
  const enabled = (getSecret('TELEMETRY_ENABLED') ?? '1') !== '0' && !!key;
  if (!enabled || url.pathname.startsWith('/api/client-log')) {
    return withPreviewCacheGuard(context, await next(previewRewrite as any));
  }

  const collector = createCollector();
  collector.game_id = (url.pathname.match(GAME_ID_RE) || [])[1] ?? null;
  const t0 = Date.now();
  let response: Response;
  try {
    response = await gopStorage.run(collector, () => next(previewRewrite as any));
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
  return withPreviewCacheGuard(context, response);
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

// A previewing admin's render must never enter Workers Caching. set(false)
// alone emits no header (heuristic 2h cache -- see 311d80e); no-store is the
// explicit opt-out, and cache.set(false) after render wins over any options
// the page itself accumulated.
export function withPreviewCacheGuard(context: any, response: Response): Response {
  const url = new URL(context.request.url);
  const isAdmin = url.pathname.startsWith('/admin');
  // A ?span= URL renders two different pages while game-page-v2 is in preview:
  // v2 windows the boxes to the span, classic drops it and shows the full game.
  // Cloudflare keys the cache on the URL and does not vary on the preview
  // cookie, so the PUBLIC (classic) copy would be served to a previewing admin
  // -- who would silently get the un-windowed page they were trying to check.
  // Scoped to the preview state: once the flag is 'on' the span means the same
  // thing to everyone and these URLs become cacheable again.
  const spanVariesByViewer = url.searchParams.has('span') && FLAGS['game-page-v2'] === 'preview';
  // Preview renders are per-viewer; /admin responses are authenticated. Either
  // way a cached copy would be served to the wrong audience on a HIT -- and a
  // HIT never runs the Worker, so the auth check would be skipped entirely.
  // A ?preview_key= URL must never produce a cacheable response under any
  // path: the redeem intercepts these before render, but if that ever
  // regresses, this keeps a keyed URL out of Workers Caching entirely.
  const carriesPreviewKey = url.searchParams.has(PREVIEW_LINK_PARAM);
  const isPreviewPath = url.pathname === PREVIEW_PATH_PREFIX || url.pathname.startsWith(PREVIEW_PATH_PREFIX + '/');
  if (context.locals?.preview === true || isAdmin || spanVariesByViewer || carriesPreviewKey || isPreviewPath) {
    try { context.cache?.set(false); } catch { /* cache provider absent in dev */ }
    response.headers.set('Cache-Control', 'no-store');
    if (isPreviewPath) response.headers.set('X-Robots-Tag', 'noindex');
  }
  return response;
}
