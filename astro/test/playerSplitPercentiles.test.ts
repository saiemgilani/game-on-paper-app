import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// `retrievePlayerSplitPercentiles` against the REAL body sdv-db's
// `/v1/cfb/players/splits/percentiles?season=2025` returns (captured 2026-10-18,
// trimmed to three rows; see fixtures/README.md). Pins the request (path, season,
// the min-plays floor the tooltip states) and the split -> metric -> breaks mapping,
// and that a season with no qualifying split (the route's 404) is no distribution.
const body = readFileSync(new URL('./fixtures/player-splits-percentiles-cfb-2025.json', import.meta.url)).toString();
const seen: string[] = [];
let respond: () => Response = () => new Response(body, { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (String(url).endsWith('/v1/meta')) return new Response('{}', { status: 200 });
        seen.push(String(url)); return respond();
    },
}));
vi.mock('cloudflare:workers', () => {
    const kv = {
        get: async () => null,
        getWithMetadata: async () => ({ value: null, metadata: null }),
        put: async () => {},
        delete: async () => {},
    };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

beforeEach(() => {
    seen.length = 0;
    respond = () => new Response(body, { status: 200 });
});

describe('retrievePlayerSplitPercentiles', () => {
    test('maps the rows to split -> metric -> 101 breaks', async () => {
        const sdv = await import('../src/resources/sdv');
        const out = await sdv.retrievePlayerSplitPercentiles(2025, 'cfb');
        expect(seen).toHaveLength(1);
        const u = new URL(seen[0]);
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/players/splits/percentiles');
        expect(u.searchParams.get('season')).toBe('2025');
        expect(u.searchParams.get('min_plays')).toBe(String(sdv.SPLIT_PERCENTILE_MIN_PLAYS));

        const fx = JSON.parse(body);
        expect(Object.keys(out).sort()).toEqual(['all', 'red_zone']);
        expect(Object.keys(out.all).sort()).toEqual(['epa_per_play', 'success_rate']);
        expect(Object.keys(out.red_zone)).toEqual(['epa_per_play']);
        for (const row of fx.data) {
            expect(out[row.split][row.metric]).toHaveLength(101);
            expect(out[row.split][row.metric]).toEqual(row.breaks);
        }
        // a split the route omitted (overtime) is simply absent -> unshaded
        expect(out.overtime).toBeUndefined();
    });

    test('a 404 (no split qualifies that season) is no distribution, not an error', async () => {
        respond = () => new Response(JSON.stringify({ detail: 'no cfb split with >= 30 player-seasons' }), { status: 404 });
        const sdv = await import('../src/resources/sdv');
        expect(await sdv.retrievePlayerSplitPercentiles(1990, 'cfb')).toEqual({});
    });
});
