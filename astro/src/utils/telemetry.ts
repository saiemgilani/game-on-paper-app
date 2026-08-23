// GOP telemetry (Astro side): per-request event collector + ingest emitter.
// FAIL-OPEN: nothing here may throw into a render path. PURE module — no
// astro:* imports (vitest runs it directly); config values are arguments.
// AsyncLocalStorage works in node dev and on Workers (nodejs_compat flag,
// already set in astro/wrangler.jsonc).
import { AsyncLocalStorage } from 'node:async_hooks';

export type GopEvent = {
  table: 'request_log' | 'upstream_log' | 'error_log' | 'client_event';
  row: Record<string, unknown>;
};

export type GopCollector = {
  game_id: string | null;
  render_outcome: 'ok' | 'degraded' | 'failed' | null;
  missing_datasets: string[] | null;
  cache_status: string | null;
  events: GopEvent[];
};

export const gopStorage = new AsyncLocalStorage<GopCollector>();

export function createCollector(): GopCollector {
  return { game_id: null, render_outcome: null, missing_datasets: null, cache_status: null, events: [] };
}

export function classifyTarget(url: string, pythonBase?: string, summaryBase?: string): string {
  if (!url) return 'other';
  if (url.includes('cdn.espn.com') && url.includes('playbyplay')) return 'espn_pbp';
  if (url.includes('espn.com') && url.includes('scoreboard')) return 'espn_scoreboard';
  if (url.includes('sports.core.api.espn.com')) return 'espn_team';
  if (url.includes('espn.com') && url.includes('/teams/') && url.includes('schedule')) return 'espn_team_schedule';
  if (url.includes('espn.com')) return 'espn_schedule';
  if (pythonBase && url.startsWith(pythonBase)) return 'flask_process';
  if (/\/cfb\/\d+\/process\b/.test(url)) return 'flask_process';
  if (summaryBase && url.startsWith(summaryBase)) return 'summary';
  return 'other';
}

export type IngestConfig = { url: string; key: string };

export async function sendToIngest(events: GopEvent[], cfg: IngestConfig): Promise<void> {
  if (!events.length || !cfg.url || !cfg.key) return;
  try {
    await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GOP-Key': cfg.key },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* fail-open: telemetry loss is acceptable, page impact is not */
  }
}

export type TimedFetchExtra = { game_id?: string | null; pythonBase?: string; summaryBase?: string };

export async function wrappedFetch(url: string, init?: RequestInit): Promise<Response> {
    const start = Date.now();
    const resp = await timedFetch(url, init)
    console.info(`[request] ${init?.method || "GET"} ${url} - time: ${Date.now() - start} ms`)
    return resp;
}

export async function timedFetch(url: string, init?: RequestInit, extra: TimedFetchExtra = {}): Promise<Response> {
  const c = gopStorage.getStore();
  const t0 = Date.now();
  const gameId = extra.game_id ?? (url.match(/gameId=(\d+)/) || [])[1] ?? (url.match(/\/cfb\/(\d+)\/process\b/) || [])[1] ?? null;
  const target = () => classifyTarget(url, extra.pythonBase, extra.summaryBase);
  try {
    const resp = await fetch(url, init);
    c?.events.push({ table: 'upstream_log', row: {
      service: 'astro', target: target(), status: resp.status,
      duration_ms: Date.now() - t0, ok: resp.ok, game_id: gameId, error: null } });
    return resp;
  } catch (err) {
    c?.events.push({ table: 'upstream_log', row: {
      service: 'astro', target: target(), status: null,
      duration_ms: Date.now() - t0, ok: false, game_id: gameId,
      error: String((err as Error)?.message ?? err).slice(0, 500) } });
    throw err;
  }
}

export type ClientEventBody = { type?: string; name?: unknown; value?: unknown; path?: unknown; game_id?: unknown };

export function validateClientEvent(body: ClientEventBody, ua: string, ip: string | null): GopEvent | null {
  if (body?.type !== 'js_error' && body?.type !== 'web_vital') return null;
  const gameId = body.game_id ? String(body.game_id).slice(0, 20) : null;
  const path = String(body.path ?? '').slice(0, 300);
  if (body.type === 'js_error') {
    return { table: 'error_log', row: {
      service: 'client', level: 'error', message: String(body.name ?? '').slice(0, 500),
      stack: String(body.value ?? '').slice(0, 4000), path, game_id: gameId, context: null } };
  }
  const value = Number(body.value);
  return { table: 'client_event', row: {
    type: body.type, name: String(body.name ?? '').slice(0, 40),
    value: Number.isFinite(value) ? value : null, path, game_id: gameId,
    ua: ua.slice(0, 400), ip } };
}

const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/;
function validIp(v: string | null): string | null {
  return v && IP_RE.test(v) ? v : null;
}

export function clientIp(headers: Headers, fallback?: string | null): string | null {
  return validIp(headers.get('cf-connecting-ip')) || validIp(headers.get('x-real-ip')) || validIp(fallback ?? null);
}
