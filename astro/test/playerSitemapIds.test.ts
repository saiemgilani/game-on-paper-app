import { beforeEach, describe, expect, test, vi } from 'vitest';

// retrievePlayerSitemapIds: the seasoned id source behind the player sitemaps.
// The Data API pages with limit/offset and answers `next: null` even when more
// rows exist, so a full page must be followed by another read; NFL rows key on
// gsis and must map through nfl.players to the ESPN id the pages use.
const seen: URL[] = [];
let rowsFor: (u: URL) => unknown[] | Response;

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = new URL(String(url));
        if (u.pathname.endsWith('/meta')) return new Response('{}', { status: 500 });
        seen.push(u);
        const r = rowsFor(u);
        return r instanceof Response ? r : new Response(JSON.stringify({ count: r.length, data: r, next: null }), { status: 200 });
    },
}));

const { retrievePlayerSitemapIds } = await import('../src/resources/sdv');
const table = (u: URL) => u.pathname.split('/').at(-1);
/** `n` rows of `make(i)`, served `limit`/`offset` at a time like the API */
const paged = (u: URL, n: number, make: (i: number) => object) => {
    const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
    return Array.from({ length: Math.max(0, Math.min(limit, n - offset)) }, (_, i) => make(offset + i));
};

beforeEach(() => { seen.length = 0; });

describe('retrievePlayerSitemapIds', () => {
    test('reads past a full page, dedupes the three tables, and sorts ids numerically', async () => {
        rowsFor = (u) => table(u) === 'receiving'
            ? paged(u, 10_001, (i) => ({ player_id: 1_000_000 + i }))
            : [{ player_id: 1_000_000 }, { player_id: 99 }, { player_id: null }];
        const ids = (await retrievePlayerSitemapIds('cfb', [2019])).get(2019)!;
        expect(ids).toHaveLength(10_002);
        expect(ids.slice(0, 2)).toEqual(['99', '1000000']);
        const receiving = seen.filter((u) => table(u) === 'receiving');
        expect(receiving.map((u) => u.searchParams.get('offset'))).toEqual(['0', '10000']);
        for (const u of seen) {
            expect(u.pathname).toMatch(/^\/v1\/cfb\/(passing|rushing|receiving)$/);
            expect(Object.fromEntries(u.searchParams)).toMatchObject({ season: '2019', select: 'player_id', order: 'player_id', limit: '10000' });
        }
    });

    test('NFL maps gsis to ESPN ids and drops a player the crosswalk has no ESPN id for', async () => {
        rowsFor = (u) => table(u) === 'players'
            ? [{ gsis_id: '00-0031381', espn_id: '16800' }, { gsis_id: '00-0000001', espn_id: null }]
            : [{ player_id: '00-0031381' }, { player_id: '00-0000001' }, { player_id: '00-9999999' }];
        const ids = await retrievePlayerSitemapIds('nfl', [2018]);
        expect(ids.get(2018)).toEqual(['16800']);
        const xwalk = seen.filter((u) => table(u) === 'players');
        expect(xwalk).toHaveLength(1);
        expect(xwalk[0].pathname).toBe('/v1/nfl/players');
        expect(xwalk[0].searchParams.get('select')).toBe('gsis_id,espn_id');
    });

    test('a season with no rows is left out; a failed read throws instead of truncating', async () => {
        rowsFor = () => [];
        expect([...(await retrievePlayerSitemapIds('cfb', [2005])).keys()]).toEqual([]);
        rowsFor = (u) => table(u) === 'rushing' ? new Response('down', { status: 502 }) : [{ player_id: 1 }];
        await expect(retrievePlayerSitemapIds('cfb', [2006])).rejects.toThrow();
    });
});
