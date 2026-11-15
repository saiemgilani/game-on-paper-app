import { beforeEach, describe, expect, test, vi } from 'vitest';

// The Team Stats game-set panel's season read ('game-set-filter'): one season-keyed
// team_opponent_splits URL shared by every team page of the season, and null (never a
// short field) on any failure. Every request goes through the mocked wrappedFetch.
const seen: string[] = [];
const puts: { key: string; ttl: number | undefined }[] = [];
let respond: () => Response = () => new Response(JSON.stringify({ data: [{ team_id: 333 }], next: null }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    // no `datasets` in /v1/meta keeps the read on its unversioned key
    wrappedFetch: async (url: string) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url));
        return respond();
    },
}));
vi.mock('cloudflare:workers', () => {
    const kv = {
        get: async () => null,
        getWithMetadata: async () => ({ value: null, metadata: null }),
        put: async (key: string, _value: string, opts?: { expirationTtl?: number }) => { puts.push({ key, ttl: opts?.expirationTtl }); },
        delete: async () => {},
    };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

beforeEach(() => {
    seen.length = 0;
    puts.length = 0;
    respond = () => new Response(JSON.stringify({ data: [{ team_id: 333 }], next: null }), { status: 200 });
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ team_id: i }));

describe('retrieveSeasonOpponentSplits', () => {
    test('one season-wide URL (no team filter), the panel columns, limit 5000, a three-day KV entry', async () => {
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrieveSeasonOpponentSplits(2025, 'cfb')).toEqual([{ team_id: 333 }]);
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/team_opponent_splits');
        expect([...u.searchParams.keys()].sort()).toEqual(['limit', 'season', 'select']);
        expect(u.searchParams.get('season')).toBe('2025');
        expect(u.searchParams.get('limit')).toBe('5000');
        expect(decodeURIComponent(u.searchParams.get('select')!).split(',')).toEqual(sdv.SEASON_SPLIT_COLUMNS);
        expect(puts.map((p) => p.ttl)).toEqual([60 * 60 * 24 * 3]);
    });

    test('a page with `next` is truncated: null', async () => {
        respond = () => new Response(JSON.stringify({ data: rows(10), next: 'cursor' }), { status: 200 });
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrieveSeasonOpponentSplits(2025, 'cfb')).toBeNull();
    });

    test('a full page is truncated too (the API leaves `next` null on a page cut short by `limit`): null', async () => {
        respond = () => new Response(JSON.stringify({ data: rows(5000), next: null }), { status: 200 });
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrieveSeasonOpponentSplits(2025, 'cfb')).toBeNull();
        // one row short of the limit is a whole season
        respond = () => new Response(JSON.stringify({ data: rows(4999), next: null }), { status: 200 });
        expect(await sdv.retrieveSeasonOpponentSplits(2024, 'cfb')).toHaveLength(4999);
    });

    test('an error status or a body without a data array: null, and nothing is cached', async () => {
        const sdv = await import('../src/resources/sdv');
        respond = () => new Response('boom', { status: 500 });
        expect(await sdv.retrieveSeasonOpponentSplits(2025, 'nfl')).toBeNull();
        respond = () => new Response(JSON.stringify({ error: 'x' }), { status: 200 });
        expect(await sdv.retrieveSeasonOpponentSplits(2025, 'nfl')).toBeNull();
        expect(puts).toEqual([]);
    });
});
