// BB-G61 ('bball-depth-ladder'): the team page's depth ladder, on real producer rows (fixtures/README.md,
// depth-ladder-2025.json.gz): the 2024-25 Brooklyn Nets' and Duke's roster_tiers rows (a traded player on every team he
// played for) and each league's roster_tier_shape (Duke's: Division I and its conference). The page reads the two tables
// and lays them out; every tier, band and median is the producer's.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/depth-ladder-2025.json.gz', import.meta.url))).toString()) as Record<string, { rows: Record<string, any>[]; shape: Record<string, any>[] }>;
const NETS = 1610612751;
const DUKE = 150;
const SCHEMA: Record<string, string> = { nba_stats: 'nba', mbb: 'mbb' };

const calls: [string, string, Record<string, string>][] = [];
const api = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'down' | 'no-shape' | 'no-rosters' | 'null-tier' | 'old-table' }));
vi.mock('../src/resources/sdv', async (orig) => {
    const real = await orig<typeof import('../src/resources/sdv')>();
    return {
        ...real,
        retrieveRowsFrom: async (source: { schema: string }, table: string, q: Record<string, string>) => {
            if (table !== 'roster_tiers' && table !== 'roster_tier_shape') throw new Error(`unmocked read ${table}`);
            calls.push([source.schema, table, q]);
            if (api.mode === 'down') throw new Error('fetch failed');
            // the generated route of a snapshot table the warehouse has not built answers 500 (sdv-db test_generated_api)
            if ((api.mode === 'no-shape' && table === 'roster_tier_shape') || (api.mode === 'no-rosters' && table === 'roster_tiers')) {
                throw new real.SDVRequestError(500, table, 'relation does not exist');
            }
            const lg = FIX[SCHEMA[source.schema]];
            if (table === 'roster_tier_shape') {
                return lg.shape.filter((r) => String(r.season) === q.season && r.scope === q.scope && (q.conference_id === undefined || String(r.conference_id) === q.conference_id));
            }
            const rows = lg.rows.filter((r) => String(r.season) === q.season && String(r.team_id) === q.team_id);
            // a widened table before the producer's rows carry tiers: the column is null; absent before that
            if (api.mode === 'null-tier') return rows.map((r) => ({ ...r, war_tier: null, war_tier_conf: null }));
            return api.mode === 'old-table' ? rows.map(({ war_tier: _, war_tier_conf: __, ...r }) => r) : rows;
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


import TeamDepthLadder from '../src/components/nba/TeamDepthLadder.astro';
import { retrieveDepthLadder, type DepthLadderReads } from '../src/resources/depthLadder';
import { prepareBasketballTeam } from '../src/routes/basketball/team';
import { bandOf, depthLadder, parseTierView } from '../src/utils/depthLadder';
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
const names = (r: { players: { name: string }[] }) => r.players.map((p) => p.name);

beforeAll(() => { vi.stubGlobal('fetch', () => { throw new Error('unmocked network read'); }); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { api.mode = 'ok'; calls.length = 0; });

describe('the reads', () => {
    test("league-wide: the team's roster_tiers rows, most WAR first, and the league shape, read together", async () => {
        const r = ladder(await retrieveDepthLadder('nba', 2025, NETS));
        expect(calls).toEqual([
            ['nba_stats', 'roster_tiers', { season: '2025', team_id: String(NETS), order: '-war', limit: '60' }],
            ['nba_stats', 'roster_tier_shape', { season: '2025', scope: 'league', order: 'tier_order', limit: '10' }],
        ]);
        expect(r.scope).toBe('league');
        expect(r.players).toHaveLength(24); // 21 Nets plus three traded players whose main team was another
        expect(r.shape.map((s) => s.war_tier)).toEqual(TIERS);
    });
    test("a conference view reads the team's conference shape (Duke: the ACC, id 2)", async () => {
        const r = ladder(await retrieveDepthLadder('mbb', 2025, DUKE, 'conference'));
        expect(calls.at(-1)).toEqual(['mbb', 'roster_tier_shape', { season: '2025', scope: 'conference', conference_id: '2', order: 'tier_order', limit: '10' }]);
        expect(r.scope).toBe('conference');
        expect(r.shape.every((s) => s.scope === 'conference' && String(s.conference_id) === '2')).toBe(true);
    });
    test("before the reload (tiers null or absent, a table's 500): 'pending'", async () => {
        for (const mode of ['null-tier', 'old-table', 'no-shape', 'no-rosters'] as const) {
            api.mode = mode;
            expect(await retrieveDepthLadder('nba', 2025, NETS)).toBe('pending');
            expect(await retrieveDepthLadder('mbb', 2025, DUKE, 'conference')).toBe('pending');
        }
    });
    test("a season the producer does not cover: 'none'", async () => {
        expect(await retrieveDepthLadder('nba', 2024, NETS)).toBe('none');
    });
    test('a read that fails another way throws', async () => {
        api.mode = 'down';
        await expect(retrieveDepthLadder('nba', 2025, NETS)).rejects.toThrow('fetch failed');
    });
});

describe('depthLadder', () => {
    test("the Nets: every player on the producer's rung, traded players marked, the untiered off", () => {
        const { rows, shape } = FIX.nba;
        const rungs = depthLadder(rows as any, shape as any);
        expect(rungs.map((r) => r.tier)).toEqual(TIERS);
        expect(rungs.map((r) => r.median)).toEqual(shape.map((s) => s.players_median));
        for (const r of rungs) expect(r.players.map((p) => p.id)).toEqual(rows.filter((w) => w.war_tier === r.tier).map((w) => String(w.player_id)));
        expect(names(rungs[1])).toEqual(['Dorian Finney-Smith', 'Cameron Johnson']);
        expect(rungs[1].players.map((p) => p.other)).toEqual([true, false]); // traded in: most of his season with the Lakers
        expect(rows.filter((w) => w.war_tier == null).map((w) => w.player_name)).toContain('Cui Cui'); // 20 possessions: off
        expect(rungs.flatMap((r) => r.players)).toHaveLength(rows.filter((w) => w.war_tier != null).length);
    });
    test("Duke: Division I against conference tiers, each from its own column", () => {
        const { rows, shape } = FIX.mbb;
        const d1 = depthLadder(rows as any, shape.filter((s) => s.scope === 'league') as any, 'league');
        const conf = depthLadder(rows as any, shape.filter((s) => s.scope === 'conference') as any, 'conference');
        expect(names(d1[0])).toEqual(['Khaman Maluach', 'Cooper Flagg', 'Kon Knueppel', 'Sion James', 'Tyrese Proctor']);
        expect(names(conf[0])).toEqual(['Khaman Maluach', 'Cooper Flagg', 'Kon Knueppel', 'Sion James']); // Proctor: an ACC Starter
        expect(conf.map((r) => r.median)).toEqual(shape.filter((s) => s.scope === 'conference').map((s) => s.players_median));
    });
    test("the bands are the producer's (roster_tier_shape pct_floor / pct_ceiling), read as copy", () => {
        // the cut points sportsdataverse-py publishes (WAR_TIERS); a drift there changes these rows and this test
        expect(FIX.nba.shape.map((s) => [s.pct_floor, s.pct_ceiling])).toEqual([[95, null], [80, 95], [50, 80], [20, 50], [0, 20]]);
        expect(depthLadder([], FIX.nba.shape as any).map((r) => r.band)).toEqual(['95 and up', '80 to under 95', '50 to under 80', '20 to under 50', 'under 20']);
        expect(bandOf(null, null)).toBeNull();
    });
    test('?tiers= is d1 unless it says conference', () => {
        expect([null, 'd1', 'conference', 'CONFERENCE', 'x'].map(parseTierView)).toEqual(['d1', 'd1', 'conference', 'd1', 'd1']);
    });
});

describe('the team page', () => {
    test("'bball-depth-ladder' is a preview flag; off, no read and no key", async () => {
        expect(FLAGS['bball-depth-ladder']).toBe('preview');
        const t = ok(await prepareBasketballTeam(fakeAstro(`/nba/team/${NETS}?season=2025`, String(NETS), OFF).astro, 'nba'));
        expect('depthLadder' in t).toBe(false);
        expect(calls).toEqual([]);
    });
    test('on: the reads, cached with the page; the pros ignore ?tiers=', async () => {
        const tt = fakeAstro(`/nba/team/${NETS}?season=2025&tiers=conference`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect(t.depthLadder?.scope).toBe('league');
        expect('depthLadderView' in t).toBe(false);
        expect(t.depthLadder?.players).toHaveLength(FIX.nba.rows.length);
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
        .map((m) => [m[1], ...[...m[2].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<span class="visually-hidden">[^<]*<\/span>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())]);
    test('the section, its link, a row per tier: band, names linked and marked, the team count and the league median', async () => {
        const html = await render(ON);
        expect(html).toContain('<a href="#depth-ladder" class="ms-2">Depth ladder</a>');
        const r = rows(html);
        expect(r.map((x) => x[0])).toEqual(TIERS);
        expect(r[0]).toEqual(['Star', 'Starpercentile 95 and up', '—', '0', '0.5']);
        expect(r[1]).toEqual(['Starter', 'Starterpercentile 80 to under 95', 'Dorian Finney-Smith*, Cameron Johnson', '2', '2.0']);
        expect(r.map((x) => x[4])).toEqual(FIX.nba.shape.map((s) => s.players_median.toFixed(1)));
        expect(html).toContain('<th scope="col" class="text-end">Team players</th>');
        expect(html).not.toContain('id="depth-ladder-tiers"'); // the pros: no toggle
        // a name links only where the roster rows (here the mocked season-player read) name the player
        expect(html).toContain('href="/nba/players/1630549'); // Day'Ron Sharpe
        expect(html).not.toContain('/nba/players/1629661'); // Cameron Johnson: no roster row in the mock
        expect(html).not.toContain('Cui Cui'); // under the possession floor
        expect(html).toContain('Most of the season with another team.');
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
    test('college: the Division I / conference toggle as select-of-URLs, the conference ladder and its median', async () => {
        const data = ladder(await retrieveDepthLadder('mbb', 2025, DUKE, 'conference'));
        const html = await container.renderToString(TeamDepthLadder, {
            props: { data, season: 2025, current: 2026, seasonQuery: '?season=2025', teamName: 'Duke Blue Devils', pages: new Set<string>(), basePath: `/mbb/team/${DUKE}`, view: 'conference' },
            locals: { league: 'mbb' } as unknown as App.Locals,
        });
        expect(html).toContain('id="depth-ladder-tiers"');
        expect(html).toContain(`<option value="/mbb/team/${DUKE}?season=2025#depth-ladder">Division I tiers</option>`);
        expect(html).toMatch(new RegExp(`<option value="/mbb/team/${DUKE}\\?season=2025&amp;tiers=conference#depth-ladder" selected[^>]*>Conference tiers</option>`));
        expect(html).toContain('data-scope="conference"');
        expect(html).toContain('Conference median');
        const r = rows(html);
        expect(r[0][2]).toBe('Khaman Maluach, Cooper Flagg, Kon Knueppel, Sion James');
        expect(r.map((x) => x[4])).toEqual(FIX.mbb.shape.filter((s) => s.scope === 'conference').map((s) => s.players_median.toFixed(1)));
    });
});
