import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import PlayoffBracket from '../src/components/PlayoffBracket.astro';
import type { PlayoffProjection } from '../src/resources/playoff';
import { buildBracket, committeeRanking, oddsShade, pct } from '../src/utils/playoff';
import { calculatePredictedPointMargin, calculatePredictedWinProb } from '../src/resources/sdv';

// the API's real answer for 2026 on the 11-02 Data API (python/playoff_projection.py, 1000 sims)
const fixture = (): PlayoffProjection =>
    JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/playoff-projection-2026.json.gz', import.meta.url))).toString());

// the page's head-to-head pricing: the pregame model on each team's rating
const beatsFrom = (p: PlayoffProjection) => {
    const rating = new Map(p.teams.map((t) => [t.team_id, t.rating]));
    return (a: string, b: string, home: boolean) =>
        calculatePredictedWinProb(calculatePredictedPointMargin(rating.get(b), rating.get(a), !home))!;
};

describe('buildBracket', () => {
    test('the fixed CFP bracket: 5 v 12 feeds 4, 8 v 9 feeds 1, and 1/4 and 2/3 meet in the semifinals', () => {
        const p = fixture();
        const { rounds, champion } = buildBracket(p.field, beatsFrom(p));
        expect(rounds.map((r) => r.games.length)).toEqual([4, 4, 2, 1]);
        expect(rounds[0].games.map((g) => g.map((s) => s.seed))).toEqual([[8, 9], [5, 12], [7, 10], [6, 11]]);
        expect(rounds[1].games.map((g) => g[0].seed)).toEqual([1, 4, 2, 3]);
        const semis = rounds[2].games.map((g) => g.map((s) => s.seed));
        expect([1, 8, 9, 4, 5, 12]).toContain(semis[0][0]);
        expect([1, 8, 9, 4, 5, 12]).toContain(semis[0][1]);
        expect([2, 7, 10, 3, 6, 11]).toContain(semis[1][0]);
        // the first round is the API's own home-field odds; the champion's number is its title chance
        const f = new Map(p.field.map((s) => [s.seed, s]));
        expect(rounds[0].games[0][0].pct).toBeCloseTo(f.get(8)!.reach.quarterfinal, 6);
        expect(champion.pct).toBe(f.get(champion.seed)!.reach.champion);
    });

    test('every game is priced head to head, its favourite advances, and every later slot came out of the game before it', () => {
        const p = fixture();
        const { rounds, champion } = buildBracket(p.field, beatsFrom(p));
        for (let r = 0; r < rounds.length; r++) {
            for (const [a, b] of rounds[r].games) expect(a.pct + b.pct).toBeCloseTo(1, 12);
            if (r === 0) continue;
            const winners = rounds[r - 1].games.map(([a, b]) => (b.pct > a.pct ? b.seed : a.seed));
            const byes = r === 1 ? [1, 2, 3, 4] : [];
            for (const s of rounds[r].games.flat()) expect([...winners, ...byes]).toContain(s.seed);
        }
        const [x, y] = rounds[3].games[0];
        expect(champion.seed).toBe(y.pct > x.pct ? y.seed : x.seed);
    });

    test('a team likelier to go deep still loses the game it is the underdog in', () => {
        // the 1 seed has by far the larger reach numbers, but here the 8 seed beats anyone it meets:
        // the bracket must follow the matchup odds, not the reach numbers
        const p = fixture();
        const eight = p.field.find((s) => s.seed === 8)!.team_id;
        const { rounds, champion } = buildBracket(p.field, (a, b) => (a === eight ? 0.6 : b === eight ? 0.4 : 0.5));
        expect(rounds[1].games[0].map((s) => s.seed)).toEqual([1, 8]);
        expect(rounds[2].games[0].map((s) => s.seed)).toContain(8);
        expect(champion.seed).toBe(8);
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
        const { rounds, champion } = buildBracket(p.field, beatsFrom(p));
        const names = Object.fromEntries(p.teams.map((t) => [t.team_id, t.name]));
        const abbrs = Object.fromEntries(p.teams.map((t) => [t.team_id, `A${t.team_id}`]));
        const html = await (await AstroContainer.create()).renderToString(PlayoffBracket, { props: { rounds, champion, names, abbrs } });
        const [graphic, table] = html.split('bracket-table');
        expect([...graphic.matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(
            ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship', 'Champion']);
        // md and up: one bordered table per game (11 games + the champion), one row per team
        expect(graphic.match(/table-bordered/g)).toHaveLength(4 + 4 + 2 + 1 + 1);
        expect(graphic.match(/class="bracket-slot"/g)).toHaveLength(8 + 8 + 4 + 2 + 1);
        expect(graphic).toContain(names[champion.teamId]);
        expect(graphic).not.toContain(abbrs[champion.teamId]);
        // mobile: one table, a heading row per round, one row per game, by abbreviation
        expect([...table.matchAll(/gt_group_heading[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(
            ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship', 'Champion']);
        expect(table.match(/class="bracket-slot"/g)).toHaveLength(4 + 4 + 2 + 1 + 1);
        expect(table).toContain(abbrs[champion.teamId]);
        expect(table).not.toContain(`>${names[champion.teamId]}<`);
        expect(html).toContain(`href="/team/${champion.teamId}"`);
    });
});

describe('PlayoffBracket labels', () => {
    test("the committee's bracket says whose field it is", async () => {
        const p = fixture();
        const { rounds, champion } = buildBracket(p.field, beatsFrom(p));
        const html = await (await AstroContainer.create()).renderToString(PlayoffBracket, { props: {
            rounds, champion, names: {}, abbrs: {}, label: "The committee's College Football Playoff bracket", field: "the committee's field" } });
        expect(html.match(/aria-label="The committee's College Football Playoff bracket"/g)).toHaveLength(2);
        expect(html).toContain(`title="Chance to win the title, if the committee's field holds"`);
        expect(html).not.toContain('Projected College Football Playoff bracket');
    });
});

describe('oddsShade', () => {
    test('green from 90% up, fading to clear under 1%', () => {
        expect([0.95, 0.9, 0.6, 0.2, 0.05, 0.009, 0].map(oddsShade)).toEqual(
            ['hulk-bg-level-9', 'hulk-bg-level-9', 'hulk-bg-level-8', 'hulk-bg-level-7', 'hulk-bg-level-6', 'hulk-bg-level-6', null]);
    });

    test('the cutoffs follow what pct() prints: every "1%" is shaded, every "<1%" is clear', () => {
        for (let i = 0; i <= 1000; i++) {
            const p = i / 1000;
            const shown = pct(p);
            if (shown === '<1%' || shown === '0%') expect(oddsShade(p)).toBeNull();
            else expect(oddsShade(p)).not.toBeNull();
            if (shown === '90%') expect(oddsShade(p)).toBe('hulk-bg-level-9');
        }
    });
});

// --- the resource: what it posts, what it caches -------------------------------------------
const kv = new Map<string, string>();
let kvFailReads = false, kvFailWrites = false;
const posts: { url: string; body: any }[] = [];
let scheduleRows = 888;
let python: () => Response;
// ESPN's rankings feed: the committee's ranking once it has published one
const CFP = { type: 'cfp', season: { year: 2026 }, date: '2026-11-03T08:00Z', ranks: [
    { current: 2, team: { id: '61' } }, { current: 1, team: { id: '2390' } }, { current: 3, team: { id: '254' } },
] };
let rankings: () => Promise<any>;
let rankingsCalls = 0;
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveRankings: () => { rankingsCalls++; return rankings(); },
}));

vi.mock('cloudflare:workers', () => ({
    env: new Proxy({}, {
        get: (_, k) => (typeof k === 'string' && k.endsWith('_CACHE') ? {
            get: async (key: string, type?: string) => {
                if (kvFailReads) throw new Error('KV read failed');
                return kv.has(key) ? (type === 'json' ? JSON.parse(kv.get(key)!) : kv.get(key)) : null;
            },
            getWithMetadata: async () => ({ value: null, metadata: null }),
            put: async (key: string, value: string) => { if (kvFailWrites) throw new Error('KV write failed'); kv.set(key, value); },
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
    rankings = async () => ({ rankings: [{ type: 'ap', ranks: [{ current: 1, team: { id: '1' } }] }] });
    rankingsCalls = 0;
    kvFailReads = false;
    kvFailWrites = false;
    // the committee lookup keeps per-isolate memory: every test is a fresh isolate
    vi.resetModules();
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

    test("the committee's ranking rides along: posted in order, its date in the key and on the answer", async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        rankings = async () => ({ rankings: [{ type: 'ap', ranks: [] }, CFP] });
        python = () => Response.json({ ...fixture(), committee: { ranking: ['2390', '61', '254'], field: fixture().field, last_out: [] } });
        const p = await retrievePlayoffProjection(2026);
        expect(posts[0].body.committee).toEqual(['2390', '61', '254']);
        // the date and a digest of the ids and printed ranks: a same-date correction is a new bracket
        expect([...kv.keys()].find((k) => k.startsWith('playoff-projection:'))).toMatch(/:2026-11-03T08:00Z~[0-9a-f]{8}$/);
        expect(p?.committee?.date).toBe('2026-11-03T08:00Z');
        expect(p?.committee?.ranks).toEqual({ '2390': 1, '61': 2, '254': 3 });
    });

    test('the committee ranking is read from ESPN at most hourly: a new ingest reuses it from KV', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        rankings = async () => ({ rankings: [CFP] });
        await retrievePlayoffProjection(2026);
        expect(rankingsCalls).toBe(1);
        expect(kv.has('playoff-committee:v2:2026')).toBe(true);
        // a new projection key (the cached answer gone) still takes the ranking from KV, even with ESPN down
        for (const k of [...kv.keys()]) if (k.startsWith('playoff-projection:')) kv.delete(k);
        rankings = async () => { throw new Error('ESPN down'); };
        await retrievePlayoffProjection(2026);
        expect(rankingsCalls).toBe(1);
        expect(posts[1].body.committee).toEqual(['2390', '61', '254']);
    });

    test('a stalled ESPN is cut off: the projection answers without the committee', async () => {
        const { retrievePlayoffProjection, RANKINGS_TIMEOUT_MS } = await import('../src/resources/playoff');
        vi.useFakeTimers();
        try {
            rankings = () => new Promise(() => {});
            const pending = retrievePlayoffProjection(2026);
            await vi.advanceTimersByTimeAsync(RANKINGS_TIMEOUT_MS + 1);
            const p = await pending;
            expect(p?.field).toHaveLength(12);
            expect(posts[0].body.committee).toBeNull();
            // the stall is cached for the hour too: the next render does not wait on ESPN again
            expect(JSON.parse(kv.get('playoff-committee:v2:2026')!).ranking).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    test('no committee ranking yet, or a failed rankings fetch: the projection still answers, with no committee', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        expect((await retrievePlayoffProjection(2026))?.field).toHaveLength(12);
        expect(posts[0].body.committee).toBeNull();
        kv.clear();
        rankings = async () => { throw new Error('ESPN down'); };
        expect((await retrievePlayoffProjection(2026))?.field).toHaveLength(12);
        expect(posts[1].body.committee).toBeNull();
    });

    test("ESPN failing after the hour keeps the last ranking: the bracket the page had never drops", async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        const last = committeeRanking({ rankings: [CFP as any] }, 2026);
        kv.set('playoff-committee:v2:2026', JSON.stringify({ at: Date.now() - 2 * 3600_000, ranking: last }));
        rankings = async () => { throw new Error('ESPN down'); };
        await retrievePlayoffProjection(2026);
        expect(rankingsCalls).toBe(1);
        expect(posts[0].body.committee).toEqual(['2390', '61', '254']);
        const cached = JSON.parse(kv.get('playoff-committee:v2:2026')!);
        expect(cached.ranking).toEqual(last);
        expect(Date.now() - cached.at).toBeLessThan(60_000); // retried again only in an hour
    });

    test('an older poll never replaces a newer one', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        const newer = { ...committeeRanking({ rankings: [CFP as any] }, 2026)!, date: '2026-11-10T08:00Z' };
        kv.set('playoff-committee:v2:2026', JSON.stringify({ at: Date.now() - 2 * 3600_000, ranking: newer }));
        rankings = async () => ({ rankings: [CFP] }); // a lagging edge still serving the 11-03 poll
        const p = await retrievePlayoffProjection(2026);
        expect(JSON.parse(kv.get('playoff-committee:v2:2026')!).ranking.date).toBe('2026-11-10T08:00Z');
        expect(p).not.toBeNull();
    });

    test('no poll yet is cached for the hour: ESPN is not asked on every render', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        await retrievePlayoffProjection(2026);
        for (const k of [...kv.keys()]) if (k.startsWith('playoff-projection:')) kv.delete(k);
        await retrievePlayoffProjection(2026);
        expect(rankingsCalls).toBe(1);
    });

    test('concurrent misses share one ESPN request', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        rankings = async () => { await gate; return { rankings: [CFP] }; };
        const both = Promise.all([retrievePlayoffProjection(2026), retrievePlayoffProjection(2026)]);
        await new Promise((r) => setTimeout(r, 0));
        release();
        await both;
        expect(rankingsCalls).toBe(1);
    });

    test('a malformed feed reads as no poll, says so in the log, and the projection still answers', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        rankings = async () => ({ rankings: { not: 'an array' } });
        const p = await retrievePlayoffProjection(2026);
        expect(p?.field).toHaveLength(12);
        expect(posts[0].body.committee).toBeNull();
        expect(warn.mock.calls.some((c) => String(c[0]).includes('malformed'))).toBe(true);
        warn.mockRestore();
    });

    test('a corrected poll (same date, same order, new printed ranks) is a new projection key', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        rankings = async () => ({ rankings: [CFP] });
        await retrievePlayoffProjection(2026);
        const first = [...kv.keys()].find((k) => k.startsWith('playoff-projection:'))!;
        vi.resetModules();
        kv.clear();
        const corrected = { ...CFP, ranks: CFP.ranks.map((x) => (x.team.id === '254' ? { ...x, current: 4 } : x)) };
        rankings = async () => ({ rankings: [corrected] });
        const { retrievePlayoffProjection: again } = await import('../src/resources/playoff');
        await again(2026);
        const second = [...kv.keys()].find((k) => k.startsWith('playoff-projection:'))!;
        expect(second).not.toBe(first);
    });

    test('a failed KV read never overwrites the stored ranking with less', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        const stored = JSON.stringify({ at: Date.now() - 2 * 3600_000, ranking: committeeRanking({ rankings: [CFP as any] }, 2026) });
        kv.set('playoff-committee:v2:2026', stored);
        kvFailReads = true;
        rankings = async () => { throw new Error('ESPN down'); };
        await retrievePlayoffProjection(2026);
        expect(kv.get('playoff-committee:v2:2026')).toBe(stored);
    });

    test('failed KV writes still hold the hourly cooldown in the isolate', async () => {
        const { retrievePlayoffProjection } = await import('../src/resources/playoff');
        kvFailWrites = true;
        rankings = async () => ({ rankings: [CFP] });
        await retrievePlayoffProjection(2026);
        await retrievePlayoffProjection(2026);
        expect(rankingsCalls).toBe(1);
        expect(posts.at(-1)!.body.committee).toEqual(['2390', '61', '254']);
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

describe('committeeRanking', () => {
    test("the committee's poll, No. 1 first, with its date; null before its first ranking", () => {
        expect(committeeRanking({ rankings: [{ type: 'ap', ranks: [] } as any, CFP as any] }, 2026)).toEqual(
            { date: '2026-11-03T08:00Z', ids: ['2390', '61', '254'], ranks: { '2390': 1, '61': 2, '254': 3 } });
        expect(committeeRanking({ rankings: [{ type: 'ap', ranks: [{ current: 1, team: { id: '1' } }] } as any] }, 2026)).toBeNull();
        expect(committeeRanking(null, 2026)).toBeNull();
    });

    test("last season's poll is not this season's ranking", () => {
        expect(committeeRanking({ rankings: [{ ...CFP, season: { year: 2025 } } as any] }, 2026)).toBeNull();
        // even when the feed itself says 2026: a poll that names another season is never this one
        expect(committeeRanking({ latestSeason: { year: 2026 }, rankings: [{ ...CFP, season: { year: 2025 } } as any] }, 2026)).toBeNull();
    });

    test("a poll with no season of its own is dated by when it was published, never by the feed's latestSeason", () => {
        const { season: _, ...noSeason } = CFP;
        expect(committeeRanking({ rankings: [noSeason as any] }, 2026)?.ids).toEqual(['2390', '61', '254']);
        // a retained 2025 poll in a feed that already says 2026 is not this season's ranking
        const old = { ...noSeason, date: '2025-12-07T17:00Z' };
        expect(committeeRanking({ latestSeason: { year: 2026 }, rankings: [old as any] }, 2026)).toBeNull();
    });

    test('an entry with no team id is skipped without shifting the ranks after it', () => {
        const c = committeeRanking({ rankings: [{ ...CFP, ranks: [
            { current: 1, team: { id: '2390' } }, { current: 2, team: {} }, { current: 3, team: { id: '254' } },
        ] } as any] }, 2026);
        expect(c?.ids).toEqual(['2390', '254']);
        expect(c?.ranks).toEqual({ '2390': 1, '254': 3 });
    });
});
