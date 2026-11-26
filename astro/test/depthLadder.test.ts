// BB-G61 ('bball-depth-ladder'): the team page's depth ladder, on real producer rows (fixtures/README.md,
// depth-ladder-2025.json.gz): the 2024-25 Brooklyn Nets' and Duke's player_war rows with sdv-py's war_tier, and each
// league's roster_tier_shape. The page reads the two tables and lays them out; every tier and median is the producer's.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/depth-ladder-2025.json.gz', import.meta.url))).toString()) as Record<string, { war: Record<string, any>[]; shape: Record<string, any>[] }>;
const NETS = 1610612751;
const SCHEMA: Record<string, string> = { nba_stats: 'nba', mbb: 'mbb' };


const calls: [string, string, Record<string, string>][] = [];
const api = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'down' | 'no-shape' | 'null-tier' | 'old-table' }));
vi.mock('../src/resources/sdv', async (orig) => {
    const real = await orig<typeof import('../src/resources/sdv')>();
    return {
        ...real,
        retrieveRowsFrom: async (source: { schema: string }, table: string, q: Record<string, string>) => {
            if (table !== 'player_war' && table !== 'roster_tier_shape') throw new Error(`unmocked read ${table}`);
            calls.push([source.schema, table, q]);
            if (api.mode === 'down') throw new real.SDVRequestError(503, table, 'down');
            // the generated route of a snapshot table the warehouse has not built answers 500 (sdv-db test_generated_api)
            if (api.mode === 'no-shape' && table === 'roster_tier_shape') throw new real.SDVRequestError(500, table, 'relation does not exist');
            const lg = FIX[SCHEMA[source.schema]];
            if (table === 'roster_tier_shape') return lg.shape.filter((r) => String(r.season) === q.season);
            const rows = lg.war.filter((r) => String(r.season) === q.season && String(r.team_id) === q.team_id);
            // the table before the season-products reload: the column is null once widened, absent before
            if (api.mode === 'null-tier') return rows.map((r) => ({ ...r, war_tier: null }));
            return api.mode === 'old-table' ? rows.map(({ war_tier: _, ...r }) => r) : rows;
        },
    };
});
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: async () => ({ rates: [], strength: null, games: [], gameRates: [] }),
}));
const nba = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());
const oracle = nba('league_context');
const shots = nba('shots') as any[];
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
}));


import { retrieveDepthLadder, type DepthLadderReads } from '../src/resources/depthLadder';
import { prepareBasketballTeam } from '../src/routes/basketball/team';
import { bandOf, depthLadder } from '../src/utils/depthLadder';
import { FLAGS } from '../src/utils/features';

const ON = { 'bball-depth-ladder': true, 'bball-team-season': false };
const OFF = { 'bball-depth-ladder': false, 'bball-team-season': false };
function fakeAstro(path: string, id: string, flagOverrides: Record<string, boolean>) {
    const cache: unknown[] = [];
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: { flagOverrides } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
const ok = <T extends object>(r: T) => { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as Exclude<T, { notFound: true } | { unavailable: true }>; };
const ladder = (r: unknown) => r as DepthLadderReads;
const TIERS = ['Star', 'Starter', 'Rotation', 'Bench', 'Fringe'];
const nets = () => FIX.nba.war;

beforeAll(() => { vi.stubGlobal('fetch', () => { throw new Error('unmocked network read'); }); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { api.mode = 'ok'; calls.length = 0; });

describe('the reads', () => {
    test("the team's player_war rows, most WAR first, and the league's tier shape, in the season schema", async () => {
        const r = ladder(await retrieveDepthLadder('nba', 2025, NETS));
        expect(calls).toEqual([
            ['nba_stats', 'player_war', { season: '2025', team_id: String(NETS), order: '-war', limit: '60' }],
            ['nba_stats', 'roster_tier_shape', { season: '2025', order: 'tier_order', limit: '10' }],
        ]);
        expect(r.players).toHaveLength(21);
        expect(r.shape.map((s) => s.war_tier)).toEqual(TIERS);
    });
    test("before the reload (war_tier null or absent) or before the shape table exists (the API's 500): 'pending'", async () => {
        for (const mode of ['null-tier', 'old-table', 'no-shape'] as const) {
            api.mode = mode;
            expect(await retrieveDepthLadder('nba', 2025, NETS)).toBe('pending');
        }
    });
    test("a season the producer does not cover (no player_war rows): 'none'", async () => {
        expect(await retrieveDepthLadder('nba', 2024, NETS)).toBe('none');
    });
    test('a player_war outage throws', async () => {
        api.mode = 'down';
        await expect(retrieveDepthLadder('nba', 2025, NETS)).rejects.toThrow('down');
    });
});

describe('depthLadder', () => {
    test('the Nets: every player on the rung the producer gave him, in its order, with the league median', () => {
        const { war, shape } = FIX.nba;
        const rungs = depthLadder(war as any, shape as any);
        expect(rungs.map((r) => r.tier)).toEqual(TIERS);
        expect(rungs.map((r) => r.median)).toEqual(shape.map((s) => s.players_median));
        for (const r of rungs) expect(r.players.map((p) => p.id)).toEqual(war.filter((w) => w.war_tier === r.tier).map((w) => String(w.player_id)));
        // under the producer's possession floor: no tier, off the ladder (Cui Cui's 20 possessions among them)
        const untiered = war.filter((w) => w.war_tier == null);
        expect(untiered.map((w) => w.player_name)).toContain('Cui Cui');
        expect(rungs.flatMap((r) => r.players)).toHaveLength(war.length - untiered.length);
        expect(rungs[0].players).toEqual([]); // no Nets Star in 2024-25
        expect(rungs[1].players.map((p) => p.name)).toEqual(['Cameron Johnson']);
    });
    test("the bands are the producer's (roster_tier_shape pct_floor / pct_ceiling), read as copy", () => {
        // the cut points sportsdataverse-py publishes (WAR_TIERS); a drift there changes these rows and this test
        expect(FIX.nba.shape.map((s) => [s.pct_floor, s.pct_ceiling])).toEqual([[95, null], [80, 95], [50, 80], [20, 50], [0, 20]]);
        expect(depthLadder([], FIX.nba.shape as any).map((r) => r.band)).toEqual(['95 and up', '80 to under 95', '50 to under 80', '20 to under 50', 'under 20']);
        expect(bandOf(null, null)).toBeNull();
    });
    test('Duke: five Stars against a D-I median of none', () => {
        const rungs = depthLadder(FIX.mbb.war as any, FIX.mbb.shape as any);
        expect(rungs[0].players.map((p) => p.name)).toEqual(['Khaman Maluach', 'Cooper Flagg', 'Kon Knueppel', 'Sion James', 'Tyrese Proctor']);
        expect(rungs[0].median).toBe(0);
    });
});

describe('the team page', () => {
    test("'bball-depth-ladder' is a preview flag; off, no read and no key", async () => {
        expect(FLAGS['bball-depth-ladder']).toBe('preview');
        const t = ok(await prepareBasketballTeam(fakeAstro(`/nba/team/${NETS}?season=2025`, String(NETS), OFF).astro, 'nba'));
        expect('depthLadder' in t).toBe(false);
        expect(calls).toEqual([]);
    });
    test('on: the reads, cached with the page', async () => {
        const tt = fakeAstro(`/nba/team/${NETS}?season=2025`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect(t.depthLadder?.players).toHaveLength(nets().length);
        expect(tt.cache).not.toContain(false);
    });
    test('on, a failed read: the page renders, the ladder is null, nothing is cached', async () => {
        api.mode = 'down';
        const tt = fakeAstro(`/nba/team/${NETS}?season=2025`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect(t.depthLadder).toBeNull();
        expect(tt.cache.at(-1)).toBe(false);
    });
    test('on, before the reload: no key, and the page is not cached so the ladder shows once loaded', async () => {
        api.mode = 'no-shape';
        const tt = fakeAstro(`/nba/team/${NETS}?season=2025`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect('depthLadder' in t).toBe(false);
        expect(tt.cache.at(-1)).toBe(false);
    });
    test('on, a season the producer does not cover: no key, and the page caches as usual', async () => {
        const tt = fakeAstro(`/nba/team/${NETS}?season=2024`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect('depthLadder' in t).toBe(false);
        expect(tt.cache).not.toContain(false);
    });
});

describe('rendered', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = async (flags: Record<string, boolean>) => {
        const { default: Page } = await import('../src/pages/nba/team/[id].astro');
        return container.renderToString(Page, { params: { id: String(NETS) }, request: new Request(`https://gameonpaper.com/nba/team/${NETS}?season=2025`), locals: { flagOverrides: { nba: true, ...flags } } as unknown as App.Locals });
    };
    const rows = (html: string) => [...html.split('id="depth-ladder-table"')[1].split('</table>')[0].matchAll(/<tr data-tier="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)]
        .map((m) => [m[1], ...[...m[2].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())]);
    test('the section, its link, a row per tier: band, names linked, the team count and the league median', async () => {
        const html = await render(ON);
        expect(html).toContain('<a href="#depth-ladder" class="ms-2">Depth ladder</a>');
        const r = rows(html);
        expect(r.map((x) => x[0])).toEqual(TIERS);
        expect(r[0]).toEqual(['Star', 'Starpercentile 95 and up', '—No players', '0', '0.5']);
        expect(r[2]).toEqual(['Rotation', 'Rotationpercentile 50 to under 80', 'Day&#39;Ron Sharpe, Dennis Schröder', '2', '4.0']);
        expect(r.map((x) => x[4])).toEqual(FIX.nba.shape.map((s) => s.players_median.toFixed(1)));
        expect(html).toContain('<th scope="col" class="text-end">Team players</th>');
        // a name links only where the roster rows (here the mocked season-player read) name the player
        expect(html).toContain('href="/nba/players/1630549'); // Day'Ron Sharpe
        expect(html).not.toContain('/nba/players/1629661'); // Cameron Johnson: no roster row in the mock
        expect(html).not.toContain('Cui Cui'); // under the possession floor
        expect(html).toContain('id="depth-ladder-note"');
    });
    test('a failed read says the ladder is unavailable', async () => {
        api.mode = 'down';
        expect(await render(ON)).toContain('The 2024-25 depth ladder is temporarily unavailable.');
    });
    test('before the reload: no section and no link', async () => {
        api.mode = 'no-shape';
        const html = await render(ON);
        expect(html).not.toContain('id="depth-ladder"');
        expect(html).not.toContain('#depth-ladder');
    });
    test('off: no section and no link', async () => {
        const html = await render(OFF);
        expect(html).not.toContain('id="depth-ladder"');
        expect(html).not.toContain('#depth-ladder');
    });
});
