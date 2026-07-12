import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  classifyTarget, clientIp, createCollector, gopStorage, sendToIngest,
  timedFetch, validateClientEvent,
} from '../src/lib/telemetry';

afterEach(() => vi.unstubAllGlobals());

describe('classifyTarget', () => {
  test('maps known upstreams', () => {
    const py = 'http://python:7000', sm = 'http://summary:3000';
    expect(classifyTarget('https://cdn.espn.com/core/college-football/playbyplay?gameId=1', py, sm)).toBe('espn_pbp');
    expect(classifyTarget('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard', py, sm)).toBe('espn_scoreboard');
    expect(classifyTarget('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams', py, sm)).toBe('espn_schedule');
    expect(classifyTarget('http://python:7000/cfb/process', py, sm)).toBe('flask_process');
    expect(classifyTarget('http://summary:3000/', py, sm)).toBe('summary');
    expect(classifyTarget('https://collegefootballdata.com', py, sm)).toBe('other');
  });
});

describe('timedFetch', () => {
  test('records ok upstream event into the ALS collector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const c = createCollector();
    await gopStorage.run(c, () =>
      timedFetch('http://python:7000/cfb/process', { method: 'POST' },
        { game_id: '401', pythonBase: 'http://python:7000' }));
    expect(c.events).toHaveLength(1);
    const row = c.events[0].row as any;
    expect(c.events[0].table).toBe('upstream_log');
    expect(row.target).toBe('flask_process');
    expect(row.ok).toBe(true);
    expect(row.game_id).toBe('401');
  });
  test('records failure event and rethrows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const c = createCollector();
    await expect(gopStorage.run(c, () => timedFetch('https://cdn.espn.com/core/college-football/playbyplay?gameId=9'))).rejects.toThrow();
    const row = c.events[0].row as any;
    expect(row.ok).toBe(false);
    expect(row.error).toContain('ECONNREFUSED');
    expect(row.game_id).toBe('9');
  });
  test('is a plain fetch when no collector is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x')));
    const resp = await timedFetch('https://example.com');
    expect(resp.status).toBe(200);
  });
});

describe('sendToIngest', () => {
  test('never rejects on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(sendToIngest([{ table: 'error_log', row: {} }], { url: 'http://x/gop/ingest', key: 'k' }))
      .resolves.toBeUndefined();
  });
  test('no-ops without events or key', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await sendToIngest([], { url: 'http://x', key: 'k' });
    await sendToIngest([{ table: 'error_log', row: {} }], { url: 'http://x', key: '' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('validateClientEvent', () => {
  test('js_error -> error_log row', () => {
    const e = validateClientEvent({ type: 'js_error', name: 'boom', value: 'stack', path: '/cfb/', game_id: '4' }, 'UA', '1.2.3.4')!;
    expect(e.table).toBe('error_log');
    expect((e.row as any).service).toBe('client');
  });
  test('web_vital -> client_event row; junk -> null', () => {
    const e = validateClientEvent({ type: 'web_vital', name: 'LCP', value: 2100, path: '/' }, 'UA', null)!;
    expect(e.table).toBe('client_event');
    expect((e.row as any).value).toBe(2100);
    expect(validateClientEvent({ type: 'nonsense' }, 'UA', null)).toBeNull();
  });
});

describe('clientIp', () => {
  test('prefers cf-connecting-ip, then x-real-ip, then fallback', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers(), '3.3.3.3')).toBe('3.3.3.3');
    expect(clientIp(new Headers())).toBeNull();
  });
  test('rejects malformed proxy-header values and falls through', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': 'nonsense injection' }))).toBeNull();
    expect(clientIp(new Headers({ 'cf-connecting-ip': 'junk value', 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});
