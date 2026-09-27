import { beforeEach, describe, expect, test, vi } from 'vitest';

// The three head-coach tables are read through requestSDV like team_summaries.
// These pin the REQUEST contract, which no render test sees: the endpoint per
// league, `role=HC` on the coach tables, `limit=400`, the key columns in
// `select` (one unknown column is a 400), the multi-day KV TTL, [] on a bad
// response, and that no read ever retries another season.
const seen: { url: string }[] = [];
const puts: { key: string; ttl: number | undefined }[] = [];
let respond: () => Response = () => new Response(JSON.stringify({ data: [{ coach: 'x' }] }), { status: 200 });

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => { seen.push({ url: String(url) }); return respond(); },
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
    respond = () => new Response(JSON.stringify({ data: [{ coach: 'x' }] }), { status: 200 });
});

const only = () => { expect(seen).toHaveLength(1); return new URL(seen[0].url); };
const select = (u: URL) => decodeURIComponent(u.searchParams.get('select') ?? '').split(',');
const THREE_DAYS = 60 * 60 * 24 * 3;

describe('coach tendency reads', () => {
    test('coach_tendencies: season + role=HC, limit 400, the key columns, per-league base', async () => {
        const sdv = await import('../src/resources/sdv');
        const rows = await sdv.retrieveCoachTendencies({ season: 2024, league: 'nfl', columns: ['go_rate', 'sec_per_play'] });
        expect(rows).toEqual([{ coach: 'x' }]);
        const u = only();
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/nfl/coach_tendencies');
        expect(u.searchParams.get('season')).toBe('2024');
        expect(u.searchParams.get('role')).toBe('HC');
        expect(u.searchParams.get('limit')).toBe('400');
        const sel = select(u);
        for (const k of ['season', 'pos_team_id', 'pos_team', 'coach', 'role', 'games', 'plays', 'drives', 'go_rate', 'sec_per_play']) expect(sel).toContain(k);
        expect(new Set(sel).size).toBe(sel.length);
    });

    test('team_tendencies: season, no role filter, the team key columns', async () => {
        const sdv = await import('../src/resources/sdv');
        await sdv.retrieveTeamTendencies({ season: 2023, columns: ['pass_rate'] });
        const u = only();
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/cfb/team_tendencies');
        expect(u.searchParams.get('season')).toBe('2023');
        expect(u.searchParams.has('role')).toBe(false);
        expect(u.searchParams.get('limit')).toBe('400');
        const sel = select(u);
        for (const k of ['season', 'pos_team_id', 'pos_team', 'games', 'plays', 'drives', 'pass_rate']) expect(sel).toContain(k);
        expect(sel).not.toContain('coach');
    });

    test('coach_careers: role=HC, no season, the career key columns', async () => {
        const sdv = await import('../src/resources/sdv');
        await sdv.retrieveCoachCareers({ league: 'nfl', columns: ['epa_per_play'] });
        const u = only();
        expect(u.origin + u.pathname).toBe('https://data.sportsdataverse.org/v1/nfl/coach_careers');
        expect(u.searchParams.has('season')).toBe(false);
        expect(u.searchParams.get('role')).toBe('HC');
        expect(u.searchParams.get('limit')).toBe('400');
        const sel = select(u);
        for (const k of ['coach', 'role', 'teams', 'seasons', 'first_season', 'last_season', 'games', 'plays', 'drives', 'epa_per_play']) expect(sel).toContain(k);
        expect(sel).not.toContain('season');
        expect(sel).not.toContain('pos_team_id');
    });

    test('no columns given: every board column, once, and never a column the tables lack', async () => {
        const sdv = await import('../src/resources/sdv');
        const { coachMetricColumns } = await import('../src/utils/coaches');
        await sdv.retrieveCoachTendencies({ season: 2024 });
        const sel = select(only());
        for (const c of coachMetricColumns()) expect(sel).toContain(c);
        expect(new Set(sel).size).toBe(sel.length);
        expect(sel).not.toContain('undefined');
    });

    test('a good response is cached for three days under a league-namespaced key', async () => {
        const sdv = await import('../src/resources/sdv');
        await sdv.retrieveCoachTendencies({ season: 2024, league: 'nfl', columns: ['go_rate'] });
        await sdv.retrieveCoachCareers({ columns: ['go_rate'] });
        await sdv.retrieveTeamTendencies({ season: 2024, league: 'nfl', columns: ['go_rate'] });
        expect(puts).toHaveLength(3);
        for (const p of puts) expect(p.ttl).toBe(THREE_DAYS);
        // keys are SHA-256 digests; the nfl reads hash a namespaced string, so no two collide
        expect(new Set(puts.map((p) => p.key)).size).toBe(3);
    });

    test('a bad response is [] after exactly one request: careers never falls back to another season, nor does a season read', async () => {
        const sdv = await import('../src/resources/sdv');
        respond = () => new Response('nope', { status: 500, statusText: 'Internal Server Error' });
        expect(await sdv.retrieveCoachCareers({ league: 'nfl', columns: ['go_rate'] })).toEqual([]);
        expect(seen).toHaveLength(1);
        seen.length = 0;
        expect(await sdv.retrieveCoachTendencies({ season: 2024, columns: ['go_rate'] })).toEqual([]);
        expect(seen).toHaveLength(1);
        expect(new URL(seen[0].url).searchParams.get('season')).toBe('2024');
        seen.length = 0;
        expect(await sdv.retrieveTeamTendencies({ season: 2024, columns: ['go_rate'] })).toEqual([]);
        expect(seen).toHaveLength(1);
        expect(puts).toHaveLength(0);
    });

    test('a 200 without a data array is [] and is never cached (it would otherwise serve for the TTL)', async () => {
        const sdv = await import('../src/resources/sdv');
        respond = () => new Response(JSON.stringify({ error: 'unknown column' }), { status: 200 });
        expect(await sdv.retrieveCoachCareers({ columns: ['go_rate'] })).toEqual([]);
        expect(seen).toHaveLength(1);
        expect(puts).toHaveLength(0);
        // nor is a body that does not parse
        respond = () => new Response('<html>maintenance</html>', { status: 200 });
        expect(await sdv.retrieveCoachTendencies({ season: 2024, columns: ['go_rate'] })).toEqual([]);
        expect(puts).toHaveLength(0);
    });
});

// Not a coach read, but the same harness: the player page's NFL game-link crosswalk.
describe('the NFL schedule crosswalk read', () => {
    test('maps game_id -> espn, answers a 404 with {}, and REJECTS any other failure', async () => {
        const sdv = await import('../src/resources/sdv');
        respond = () => new Response(JSON.stringify({ data: [{ game_id: '2024_01_LV_LAC', espn: 401671592 }] }), { status: 200 });
        expect(await sdv.retrieveNflEspnGameIds(2024)).toEqual({ '2024_01_LV_LAC': '401671592' });
        respond = () => new Response('missing', { status: 404 });
        expect(await sdv.retrieveNflEspnGameIds(2023)).toEqual({});
        // a swallowed 500 would let the player page cache itself without its game links
        respond = () => new Response('nope', { status: 500, statusText: 'Internal Server Error' });
        await expect(sdv.retrieveNflEspnGameIds(2022)).rejects.toThrow();
    });
});
