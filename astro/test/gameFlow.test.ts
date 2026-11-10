// BB-G28: the game page's Game flow panel and the pro standings' Game flow view, behind 'bball-game-flow'. The lead chart's
// steps against sdv-db's game_flow on real games (the marks the page draws equal the producer's row), the reads (the id
// mapping, every query season-filtered and capped), the page-side gates and the templates, on real Data API reads
// (fixtures/README.md: game-flow-*.json.gz, team-season-flow-*.json.gz). Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type League = 'nba' | 'wnba' | 'mbb' | 'wbb';
interface Capture { league: League; season: number; espnGameId: string; resolve: any[]; schedule: any[]; pbp: any[]; flow: any[] }
const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const CAPTURES: Record<string, Capture> = {
    orl: gz('game-flow-nba-401909834'), // ATL 132 at ORL 125, 2026-10-31 (stats 0022600085): 22 lead changes
    det: gz('game-flow-nba-401909088'), // BOS 113 at DET 121, 2026-10-20 (stats 0022600001)
    phx: gz('game-flow-wnba-401856902'), // MIN 88 at PHX 84, 2026 (stats 1022600013)
    idst: gz('game-flow-mbb-401823353'), // Sam Houston 84 at Idaho State 81, 2025-26 (contest 6403346): 23 lead changes
    ucd: gz('game-flow-wbb-401812873'), // UC San Diego 80 at UC Davis 88 in overtime, 2025-26 (contest 6390267)
};
const SEASON_FLOW = { nba: gz('team-season-flow-nba-2026'), wnba: gz('team-season-flow-wnba-2026') };

// an unmocked read would go to the Data API with the vitest config's dummy SDV_AUTH_TOKEN (a 429 lockout for this IP):
// any fetch at all fails the file instead
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ cap: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const c = api.cap;
        if (table === 'schedule_crosswalk' || table === 'ncaa_player_box') return c.resolve;
        if (table === 'game_flow') return c.flow;
        if (table === 'team_season_flow') return c.rows;
        throw new Error(`unexpected table ${table}`);
    },
}));
// the route tests swap the game read; everything else uses the real one (through the mocked reads above)
const flowFn = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/gameFlow', async (orig) => {
    const real = await orig<typeof import('../src/resources/gameFlow')>();
    return { ...real, retrieveGameFlow: (...a: Parameters<typeof real.retrieveGameFlow>) => (flowFn.fn ? flowFn.fn(...a) : real.retrieveGameFlow(...a)) };
});
const snap = vi.hoisted(() => ({ latest: null as any, data: null as any }));
vi.mock('../src/resources/playoffPicture', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playoffPicture')>()),
    retrieveLatestProSnapshot: async () => snap.latest,
    retrieveProSnapshot: async () => snap.data,
}));
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGameFlow from '../src/components/nba/game/NbaGameFlow.astro';
import PlayoffPictureRoute from '../src/components/routes/PlayoffPictureRoute.astro';
import { EMPTY_FLOW, retrieveGameFlow, retrieveTeamSeasonFlow, type GameFlowReads } from '../src/resources/gameFlow';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { preparePlayoffPicture, viewsFor, type PlayoffPictureParams } from '../src/routes/basketball/playoffPicture';
import { FLAGS } from '../src/utils/features';
import { clockSeconds, gameSeconds, leadChanges, leadSeries, periodStart, runs } from '../src/utils/gameFlow';
import { basketball, pickRegulation } from '../src/basketball/config';

/** The capture as the page's NbaGame: its schedule row and pbp through fromDataApi (the Data API render path). */
const gameOf = (c: Capture): NbaGame => {
    const s = c.schedule[0];
    const name = (ha: 'home' | 'away') => ({ [`${ha}_display_name`]: s[`${ha}_abbreviation`], [`${ha}_location`]: s[`${ha}_abbreviation`], [`${ha}_name`]: s[`${ha}_abbreviation`] });
    return fromDataApi({ schedule: [{ ...s, ...name('home'), ...name('away'), status_type_name: 'STATUS_FINAL', date: '2026-10-31T23:00Z' }], pbp: c.pbp, team_box: [], player_box: [], play_wp: [], game_team_rates: [], game_player_rates: [] }, c.league);
};
const seriesOf = (c: Capture) => {
    const g = gameOf(c);
    const sec = pickRegulation(basketball(c.league).regulation, g.season, g.regulation).periodMinutes * 60;
    return { g, sec, series: leadSeries(g.plays, g.regulation, sec) };
};
const reads = async (c: Capture): Promise<GameFlowReads> => {
    api.cap = c;
    const s = c.schedule[0];
    return retrieveGameFlow(c.league, c.season, c.espnGameId, Number(s.home_id), Number(s.away_id));
};

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { api.calls.length = 0; api.fail = false; flowFn.fn = null; [sched, rows, proc, espn].forEach((f) => f.mockReset()); });

describe('the lead chart against the producer (every capture, both rows)', () => {
    for (const [k, c] of Object.entries(CAPTURES)) {
        test(`${k}: lead changes, times tied, biggest runs, 10-0 runs, game length and time leading equal game_flow`, () => {
            const { g, sec, series } = seriesOf(c);
            const home = c.flow.find((r) => r.is_home), away = c.flow.find((r) => !r.is_home);
            expect(leadChanges(series)).toHaveLength(home.lead_changes);
            expect(away.lead_changes).toBe(home.lead_changes);
            expect(series.filter((p, i) => i > 0 && p.margin === 0 && series[i - 1].margin !== 0)).toHaveLength(home.times_tied);
            const all = runs(series, 1);
            const best = (side: 'home' | 'away') => Math.max(0, ...all.filter((r) => r.side === side).map((r) => r.points));
            expect([best('home'), best('away')]).toEqual([home.max_run, away.max_run]);
            const ten = runs(series);
            expect([ten.filter((r) => r.side === 'home').length, ten.filter((r) => r.side === 'away').length]).toEqual([home.runs_10, away.runs_10]);
            const total = gameSeconds(g.periods, g.regulation, sec);
            expect(total).toBe(home.game_seconds);
            const ahead = series.reduce((t, p, i) => t + (p.margin > 0 ? (i + 1 < series.length ? series[i + 1].t : total) - p.t : 0), 0);
            expect(ahead).toBeCloseTo(home.lead_sec, 6);
            expect([series.at(-1)!.home, series.at(-1)!.away]).toEqual([home.pts, away.pts]);
        });
    }
});

describe('the pure steps', () => {
    test('clockSeconds: "m:ss", the last minute\'s "ss.t", junk', () => {
        expect(clockSeconds('5:32')).toBe(332);
        expect(clockSeconds('12:00')).toBe(720);
        expect(clockSeconds('45.2')).toBe(45.2);
        expect(clockSeconds('0.0')).toBe(0);
        expect(clockSeconds('')).toBeNull();
        expect(clockSeconds('end')).toBeNull();
    });
    test('periodStart / gameSeconds: quarters, halves and five-minute overtimes', () => {
        expect(periodStart(3, 4, 720)).toBe(1440);
        expect(periodStart(5, 4, 720)).toBe(2880);
        expect(periodStart(6, 4, 720)).toBe(3180);
        expect(periodStart(2, 2, 1200)).toBe(1200);
        expect(gameSeconds(4, 4, 600)).toBe(2400);
        expect(gameSeconds(5, 4, 600)).toBe(2700);
        expect(gameSeconds(2, 2, 1200)).toBe(2400);
    });
    test('runs: a score by the other side ends a run; a correction comes off the side it lowers', () => {
        const pts = (list: [number, number][]) => [{ t: 0, margin: 0, home: 0, away: 0 }, ...list.map(([home, away], i) => ({ t: i + 1, margin: home - away, home, away }))];
        expect(runs(pts([[3, 0], [6, 0], [8, 0], [10, 0], [10, 2]])).map((r) => [r.side, r.points])).toEqual([['home', 10]]);
        expect(runs(pts([[3, 0], [6, 0], [8, 0], [6, 0], [9, 0], [9, 2]]))).toEqual([]); // 8, corrected to 6, then 3 more: 9
        expect(runs(pts([[3, 0], [6, 0], [8, 0], [6, 0], [10, 0]])).map((r) => r.points)).toEqual([10]);
    });
});

describe('retrieveGameFlow', () => {
    test("the pros: the Impact box's crosswalk query, then one game_flow read of two rows", async () => {
        const r = await reads(CAPTURES.orl);
        expect(api.calls[0]).toEqual({ schema: 'nba', table: 'schedule_crosswalk', query: { season: '2027', espn_game_id: '401909834', select: 'nba_game_id,nba_home_team_id,nba_away_team_id', limit: '1' } });
        expect(api.calls[1]).toMatchObject({ schema: 'nba_stats', table: 'game_flow', query: { season: '2027', game_id: '0022600085', limit: '2' } });
        expect(api.calls).toHaveLength(2);
        expect(r.gameId).toBe('0022600085');
        expect([r.home?.team_id, r.away?.team_id]).toEqual([1610612753, 1610612737]); // ORL at home
    });
    test('the WNBA reads its own crosswalk columns and the wnba_stats schema', async () => {
        const r = await reads(CAPTURES.phx);
        expect(api.calls[0].query.select).toBe('wnba_game_id,wnba_home_team_id,wnba_away_team_id');
        expect(api.calls[1].schema).toBe('wnba_stats');
        expect(r.home?.team_id).toBe(1611661317);
    });
    test('college: the stats.ncaa.org box by the ESPN game id gives the contest; ESPN team ids pick the sides', async () => {
        const r = await reads(CAPTURES.idst);
        expect(api.calls[0]).toEqual({ schema: 'mbb', table: 'ncaa_player_box', query: { season: '2026', espn_game_id: '401823353', select: 'contest_id', limit: '1' } });
        expect(api.calls[1]).toMatchObject({ schema: 'mbb', table: 'game_flow', query: { season: '2026', game_id: '6403346', limit: '2' } });
        expect([r.home?.team_id, r.away?.team_id]).toEqual([304, 2534]);
    });
    test('an unmapped game is empty after one read; a missing side (a non-D1 opponent) is null', async () => {
        expect(await reads({ ...CAPTURES.orl, resolve: [] })).toEqual(EMPTY_FLOW);
        expect(api.calls).toHaveLength(1);
        const r = await reads({ ...CAPTURES.ucd, flow: CAPTURES.ucd.flow.filter((x) => x.is_home) });
        expect(r.home?.team_id).toBe(302);
        expect(r.away).toBeNull();
    });
    test('a failed read rejects (an outage is never an empty game)', async () => {
        api.fail = true;
        await expect(reads(CAPTURES.orl)).rejects.toThrow('down');
    });
    test('team_season_flow: one season-filtered, capped read', async () => {
        api.cap = SEASON_FLOW.nba;
        const r = await retrieveTeamSeasonFlow('nba', 2026);
        expect(api.calls).toEqual([{ schema: 'nba_stats', table: 'team_season_flow', query: { season: '2026', limit: '40' } }]);
        expect(r).toHaveLength(30);
    });
});

const gameApi = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_api.json', import.meta.url)).toString());
function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { flagOverrides: { 'bball-impact-box': false, 'bball-game-shooting': false }, ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame with the flag', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    test("'bball-game-flow' is a preview flag", () => { expect(FLAGS['bball-game-flow']).toBe('preview'); });
    test('off (no preview): no read and no flow key, so the page is today\'s', async () => {
        const fn = vi.fn(); flowFn.fn = fn; ingested();
        const r = await prepareBasketballGame(fakeAstro({}).astro, 'nba');
        expect('game' in r && !('flow' in r)).toBe(true);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read with the season and the ESPN ids, the year-long cache kept', async () => {
        const pre = await reads(CAPTURES.orl);
        const fn = vi.fn(async () => pre); flowFn.fn = fn; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        const s = gameApi().schedule[0];
        expect(fn).toHaveBeenCalledWith('nba', 2025, '401766458', Number(s.home_id), Number(s.away_id));
        expect('flow' in r && r.flow?.gameId).toBe('0022600085');
        expect('impact' in r).toBe(false); // its own flag
        expect((cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a final the products have not reached: held for the season window', async () => {
        flowFn.fn = async () => EMPTY_FLOW; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: the page renders, flow is null, nothing is cached', async () => {
        flowFn.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.flow).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const render = (game: NbaGame, flow: GameFlowReads | null, league: League) => container.renderToString(NbaGameFlow, { props: { game, flow }, locals: { league } as App.Locals });

describe('NbaGameFlow', () => {
    for (const [k, c] of Object.entries(CAPTURES)) {
        test(`${k}: the lead changes the chart marks equal the game_flow row on both teams, and the table is whole`, async () => {
            const html = await render(gameOf(c), await reads(c), c.league);
            const lc = c.flow[0].lead_changes;
            expect(html.match(/<title>Lead change: /g) ?? []).toHaveLength(lc);
            expect(html).toContain(`<strong>${lc}</strong> lead changes`);
            expect(html).toContain(`dots mark the ${lc} lead changes`);
            const table = html.split('aria-label="Game flow"')[1].split('</table>')[0];
            expect(table.match(/<tr/g)).toHaveLength(12); // header + 11 rows
            expect(html).not.toMatch(/NaN|undefined|Infinity/);
        });
    }
    test('the overtime game: an OT label and five more minutes on the axis', async () => {
        const html = await render(gameOf(CAPTURES.ucd), await reads(CAPTURES.ucd), 'wbb');
        expect(html).toContain('>OT</text>');
        expect(html).toContain('>Q4</text>');
    });
    test("ORL-ATL: the 10-0 runs are shaded with each side's run (the producer has ORL 1, ATL 2)", async () => {
        const html = await render(gameOf(CAPTURES.orl), await reads(CAPTURES.orl), 'nba');
        expect((html.match(/-0 ORL run/g) ?? []).length).toBe(2); // the band's title and the description
        expect((html.match(/-0 ATL run/g) ?? []).length).toBe(4);
        expect(html).toContain('>12-0</td>'); // ATL's biggest run, the producer's max_run
    });
    test('a failed read: the chart still draws and the totals say unavailable; an unbuilt game says so', async () => {
        const g = gameOf(CAPTURES.orl);
        const down = await render(g, null, 'nba');
        expect(down).toContain('id="flow-unavailable"');
        expect(down).toContain('>Lead chart: ATL at ORL</title>');
        expect(await render(g, EMPTY_FLOW, 'nba')).toContain('id="flow-empty"');
    });
    test('a side with no row (a non-D1 opponent) keeps its column, all dashes', async () => {
        const r = await reads({ ...CAPTURES.ucd, flow: CAPTURES.ucd.flow.filter((x) => x.is_home) });
        const html = await render(gameOf(CAPTURES.ucd), r, 'wbb');
        const rowsHtml = html.split('aria-label="Game flow"')[1].split('<tbody>')[1].split('</tbody>')[0];
        const awayCells = [...rowsHtml.matchAll(/<tr>.*?<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]);
        expect(awayCells).toHaveLength(11);
        expect(awayCells.every((v) => v === '—')).toBe(true);
    });
});

describe('the standings Game flow view', () => {
    const pp = gz('playoff-picture-nba-2026');
    const params = (over: Partial<PlayoffPictureParams> = {}): PlayoffPictureParams => ({
        league: 'nba', seasons: [2026, 2027], current: 2027, view: 'flow',
        pick: { snapshot: pp.snapshot, season: 2026, fallback: false },
        data: { sims: pp.sims, standings: pp.standings, lottery: pp.lottery }, flow: SEASON_FLOW.nba.rows, ...over,
    });
    const page = (p: PlayoffPictureParams, flags: Record<string, boolean> = {}) =>
        container.renderToString(PlayoffPictureRoute, { props: { data: p }, locals: { league: p.league, preview: true, flagOverrides: flags } as App.Locals });
    test("the view is the flag's: off, the select is today's", async () => {
        expect(viewsFor('nba').map((v) => v.key)).not.toContain('flow');
        expect(viewsFor('nba', true).map((v) => v.key).at(-1)).toBe('flow');
        const off = await page(params({ view: 'standings', flow: undefined }), { 'bball-game-flow': false });
        expect(off).not.toContain('view=flow');
        const on = await page(params({ view: 'standings', flow: undefined }));
        expect(on).toContain('<option value="/nba/standings?season=2026&amp;view=flow">Game flow</option>');
    });
    test("each conference's teams with the producer's values, ranks and percentile shading", async () => {
        const html = await page(params());
        expect(html.match(/aria-label="[A-Za-z]+ Conference game flow"/g)).toHaveLength(2);
        // Atlanta (stats 1610612737): 82 games, kills_pg 6.76, rank 11, 64.5th percentile
        const atl = SEASON_FLOW.nba.rows.find((r: any) => r.team_id === 1610612737);
        const row = html.split('href="/nba/team/1610612737"')[1].split('</tr>')[0];
        expect(row).toContain(`>${atl.games}<`);
        expect(row).toContain(`title="Rank ${atl.kills_pg_rank}; ${Math.round(atl.kills_pg_pct)}th percentile; n = ${atl.kills_pg_n}"`);
        expect(row).toContain(`>${atl.kills_pg.toFixed(1)}<span class="small ms-1" style="opacity: 0.7">${atl.kills_pg_rank}</span>`);
        expect(html).toContain('id="flow-note"');
        expect(html).not.toContain('How this works'); // the sims' note is the other views'
        expect(html).not.toMatch(/NaN|undefined/);
    });
    test('a failed read and an empty season say so', async () => {
        expect(await page(params({ flow: null }))).toContain('id="flow-unavailable"');
        expect(await page(params({ flow: [] }))).toContain('id="flow-empty"');
    });
    test('preparePlayoffPicture: the flow read only for ?view=flow with the flag on; a failure keeps the page, uncached', async () => {
        snap.latest = { season: 2026, as_of_date: pp.snapshot.as_of_date };
        snap.data = { sims: pp.sims, standings: pp.standings, lottery: pp.lottery };
        const astro = (q: string, flags: Record<string, boolean> = {}) => {
            const cache: unknown[] = []; const headers = new Headers();
            return { a: { url: new URL(`https://gameonpaper.com/nba/standings?season=2026${q}`), locals: { preview: true, flagOverrides: flags }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache };
        };
        api.cap = SEASON_FLOW.nba;
        const off = await preparePlayoffPicture(astro('&view=flow', { 'bball-game-flow': false }).a, 'nba', new Date('2026-11-05T00:00:00Z'));
        expect('view' in off && off.view).toBe('standings');
        expect(api.calls).toHaveLength(0);
        const plain = await preparePlayoffPicture(astro('').a, 'nba', new Date('2026-11-05T00:00:00Z'));
        expect('flow' in plain).toBe(false);
        expect(api.calls).toHaveLength(0);
        const on = await preparePlayoffPicture(astro('&view=flow').a, 'nba', new Date('2026-11-05T00:00:00Z'));
        expect('flow' in on && on.flow).toHaveLength(30);
        expect(api.calls.map((c) => c.query)).toEqual([{ season: '2026', limit: '40' }]);
        api.fail = true;
        const x = astro('&view=flow');
        const down = await preparePlayoffPicture(x.a, 'nba', new Date('2026-11-05T00:00:00Z'));
        expect('flow' in down && down.flow).toBeNull();
        expect(x.cache.at(-1)).toBe(false);
    });
});
