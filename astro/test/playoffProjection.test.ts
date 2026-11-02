import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import PlayoffBracket from '../src/components/PlayoffBracket.astro';
import type { PlayoffProjection } from '../src/resources/playoff';
import { buildBracket, pct } from '../src/utils/playoff';

// the API's real answer for 2026 on the 11-02 Data API (python/playoff_projection.py, 1000 sims)
const fixture = (): PlayoffProjection =>
    JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/playoff-projection-2026.json.gz', import.meta.url))).toString());

describe('buildBracket', () => {
    test('the fixed CFP bracket: 5 v 12 feeds 4, 8 v 9 feeds 1, and 1/4 and 2/3 meet in the semifinals', () => {
        const { rounds, champion } = buildBracket(fixture().field);
        expect(rounds.map((r) => r.games.length)).toEqual([4, 4, 2, 1]);
        expect(rounds[0].games.map((g) => g.map((s) => s.seed))).toEqual([[8, 9], [5, 12], [7, 10], [6, 11]]);
        expect(rounds[1].games.map((g) => g[0].seed)).toEqual([1, 4, 2, 3]);
        const fromPair = (pool: number[]) => rounds[1].games.flat().filter((s) => pool.includes(s.seed));
        // each quarterfinal's second slot is the likelier first-round winner
        const f = new Map(fixture().field.map((s) => [s.seed, s]));
        for (const [hi, lo] of [[8, 9], [5, 12], [7, 10], [6, 11]]) {
            const want = f.get(hi)!.reach.quarterfinal >= f.get(lo)!.reach.quarterfinal ? hi : lo;
            expect(fromPair([hi, lo]).map((s) => s.seed)).toEqual([want]);
        }
        const semis = rounds[2].games.map((g) => g.map((s) => s.seed));
        expect([1, 8, 9, 4, 5, 12]).toContain(semis[0][0]);
        expect([1, 8, 9, 4, 5, 12]).toContain(semis[0][1]);
        expect([2, 7, 10, 3, 6, 11]).toContain(semis[1][0]);
        // the champion is the title favourite, and every number is that game's unconditional odds
        const best = [...f.values()].reduce((a, b) => (b.reach.champion > a.reach.champion ? b : a));
        expect(champion.seed).toBe(best.seed);
        expect(rounds[0].games[0][0].pct).toBe(f.get(8)!.reach.quarterfinal);
        expect(rounds[1].games[0][0].pct).toBe(f.get(1)!.reach.semifinal);
    });

    test('pct keeps the tails honest', () => {
        expect(pct(1)).toBe('100%');
        expect(pct(0.996)).toBe('>99%');
        expect(pct(0.004)).toBe('<1%');
        expect(pct(0)).toBe('0%');
        expect(pct(0.456)).toBe('46%');
    });
});

describe('PlayoffBracket', () => {
    test('renders every round, the champion, and links each slot to its team', async () => {
        const p = fixture();
        const { rounds, champion } = buildBracket(p.field);
        const names = Object.fromEntries(p.teams.map((t) => [t.team_id, t.name]));
        const html = await (await AstroContainer.create()).renderToString(PlayoffBracket, { props: { rounds, champion, names } });
        expect([...html.matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(
            ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship', 'Champion']);
        expect(html.match(/class="bracket-slot"/g)).toHaveLength(8 + 8 + 4 + 2 + 1);
        expect(html).toContain(`href="/team/${champion.teamId}"`);
        expect(html).toContain(names[champion.teamId]);
    });
});

// --- the resource: what it posts, what it caches -------------------------------------------
const kv = new Map<string, string>();
const posts: { url: string; body: any }[] = [];
let scheduleRows = 888;
let python: () => Response;

vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, {
        get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? {
            get: async (key: string, type?: string) => (kv.has(key) ? (type === 'json' ? JSON.parse(kv.get(key)!) : kv.get(key)) : null),
            getWithMetadata: async () => ({ value: null, metadata: null }),
            put: async (key: string, value: string) => { kv.set(key, value); },
            delete: async (key: string) => { kv.delete(key); },
        } : undefined),
    }),
}));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/v1/meta')) return Response.json({ datasets: { 'cfb.schedule': '2026-11-02T15:00:00Z', 'cfb.team_summaries': '2026-11-02T15:05:00Z' } });
        if (u.includes('/v1/cfb/schedule')) return Response.json({ data: Array.from({ length: scheduleRows }, (_, i) => ({ game_id: i })), next: null });
        if (u.includes('/v1/cfb/team_summaries')) return Response.json({ data: [{ team_id: 87, net_adj_epa: 0.35 }], next: null });
        posts.push({ url: u, body: JSON.parse(String(init?.body)) });
        return python();
    },
}));

beforeEach(() => {
    kv.clear();
    posts.length = 0;
    scheduleRows = 888;
    python = () => Response.json(fixture());
});

describe('retrievePlayoffProjection', () => {
    test('posts the schedule, the ratings and the pregame model, then serves the answer from KV', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        const { SDV_RATINGS_PREDICTION_CONFIG } = await import('../src/resources/sdv');
        const p = await retrievePlayoffProjection(2026);
        expect(p?.field).toHaveLength(12);
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toMatch(/\/cfb\/playoff\/projection$/);
        const cfb = SDV_RATINGS_PREDICTION_CONFIG.cfb!;
        expect(posts[0].body.model).toEqual({ scale: cfb.net_points_scale, hfa: cfb.hfa_points, sd: cfb.margin_sd });
        expect(posts[0].body.season).toBe(2026);
        expect(posts[0].body.games).toHaveLength(888);
        expect(posts[0].body.teams).toEqual([{ team_id: 87, net_adj_epa: 0.35 }]);
        // keyed on both ingest stamps: a new ingest is a new projection
        const key = [...kv.keys()].find((k) => k.startsWith('playoff-projection:'));
        expect(key).toContain('2026-11-02T15:00:00Z');
        expect(key).toContain('2026-11-02T15:05:00Z');
        expect(await retrievePlayoffProjection(2026)).toEqual(p);
        expect(posts).toHaveLength(1);
    });

    test('an API failure is null and never cached', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        python = () => new Response('nope', { status: 500 });
        expect(await retrievePlayoffProjection(2026)).toBeNull();
        python = () => Response.json({ field: [] });
        expect(await retrievePlayoffProjection(2026)).toBeNull();
        expect([...kv.keys()].some((k) => k.startsWith('playoff-projection:'))).toBe(false);
    });

    test('a schedule that fills the limit is truncated: no projection, and the API is never asked', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        scheduleRows = 5000;
        expect(await retrievePlayoffProjection(2026)).toBeNull();
        expect(posts).toHaveLength(0);
    });
});
