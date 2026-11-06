// BB-G27: the leaderboards' WAR and VORP board and points over expected board, behind 'bball-war-boards' inside BB-G8's
// 'bball-leaderboards-v2'. The flag gates the boards (off: BB-G8's three, nothing else read); the reads' exact queries and
// selects (every column one the real rows carry); WAR never shown without its 90% interval; the qualified gates; the
// producer's VORP / WAR percentiles; the impact board dropping player_impact's WAR; a 404 before player_war's backfill is
// the unavailable line, never cached. On real producer output and a live read (fixtures/README.md: war-boards-2026.json.gz).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// no network: an unmocked Data API read (vitest's dummy SDV_AUTH_TOKEN) fails auth and locks the IP out, so any fetch
// throws, is recorded, and fails the file
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = Record<string, any>;
const WB = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/war-boards-2026.json.gz', import.meta.url))).toString()) as Record<'nbaWar' | 'mbbWar' | 'nbaPoe', Row[]>;
const LB = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/leaderboards-v2-2026.json.gz', import.meta.url))).toString()) as Record<string, Row[]>;

const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
const shots = vi.hoisted(() => ({ players: vi.fn() }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: (...a: unknown[]) => shots.players(...a) }));

import { retrieveBoard, selectFor, BOARD_CAP, IMPACT_FLOOR, POE_FLOOR, POE_IDENTITY, VALUE_IDENTITY } from '../src/resources/leaderboards';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { prepareLeaderboards } from '../src/routes/basketball/leaderboards';
import BasketballLeaderboardsRoute from '../src/components/routes/BasketballLeaderboardsRoute.astro';
import { BOARDS, boardSpec, boardsFor, IMPACT_QUALIFIED_POSS, isQualified, parseControls, POE_QUALIFIED_FGA, WAR_BOARDS } from '../src/utils/leaderboards';
import { FLAGS } from '../src/utils/features';
import { leagueSource, type BasketballLeague } from '../src/utils/league';

/** What the Data API answers each read, from the captures. */
function serve(schema: string, table: string): Row[] {
    const t: Record<string, Row[]> = {
        'nba_stats:player_war': WB.nbaWar, 'mbb:player_war': WB.mbbWar, 'nba_stats:shot_quality_season': WB.nbaPoe, 'nba:player_impact': LB.nbaImpact,
    };
    const rows = t[`${schema}:${table}`];
    if (!rows) throw new Error(`no capture for ${schema}:${table}`);
    return rows;
}
beforeEach(() => {
    sdv.rows.mockReset(); sdv.from.mockReset(); shots.players.mockReset();
    sdv.rows.mockImplementation(async (lg: string, table: string) => serve(leagueSource(lg as BasketballLeague).schema, table));
    sdv.from.mockImplementation(async (src: { schema: string }, table: string) => serve(src.schema, table));
    shots.players.mockImplementation(async () => LB.nbaNames);
});

const fakeAstro = (lg: BasketballLeague, query: string, war = true) => ({
    params: {}, url: new URL(`https://gameonpaper.com/${lg}/leaderboards${query}`),
    locals: { preview: true, flagOverrides: { 'bball-leaderboards-v2': true, 'bball-war-boards': war } }, cache: { set: vi.fn() }, response: { headers: new Headers() },
}) as any;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function board(lg: BasketballLeague, query: string, war = true) {
    const A = fakeAstro(lg, query, war);
    const data = await prepareLeaderboards(A, lg);
    const html = await container.renderToString(BasketballLeaderboardsRoute, { props: { data }, locals: { league: lg, preview: true } as App.Locals });
    return { data, html, A };
}
/** The table's body cells, one array per row (the identity cell first), as text. */
const cells = (html: string) => [...html.matchAll(/<tr[^>]*>\s*(<td[\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
const col = (data: Awaited<ReturnType<typeof board>>['data'], key: string) => 1 + data.spec.cols.findIndex((c) => c.key === key);
const options = (html: string) => [...html.match(/<select id="lb-board"[\s\S]*?<\/select>/)![0].matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);

describe('the captures', () => {
    test("player_war: every WAR inside its interval; ranked by the producer; the headline the pros' sources' mean", () => {
        for (const r of [...WB.nbaWar, ...WB.mbbWar]) {
            expect(r.war_lo).toBeLessThanOrEqual(r.war);
            expect(r.war_hi).toBeGreaterThanOrEqual(r.war);
            expect(r.war_pct).not.toBeNull();
        }
        for (const r of WB.nbaWar) expect((r.war_bpm + r.war_rapm + r.war_boban) / 3).toBeCloseTo(r.war, 9);
        // the read's own order and floor: most possessions first, none under the floor
        expect(WB.nbaWar.every((r, i) => r.poss >= IMPACT_FLOOR.nba && (i === 0 || WB.nbaWar[i - 1].poss >= r.poss))).toBe(true);
    });
    test('shot_quality_season: POE is PTS minus xPTS on every row', () => {
        for (const r of WB.nbaPoe) expect(r.pts - r.xpts).toBeCloseTo(r.poe, 6);
        expect(WB.nbaPoe.every((r) => r.attempts >= POE_FLOOR.nba)).toBe(true);
    });
});

describe('the flag', () => {
    test("is 'preview'", () => expect(FLAGS['bball-war-boards']).toBe('preview'));
    test("off: BB-G8's three boards; ?board=value is the impact board, and neither table is read", async () => {
        expect(boardsFor(false)).toEqual(['impact', 'teams', 'lineups']);
        expect(boardsFor(true)).toEqual([...BOARDS]);
        for (const b of WAR_BOARDS) {
            const { data, html } = await board('nba', `?board=${b}`, false);
            expect(data.controls.board).toBe('impact');
            expect(options(html)).toEqual(['Players: Impact', 'Teams', 'Lineups', 'Players: Shooting (rolling)']);
            expect(data.spec.cols.map((c) => c.key)).toContain('war'); // BB-G8's impact board, its WAR column kept
            expect(html).toContain('Per 100 possessions, WAR in wins.');
        }
        expect(sdv.from.mock.calls.map((c) => c[1])).toEqual(['player_impact', 'player_impact']);
    });
    test("on: the two boards in the select; the impact board drops player_impact's WAR", async () => {
        const { data, html } = await board('nba', '');
        expect(options(html)).toEqual(['Players: Impact', 'Teams', 'Lineups', 'Players: WAR and VORP', 'Players: Points over expected', 'Players: Shooting (rolling)']);
        expect(data.spec.cols.map((c) => c.key)).not.toContain('war');
        expect(html).toContain('Per 100 possessions.</p>');
        expect(html).not.toContain('WAR in wins');
    });
});

describe('the reads', () => {
    test("value: the season schema's player_war, the floor, most possessions first, capped, strict and bounded", async () => {
        await retrieveBoard('nba', 2026, 'value', 'ratings', 5, true);
        const [src, table, q, ttl, strict, timeout] = sdv.from.mock.calls[0];
        expect([src.schema, table, ttl, strict, timeout]).toEqual(['nba_stats', 'player_war', 21600, true, NBA_READ_TIMEOUT_MS]);
        expect(q).toMatchObject({ season: '2026', poss__gte: String(IMPACT_FLOOR.nba), order: '-poss', limit: String(BOARD_CAP) });
        await retrieveBoard('mbb', 2026, 'value', 'ratings', 5, true);
        expect(sdv.from.mock.calls[1][0].schema).toBe('mbb');
    });
    test('poe: the player rows over the floor, most attempts first; named from the season players', async () => {
        const r = await retrieveBoard('nba', 2026, 'poe', 'ratings', 5, true);
        const [src, table, q, , strict, timeout] = sdv.from.mock.calls[0];
        expect([src.schema, table, strict, timeout]).toEqual(['nba_stats', 'shot_quality_season', true, NBA_READ_TIMEOUT_MS]);
        expect(q).toMatchObject({ season: '2026', level: 'player', attempts__gte: String(POE_FLOOR.nba), order: '-attempts', limit: String(BOARD_CAP) });
        expect(shots.players).toHaveBeenCalledWith(2026, 'nba');
        expect(r.names.get(String(LB.nbaNames[0].person_id))).toBe(LB.nbaNames[0].player_name);
    });
    // the Data API answers a select naming a missing column with a 400: every column asked for is one the producer ships
    test('every select names only columns the real rows have (pros and college)', async () => {
        const missing = (rows: Row[], select: string) => select.split(',').filter((c) => !(c in rows[0]));
        for (const [lg, rows] of [['nba', WB.nbaWar], ['mbb', WB.mbbWar]] as const) {
            sdv.from.mockClear();
            await retrieveBoard(lg, 2026, 'value', 'ratings', 5, true);
            expect(missing(rows, sdv.from.mock.calls[0][2].select)).toEqual([]);
            expect(sdv.from.mock.calls[0][2].select).toContain('war_lo,war_hi');
        }
        expect(missing(WB.nbaPoe, selectFor(boardSpec('poe', 'nba', 'ratings'), POE_IDENTITY, false))).toEqual([]);
        expect(VALUE_IDENTITY).toContain('player_name');
    });
});

describe('the WAR and VORP board', () => {
    test('WAR beside its 90% interval on every row, most WAR first, qualified by on-court possessions', async () => {
        const { data, html } = await board('nba', '?season=2026&board=value');
        const keys = data.spec.cols.map((c) => c.key);
        expect(keys.slice(keys.indexOf('war'), keys.indexOf('war') + 3)).toEqual(['war', 'war_lo', 'war_hi']);
        expect(data.rows!.length).toBe(WB.nbaWar.filter((r) => r.poss >= IMPACT_QUALIFIED_POSS.nba).length);
        expect(data.rows!.every((r) => isQualified(r, data.spec, 'nba'))).toBe(true);
        const rows = cells(html);
        const [w, lo, hi] = ['war', 'war_lo', 'war_hi'].map((k) => col(data, k));
        for (const r of rows) {
            expect(Number(r[lo])).toBeLessThanOrEqual(Number(r[w]));
            expect(Number(r[hi])).toBeGreaterThanOrEqual(Number(r[w]));
        }
        const best = [...WB.nbaWar].sort((a, b) => b.war - a.war)[0];
        expect(rows[0][0]).toContain(best.player_name);
        expect(rows[0][w]).toBe(best.war.toFixed(1));
        expect([rows[0][lo], rows[0][hi]]).toEqual([best.war_lo.toFixed(1), best.war_hi.toFixed(1)]);
        expect(html).toContain('WAR in wins with its 90% interval (Low to High).');
        expect(html).toContain(`href="/nba/players/${best.player_id}`);
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test("the producer's VORP and WAR percentiles shade and fill the Percentiles view; the interval is never shaded", async () => {
        const v = await board('nba', '?season=2026&board=value');
        expect(v.data.pctAvailable).toBe(true);
        expect(v.html).toContain('id="lb-view"');
        expect(v.html).toMatch(/hulk-bg-level-9[^>]*title="Rank 1, percentile/);
        const p = await board('nba', '?season=2026&board=value&view=percentiles');
        const top = cells(p.html)[0];
        expect(Number(top[col(p.data, 'war')])).toBeGreaterThan(99);
        expect(top[col(p.data, 'war_lo')]).toBe('—'); // the interval has no percentile: a dash, never another column's
    });
    test('all players: everyone read; a player who changed teams says how many', async () => {
        const { data, html } = await board('nba', '?season=2026&board=value&qualified=all');
        expect(data.rows!.length).toBe(WB.nbaWar.length);
        const moved = WB.nbaWar.find((r) => r.teams > 1);
        if (moved) expect(html).toContain(` +${moved.teams - 1}</span>`);
    });
    test('college: no source columns, linked by ESPN id', async () => {
        const { data, html } = await board('mbb', '?season=2026&board=value');
        expect(data.spec.cols.map((c) => c.key)).not.toContain('war_bpm');
        expect(html).toContain(`href="/mbb/players/${data.rows![0].player_id}`);
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('a 404 before the backfill: the unavailable line, never cached', async () => {
        sdv.from.mockRejectedValue(Object.assign(new Error('404 player_war'), { status: 404 }));
        const { html, A } = await board('nba', '?board=value');
        expect(html).toContain('id="lb-unavailable"');
        expect(A.cache.set).toHaveBeenCalledWith(false);
    });
    test('no rows yet: the empty line, never cached', async () => {
        sdv.from.mockResolvedValue([]);
        const { html, A } = await board('nba', '?board=value');
        expect(html).toContain('id="lb-empty"');
        expect(A.cache.set).toHaveBeenCalledWith(false);
    });
});

describe('the points over expected board', () => {
    test('most POE first, qualified by FGA, named and linked, unshaded (the producer ranks none)', async () => {
        const { data, html } = await board('nba', '?season=2026&board=poe');
        expect(data.rows!.length).toBe(WB.nbaPoe.filter((r) => r.attempts >= POE_QUALIFIED_FGA.nba).length);
        expect(data.rows!.map((r) => r.poe)).toEqual([...data.rows!.map((r) => r.poe)].sort((a, b) => Number(b) - Number(a)));
        expect(data.pctAvailable).toBe(false);
        expect(html).not.toContain('hulk-bg-level');
        const named = new Map(LB.nbaNames.map((p) => [String(p.person_id), p.player_name]));
        const top = data.rows![0];
        const row = cells(html)[0];
        expect(row[0]).toContain(named.get(String(top.person_id)) ?? `#${top.person_id}`);
        expect(row[0]).toContain(top.team_tricode);
        expect(row[col(data, 'poe')]).toMatch(/^\+\d/);
        expect(html).toContain('Field goals only: free throws are not shots in the model.');
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test("FG% over expected in percentage points, as the player page's line prints it", async () => {
        const { data, html } = await board('nba', '?season=2026&board=poe&sort=fg_pct_oe');
        const top = Number(data.rows![0].fg_pct_oe);
        expect(cells(html)[0][col(data, 'fg_pct_oe')]).toBe(`${top >= 0 ? '+' : '−'}${Math.abs(top * 100).toFixed(1)}`);
    });
    test('the controls whitelist the new boards only with the flag', () => {
        expect(parseControls(new URLSearchParams('board=poe'), 'nba', () => true, true).board).toBe('poe');
        expect(parseControls(new URLSearchParams('board=poe'), 'nba', () => true, false).board).toBe('impact');
        expect(parseControls(new URLSearchParams('board=value'), 'nba', () => true, true).sort).toBe('war');
    });
});
