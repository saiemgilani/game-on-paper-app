import { beforeEach, describe, expect, test, vi } from 'vitest';

// retrievePlayerSitemapIds: the seasoned id source behind the player sitemaps, and
// what it costs in subrequests. The Worker's plan is not on record, so no request
// may go past the free plan's 50 external fetches. The KV stub always misses, so
// every count here is the cold, worst case. The fake Data API below honours
// `season__gte`/`season__lte`, `select` and the real 50,000-row cap.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, nfl: 'on', 'player-pages': 'on' } };
});

const CAP = 50_000;
const seen: { url: URL; signal: boolean }[] = [];
/** rows per season per table, by league; the NFL crosswalk size */
let perSeason: Record<string, Record<string, number>>;
let crosswalkRows: number;
let failTable: string | null;

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        const u = new URL(String(url));
        seen.push({ url: u, signal: !!init?.signal });
        if (u.pathname.endsWith('/meta')) return new Response('{}', { status: 500 });
        const [, , league, table] = u.pathname.split('/');
        if (table === failTable) return new Response('down', { status: 502 });
        const limit = Math.min(Number(u.searchParams.get('limit')), CAP);
        let data: object[];
        if (table === 'players') {
            data = Array.from({ length: Math.min(limit, crosswalkRows) }, (_, i) =>
                ({ gsis_id: `00-${String(i).padStart(7, '0')}`, espn_id: i % 3 === 2 ? null : String(10_000 + i) }));
        } else {
            const from = Number(u.searchParams.get('season__gte')), to = Number(u.searchParams.get('season__lte'));
            data = [];
            for (let s = from; s <= to && data.length < limit; s++) {
                for (let i = 0; i < (perSeason[league]?.[table] ?? 0) && data.length < limit; i++) {
                    data.push({ player_id: league === 'nfl' ? `00-${String(i).padStart(7, '0')}` : 4_000_000 + i, season: s });
                }
            }
        }
        return new Response(JSON.stringify({ count: data.length, data, next: null }), { status: 200 });
    },
}));

// today's volumes (2026-11-01, all seasons): cfb 11,638 / 33,428 / 45,271 rows; nfl 2,589 / 7,926 / 12,066 + 24,863
const TODAY = {
    cfb: { passing: 506, rushing: 1454, receiving: 1969 },
    nfl: { passing: 100, rushing: 305, receiving: 465 },
};
const fresh = async () => { vi.resetModules(); return import('../src/resources/sdv'); };
const dataReads = () => seen.filter((s) => !s.url.pathname.endsWith('/meta'));

beforeEach(() => {
    seen.length = 0;
    perSeason = structuredClone(TODAY);
    crosswalkRows = 24_863;
    failTable = null;
});

describe('retrievePlayerSitemapIds', () => {
    test('one whole-range read per table, ids unique per season and sorted numerically', async () => {
        const { retrievePlayerSitemapIds } = await fresh();
        const ids = await retrievePlayerSitemapIds('cfb');
        expect(dataReads()).toHaveLength(3);
        for (const { url, signal } of dataReads()) {
            expect(Object.fromEntries(url.searchParams)).toEqual({ select: 'player_id,season', season__gte: '2004', season__lte: String(Math.max(...ids.keys())), limit: '50000' });
            expect(signal).toBe(true); // bounded: a stalled read cannot hang the request
        }
        expect(ids.get(2025)).toHaveLength(1969);
        expect(ids.get(2025)!.slice(0, 2)).toEqual(['4000000', '4000001']);
    });

    test('one season: every read carries that season as both bounds', async () => {
        const { retrievePlayerSitemapIds } = await fresh();
        const ids = await retrievePlayerSitemapIds('cfb', 2024);
        expect([...ids.keys()]).toEqual([2024]);
        expect(dataReads()).toHaveLength(3);
        for (const { url } of dataReads()) {
            expect(url.searchParams.get('season__gte')).toBe('2024');
            expect(url.searchParams.get('season__lte')).toBe('2024');
        }
    });

    test('a range that fills the cap is halved, not truncated', async () => {
        perSeason.cfb.receiving = 4000; // 23 seasons x 4,000 = 92,000 rows
        const { retrievePlayerSitemapIds } = await fresh();
        const ids = await retrievePlayerSitemapIds('cfb');
        const receiving = dataReads().filter((s) => s.url.pathname.endsWith('/receiving'));
        expect(receiving.length).toBeGreaterThan(1);
        expect(ids.get(2004)).toHaveLength(4000);
        expect(ids.get(Math.max(...ids.keys()))).toHaveLength(4000);
    });

    test('NFL maps gsis to ESPN ids and drops players the crosswalk has no ESPN id for', async () => {
        const { retrievePlayerSitemapIds } = await fresh();
        const ids = await retrievePlayerSitemapIds('nfl');
        expect(dataReads().filter((s) => s.url.pathname === '/v1/nfl/players')).toHaveLength(1);
        // receiving rows are gsis 0..464; every third has no espn id
        expect(ids.get(2024)).toHaveLength(465 - Math.floor(465 / 3));
        expect(ids.get(2024)![0]).toBe('10000');
    });

    test('a failed read throws, a season over the cap throws, and concurrent callers share one read', async () => {
        failTable = 'rushing';
        let m = await fresh();
        await expect(m.retrievePlayerSitemapIds('cfb')).rejects.toThrow();
        failTable = null;
        perSeason.cfb.receiving = CAP;
        m = await fresh();
        await expect(m.retrievePlayerSitemapIds('cfb')).rejects.toThrow(/fills the 50000-row limit|more than/);
        perSeason = structuredClone(TODAY);
        m = await fresh();
        seen.length = 0;
        await Promise.all([m.retrievePlayerSitemapIds('cfb'), m.retrievePlayerSitemapIds('cfb')]);
        expect(dataReads()).toHaveLength(3);
    });
});

describe('subrequests per request stay under the free plan cap (50)', () => {
    const count = async (run: (m: any) => Promise<Response>) => {
        await fresh();
        const idx = await import('../src/pages/sitemap-index.xml');
        const pl = await import('../src/pages/sitemap-players-[key].xml');
        seen.length = 0;
        const res = await run({ idx: idx.GET, pl: pl.GET });
        expect(res.status).toBe(200);
        return seen.length;
    };

    // these count the handler's own fetches; the middleware adds one telemetry POST per request
    test('today: a cold index with both leagues makes 8 fetches, a cold file 4 or 5', async () => {
        expect(await count((m) => m.idx({}))).toBe(1 + 3 + 4); // meta + cfb + nfl
        expect(await count((m) => m.pl({ params: { key: 'cfb-career-1' } }))).toBe(4);
        expect(await count((m) => m.pl({ params: { key: 'cfb-2024-1' } }))).toBe(4);
        expect(await count((m) => m.pl({ params: { key: 'nfl-2024-1' } }))).toBe(5);
        // a season file's reads are bounded to its season
        expect(seen.filter((s) => s.url.searchParams.has('season__gte')).every((s) =>
            s.url.searchParams.get('season__gte') === '2024' && s.url.searchParams.get('season__lte') === '2024')).toBe(true);
    });

    test('with every table at 4x today, the index is still far under 50', async () => {
        for (const lg of ['cfb', 'nfl'] as const) {
            for (const t of Object.keys(perSeason[lg])) perSeason[lg][t] *= 4;
        }
        const { SITEMAP_FETCH_BUDGET, SITEMAP_OTHER_SUBREQUESTS } = await import('../src/resources/sdv');
        const n = await count((m) => m.idx({}));
        expect(n + 1).toBeLessThan(50); // + the middleware's telemetry POST
        // the reader's own cap keeps the worst case (meta + telemetry + two leagues) under 50
        expect(SITEMAP_OTHER_SUBREQUESTS + 2 * SITEMAP_FETCH_BUDGET).toBeLessThan(50);
    });
});
