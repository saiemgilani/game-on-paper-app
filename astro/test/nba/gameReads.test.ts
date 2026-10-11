import { describe, expect, test, vi } from 'vitest';

const urls: string[] = [];
const inits: Record<string, any> = {};
const puts: string[] = [];
let envelope: any = { data: [{ game_id: 1 }], next: null };
const PROCESSOR = { plays: [{}], teamInfo: { home: { id: '1' }, away: { id: '2' } }, header: { competitions: [{ status: { type: { completed: false } } }] } };

vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        const u = String(url);
        urls.push(u);
        inits[u] = init;
        if (u.endsWith('/v1/meta')) return new Response(JSON.stringify({ datasets: { 'nba.play_wp': '2026-10-11T04:00:00Z' } }), { status: 200 });
        if (u.startsWith('http://python:5000/')) return new Response(JSON.stringify(PROCESSOR), { status: 200 });
        return new Response(JSON.stringify(envelope), { status: 200 });
    } }));
vi.mock('cloudflare:workers', () => {
    const kv = { get: async () => null, getWithMetadata: async () => ({ value: null }), put: async (k: string) => { puts.push(k); }, delete: async () => {} };
    return { env: new Proxy({}, { get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? kv : undefined) }) };
});

const sha256 = async (text: string) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
// every put except the shared /v1/meta stamp read
const dataPuts = () => puts.filter((k) => k !== 'sdv-meta:datasets');

describe('retrieveRowsFrom with the nba-games source', () => {
    test('hits /v1/nba/<table> and keys the cache on the nba.<table> stamp', async () => {
        puts.length = 0;
        const { retrieveRowsFrom } = await import('../../src/resources/sdv');
        const { NBA_GAMES_SOURCE } = await import('../../src/utils/league');
        const rows = await retrieveRowsFrom(NBA_GAMES_SOURCE, 'play_wp', { game_id: '401766458' }, 60, true);
        expect(rows).toEqual([{ game_id: 1 }]);
        expect(urls.some((u) => u.startsWith('https://data.sportsdataverse.org/v1/nba/play_wp?game_id=401766458'))).toBe(true);
        // namespace + endpoint + query, then the /v1/meta stamp for `nba.play_wp`, hashed
        expect(dataPuts()).toEqual([await sha256('nba-games/play_wp?game_id=401766458#2026-10-11T04:00:00Z')]);
    });
    test('the league form still builds the historical keys (cfb unnamespaced, nba/ namespaced)', async () => {
        puts.length = 0;
        const { retrieveRows } = await import('../../src/resources/sdv');
        await retrieveRows('cfb', 'team_summaries', { season: '2026' }, 60);
        await retrieveRows('nba', 'shots', { season: '2026' }, 60);
        expect(urls.some((u) => u.startsWith('https://data.sportsdataverse.org/v1/cfb/team_summaries?season=2026'))).toBe(true);
        // no stamp for these tables in /v1/meta: the key is the hash of the bare namespaced/unnamespaced path
        expect(dataPuts()).toEqual([await sha256('team_summaries?season=2026'), await sha256('nba/shots?season=2026')]);
    });
    test('the generic-route envelope ({count,data,schema_name,table}, no next) is one complete page', async () => {
        const { retrieveRowsFrom } = await import('../../src/resources/sdv');
        const { NBA_GAMES_SOURCE } = await import('../../src/utils/league');
        envelope = { count: 2, data: [{ a: 1 }, { a: 2 }], schema_name: 'nba', table: 'game_team_rates' };
        urls.length = 0;
        try {
            await expect(retrieveRowsFrom(NBA_GAMES_SOURCE, 'game_team_rates', { game_id: '1' }, 60, true)).resolves.toEqual([{ a: 1 }, { a: 2 }]);
            expect(urls.filter((u) => u.includes('/game_team_rates'))).toHaveLength(1);
        } finally {
            envelope = { data: [{ game_id: 1 }], next: null };
        }
    });
});

describe('retrieveNbaGameRows', () => {
    test('reads the seven tables for one game with narrowed selects', async () => {
        urls.length = 0;
        const { retrieveNbaGameRows } = await import('../../src/resources/nbaGames');
        const rows = await retrieveNbaGameRows('401766458');
        expect(Object.keys(rows).sort()).toEqual(['game_player_rates', 'game_team_rates', 'pbp', 'play_wp', 'player_box', 'schedule', 'team_box']);
        const nba = urls.filter((u) => u.includes('/v1/nba/'));
        expect(nba).toHaveLength(7);
        expect(nba.find((u) => u.includes('/pbp?'))).toContain('order=game_play_number');
        expect(nba.find((u) => u.includes('/schedule?'))).toContain('id=401766458');
        expect(nba.every((u) => u.includes('select='))).toBe(true);
    });
});

describe('requestProcessor cache key', () => {
    test('a path without a query keeps football keys byte-identical', async () => {
        const { requestProcessor, retrieveProcessedGame } = await import('../../src/resources/python');
        await requestProcessor('cfb/401520150/process', 60);
        const url = 'http://python:5000/cfb/401520150/process';
        expect(urls).toContain(url);
        expect(inits[url].cf.cacheKey).toBe('http://python:5000/cfb/401520150/process?v=dev');
        // and processPlays, which now goes through it, builds the same one
        urls.length = 0;
        await retrieveProcessedGame('401520151', 60, 'cfb');
        expect(inits['http://python:5000/cfb/401520151/process'].cf.cacheKey).toBe('http://python:5000/cfb/401520151/process?v=dev');
    });
    test('a path with a query puts it after the version, never a second ?', async () => {
        const { requestProcessor, retrieveProcessedGame } = await import('../../src/resources/python');
        await requestProcessor('nba/401766458/process', 60, 'source=espn');
        const url = 'http://python:5000/nba/401766458/process?source=espn';
        expect(urls).toContain(url);
        expect(inits[url].cf.cacheKey).toBe('http://python:5000/nba/401766458/process?v=dev&source=espn');
        await retrieveProcessedGame('401520152', 60, 'cfb', 'sports 247');
        expect(inits['http://python:5000/cfb/401520152/process?source=sports%20247'].cf.cacheKey)
            .toBe('http://python:5000/cfb/401520152/process?v=dev&source=sports%20247');
    });
    test('retrieveNbaProcessedGame fetches nba/<id>/process', async () => {
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        await expect(retrieveNbaProcessedGame('401766458', 60)).resolves.toMatchObject({ plays: [{}] });
    });
});
