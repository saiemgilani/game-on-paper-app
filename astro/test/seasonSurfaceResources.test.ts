import { beforeEach, describe, expect, test, vi } from 'vitest';

// The request contract of the season-surface reads: endpoint per league, the
// filters, the select (one unknown column is a 400), strictness.
const seen: { url: string }[] = [];
let respond: () => Response = () => new Response(JSON.stringify({ data: [{ ok: 1 }] }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => { seen.push({ url: String(url) }); return respond(); },
}));

beforeEach(() => {
    seen.length = 0;
    respond = () => new Response(JSON.stringify({ data: [{ ok: 1 }] }), { status: 200 });
});

// requestSDV also reads `GET /v1/meta` (the ingest stamp in the cache key); it is
// not the table request these tests are about.
const only = () => {
    const table = seen.filter((s) => !s.url.endsWith('/v1/meta'));
    expect(table).toHaveLength(1);
    return new URL(table[0].url);
};
const select = (u: URL) => decodeURIComponent(u.searchParams.get('select') ?? '').split(',');

describe('retrieveRankedRows', () => {
    test('ranked rows only, ordered by the first metric rank, exactly the listed columns', async () => {
        const sdv = await import('../src/resources/sdv');
        const rows = await sdv.retrieveRankedRows({ table: 'passing', season: 2024, metrics: ['EPAplay', 'success'],
            idColumns: ['player_id', 'passer_player_name', 'team_id', 'pos_team'], league: 'cfb' });
        expect(rows).toEqual([{ ok: 1 }]);
        const u = only();
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/passing');
        expect(u.searchParams.get('season')).toBe('2024');
        expect(u.searchParams.get('EPAplay_rank__gte')).toBe('1');
        expect(u.searchParams.get('order')).toBe('EPAplay_rank');
        expect(u.searchParams.get('limit')).toBe('2000');
        expect(select(u).toSorted()).toEqual(['EPAplay', 'EPAplay_rank', 'passer_player_name', 'player_id', 'pos_team', 'season', 'success', 'success_rank', 'team_id']);
    });

    test('a 200 without a data array is a failed read, not an empty list', async () => {
        respond = () => new Response(JSON.stringify({ error: 'upstream' }), { status: 200 });
        const sdv = await import('../src/resources/sdv');
        await expect(sdv.retrieveRankedRows({ table: 'passing', season: 2024, metrics: ['EPAplay'], idColumns: ['player_id'], league: 'cfb' })).rejects.toThrow(/no data array/);
    });

    test('a page the API cut short is a failed read, not a short list', async () => {
        respond = () => new Response(JSON.stringify({ data: [{ ok: 1 }], count: 2001, next: 'https://data.sportsdataverse.org/v1/cfb/receiving?offset=2000' }), { status: 200 });
        const sdv = await import('../src/resources/sdv');
        await expect(sdv.retrieveRankedRows({ table: 'receiving', season: 2030, metrics: ['EPAplay'], idColumns: ['player_id'], league: 'cfb' })).rejects.toThrow(/more than 2000 ranked rows/);
    });

    test('a failed read throws, so the page can mark the section failed', async () => {
        respond = () => new Response('nope', { status: 500 });
        const sdv = await import('../src/resources/sdv');
        await expect(sdv.retrieveRankedRows({ table: 'passing', season: 2024, metrics: ['EPAplay'], idColumns: ['player_id'], league: 'cfb' })).rejects.toThrow();
    });
});
