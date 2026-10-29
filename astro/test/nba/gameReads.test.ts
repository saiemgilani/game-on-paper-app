import { afterEach, describe, expect, test, vi } from 'vitest';

const urls: string[] = [];
const inits: Record<string, any> = {};
const puts: string[] = [];
const putTtls: { k: string; ttl: number }[] = [];
// per-test override of the mocked upstream: return a Response to take over, undefined to fall through
let respond: ((u: string) => Response | undefined) | null = null;
let envelope: any = { data: [{ game_id: 1 }], next: null };
const PROCESSOR = { plays: [{}], teamInfo: { home: { id: '1' }, away: { id: '2' } }, header: { competitions: [{ status: { type: { completed: false } } }] } };

vi.mock('../../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: any) => {
        const u = String(url);
        urls.push(u);
        inits[u] = init;
        if (init?.signal?.aborted) throw init.signal.reason;
        const custom = respond?.(u);
        if (custom) return custom;
        if (u.endsWith('/v1/meta')) return new Response(JSON.stringify({ datasets: { 'nba.play_wp': '2026-10-11T04:00:00Z' } }), { status: 200 });
        if (u.startsWith('http://python:5000/')) return new Response(JSON.stringify(PROCESSOR), { status: 200 });
        return new Response(JSON.stringify(envelope), { status: 200 });
    } }));
vi.mock('cloudflare:workers', () => {
    const kv = { get: async () => null, getWithMetadata: async () => ({ value: null }), put: async (k: string, _v: string, o?: any) => { puts.push(k); putTtls.push({ k, ttl: o?.expirationTtl }); }, delete: async () => {} };
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
        const rows = await retrieveNbaGameRows('401766458', 'nba');
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
        await expect(retrieveNbaProcessedGame('401766458', 60, 'nba')).resolves.toMatchObject({ plays: [{}] });
    });
});

const YEAR = 60 * 60 * 24 * 365;
const HOUR = 60 * 60;
afterEach(() => { respond = null; vi.restoreAllMocks(); });

describe('typed processor errors', () => {
    test('a non-2xx throws ProcessorError carrying the status (404 vs 5xx), for football too', async () => {
        const { requestProcessor, ProcessorError } = await import('../../src/resources/python');
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        for (const status of [404, 502, 500]) {
            respond = (u) => (u.startsWith('http://python:5000/') ? new Response('{"status":"bad"}', { status }) : undefined);
            await expect(retrieveNbaProcessedGame('401766458', 60, 'nba')).rejects.toMatchObject({ name: 'ProcessorError', status });
            const err = await requestProcessor('cfb/401520150/process', 60).catch((e) => e);
            expect(err).toBeInstanceOf(ProcessorError);
            expect(err).toBeInstanceOf(Error);
            expect(err.status).toBe(status);
        }
    });
    test('a 200 without plays is a 502 ProcessorError', async () => {
        respond = (u) => (u.startsWith('http://python:5000/') ? new Response('{"status":"bad","message":"nope"}', { status: 200 }) : undefined);
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        await expect(retrieveNbaProcessedGame('401766458', 60, 'nba')).rejects.toMatchObject({ name: 'ProcessorError', status: 502 });
    });
});

describe('game id checks', () => {
    test.each(['', '12345', '1234567890123', '../../v1/meta', '401766458?x=1', '40176645a'])('a bad id (%j) never reaches fetch', async (bad) => {
        const g = await import('../../src/resources/nbaGames');
        urls.length = 0;
        await expect(g.retrieveNbaSchedule(bad, 'nba')).rejects.toThrow(/invalid NBA game id/);
        await expect(g.retrieveNbaGameRows(bad, 'nba')).rejects.toThrow(/invalid NBA game id/);
        await expect(g.retrieveNbaProcessedGame(bad, 60, 'nba')).rejects.toThrow(/invalid NBA game id/);
        expect(urls).toEqual([]);
    });
});

describe('cache lifetimes and read shape', () => {
    const schedule = (completed: unknown) => (u: string) =>
        u.includes('/v1/nba/schedule?') ? new Response(JSON.stringify({ data: [{ id: 401766458, status_type_completed: completed }] }), { status: 200 }) : undefined;
    test('a completed schedule row is cached a year, anything else an hour', async () => {
        const { retrieveNbaSchedule } = await import('../../src/resources/nbaGames');
        for (const [completed, ttl] of [[true, YEAR], ['True', YEAR], [false, HOUR], ['False', HOUR], [null, HOUR]] as const) {
            respond = schedule(completed);
            putTtls.length = 0;
            await expect(retrieveNbaSchedule('401766458', 'nba')).resolves.toMatchObject({ id: 401766458 });
            expect(putTtls.filter((p) => p.k !== 'sdv-meta:datasets').map((p) => p.ttl)).toEqual([ttl]);
        }
    });
    test('the game read shares the schedule key and TTL rule; the other six tables are a year', async () => {
        const { retrieveNbaGameRows, retrieveNbaSchedule } = await import('../../src/resources/nbaGames');
        respond = schedule(false);
        putTtls.length = 0;
        await retrieveNbaSchedule('401766458', 'nba');
        const solo = putTtls.filter((p) => p.k !== 'sdv-meta:datasets');
        putTtls.length = 0;
        await retrieveNbaGameRows('401766458', 'nba');
        const all = putTtls.filter((p) => p.k !== 'sdv-meta:datasets');
        expect(all).toHaveLength(7);
        expect(all.filter((p) => p.ttl === YEAR)).toHaveLength(6);
        expect(all.find((p) => p.k === solo[0].k)?.ttl).toBe(HOUR);
    });
    test('pbp and play_wp ask for limit=5000, ordered', async () => {
        const { retrieveNbaGameRows } = await import('../../src/resources/nbaGames');
        urls.length = 0;
        await retrieveNbaGameRows('401766458', 'nba');
        for (const t of ['pbp', 'play_wp']) {
            const u = urls.find((x) => x.includes(`/v1/nba/${t}?`))!;
            expect(u).toContain('limit=5000');
            expect(u).toContain('order=game_play_number');
        }
    });
});

describe('read timeouts (NBA only)', () => {
    const abortedSignal = (calls: number[]) =>
        vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { calls.push(ms); return AbortSignal.abort(new DOMException('timed out', 'TimeoutError')); });
    test('NBA Data API reads carry an 8 s signal and a timeout surfaces as SDVRequestError 504', async () => {
        const calls: number[] = [];
        abortedSignal(calls);
        const { retrieveNbaGameRows } = await import('../../src/resources/nbaGames');
        const { SDVRequestError } = await import('../../src/resources/sdv');
        const err = await retrieveNbaGameRows('401766458', 'nba').catch((e) => e);
        expect(err).toBeInstanceOf(SDVRequestError);
        expect(err.status).toBe(504);
        await new Promise((r) => setTimeout(r, 20)); // Promise.all rejects on the first; let the other reads settle under this spy
        expect(new Set(calls)).toEqual(new Set([8000]));
    });
    test('the NBA processor fetch carries a 25 s signal and a timeout surfaces as ProcessorError 504', async () => {
        const calls: number[] = [];
        abortedSignal(calls);
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        await expect(retrieveNbaProcessedGame('401766458', 60, 'nba')).rejects.toMatchObject({ name: 'ProcessorError', status: 504 });
        expect(calls).toEqual([25000]);
    });
    test('an AbortError with no timeout set is not reported as a processor timeout (football sets none)', async () => {
        respond = () => { throw new DOMException('aborted elsewhere', 'AbortError'); };
        const { requestProcessor } = await import('../../src/resources/python');
        const err = await requestProcessor('cfb/401520150/process', 60).catch((e) => e);
        respond = null;
        expect(err.name).toBe('AbortError');
        expect(err.message).not.toMatch(/undefinedms/);
    });
    test('football reads and processor calls set no signal', async () => {
        const calls: number[] = [];
        abortedSignal(calls);
        const { retrieveRows } = await import('../../src/resources/sdv');
        const { requestProcessor } = await import('../../src/resources/python');
        await retrieveRows('cfb', 'team_summaries', { season: '2027' }, 60);
        await requestProcessor('cfb/401520150/process', 60);
        expect(calls).toEqual([]);
    });
});
