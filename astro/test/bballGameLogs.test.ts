// BB-G50: the advanced game logs behind 'bball-game-logs', on real Data API reads (fixtures/README.md: game-logs-*.json.gz,
// game-set-*.json.gz). The joins are checked against the data itself: each game's box agrees with his per-game shot rows,
// and TS% recomputed from the box agrees with the producer's game_player_rates, so a wrong ESPN <-> stats game mapping
// fails. Every read is mocked and fetch throws.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

vi.stubGlobal('fetch', (input: unknown) => { throw new Error(`unmocked fetch: ${String(input)}`); });
afterAll(() => { vi.unstubAllGlobals(); });

const capture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const MPJ = capture('game-set-player-nba-2026'); // Michael Porter Jr. 2025-26, shot_player_games
const NBA_LOG = capture('game-logs-player-nba-2026');
const MBB_LOG = capture('game-logs-player-mbb-2026'); // Duke's leading shooter 2025-26 (ESPN 5041935)
const MBB_XW = capture('game-logs-xwalk-mbb-2026'); // his stats.ncaa.org side: Duke's crosswalk pairs, impact, EPV, contests
const NCAA_PID = '11195975'; // his 2025-26 stats.ncaa.org id (the crosswalk's text id)
const FLOW = capture('game-logs-flow-2026');
const NETS_BLOCK = capture('game-set-nba-2026');
const DUKE_BLOCK = capture('game-set-mbb-2026');
const asReads = (c: any) => ({ rates: c.rates, strength: c.strength[0] ?? null, games: [...c.home, ...c.away], gameRates: c.gameRates });
const PID = 1629008, COLLEGE_PID = 5041935, NETS = 1610612751, NETS_ESPN = 17, DUKE = 150;

// the Data API, answered from the captures by schema, table and key; anything else is an error (an unexpected read)
const sdv = vi.hoisted(() => ({ calls: [] as string[], fail: new Set<string>(), empty: new Set<string>() }));
vi.mock('../src/resources/sdv', async (orig) => {
    const real = await orig<typeof import('../src/resources/sdv')>();
    return { ...real, retrieveRowsFrom: async (src: { schema: string }, table: string, q: Record<string, string>, ...rest: unknown[]) => {
        const key = `${src.schema}.${table}`;
        sdv.calls.push(key);
        if (sdv.fail.has(key)) throw new Error(`503 ${key}`);
        if (sdv.empty.has(key)) return [];
        const rows: Record<string, any> = {
            'nba_stats.player_box': q.person_id === String(PID) && NBA_LOG.box,
            'nba_stats.game_player_impact': q.player_id === String(PID) && NBA_LOG.impact,
            'nba_stats.shot_quality_game': q.person_id === String(PID) && NBA_LOG.poe,
            'nba_stats.epv_player_games': q.player_id === String(PID) && NBA_LOG.epv,
            'nba.player_crosswalk': q.nba_player_id === String(PID) && NBA_LOG.xwalk,
            'nba.game_player_rates': q.athlete_id === NBA_LOG.xwalk[0].espn_athlete_id && NBA_LOG.rates,
            'nba.schedule_crosswalk': NBA_LOG.sched,
            'nba_stats.game_flow': q.team_id === String(NETS) && FLOW.nets,
            'mbb.player_box': q.athlete_id === String(COLLEGE_PID) && MBB_LOG.box,
            'mbb.game_player_rates': q.athlete_id === String(COLLEGE_PID) && MBB_LOG.rates,
            'mbb.shot_quality_game': q.person_id === String(COLLEGE_PID) && MBB_LOG.poe,
            // the crosswalk's espn_athlete_id is a bigint (a JSON number): filtered as the API does, by its digits
            'mbb.ncaa_player_crosswalk': q.espn_athlete_id !== undefined && MBB_XW.xwalk.filter((r: any) => String(r.espn_athlete_id) === q.espn_athlete_id),
            'mbb.ncaa_player_box': q.player_id === NCAA_PID && MBB_XW.contests,
            'mbb.game_player_impact': q.player_id === NCAA_PID && MBB_XW.impact,
            'mbb.epv_player_games': q.player_id === NCAA_PID && MBB_XW.epv,
            'mbb.game_flow': q.team_id === String(DUKE) && FLOW.duke,
        };
        if (rows[key]) return rows[key];
        // not a log read (the page's own reads): the real one, whose fetch throws
        sdv.calls.pop();
        return (real.retrieveRowsFrom as any)(src, table, q, ...rest);
    } };
});
const block = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: (...a: unknown[]) => block.fn(...a),
}));
const oracle = JSON.parse(readFileSync(new URL('./fixtures/nba/league_context.json', import.meta.url)).toString());
const shots = JSON.parse(readFileSync(new URL('./fixtures/nba/shots.json', import.meta.url)).toString()) as any[];
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
    retrievePlayerShots: async () => [],
    retrievePlayerGameRows: async () => MPJ.games,
    retrievePlayerSeasons: async () => [2025, 2026],
}));

import BbPlayerGameLog from '../src/components/nba/BbPlayerGameLog.astro';
import BbTeamGameLog from '../src/components/nba/BbTeamGameLog.astro';
import { playerGamesFromRows } from '../src/nba/adapters';
import { retrievePlayerGameLog, retrieveTeamGameFlow } from '../src/resources/bballGameLogs';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { pickGames } from '../src/utils/bballGameSet';
import { PLAYER_DIRS, playerLogRows, seasonShades, shadeTable, spread, teamLogRows } from '../src/utils/bballGameLogs';
import { FLAGS } from '../src/utils/features';
import { scheduleRows } from '../src/utils/teamSeason';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { sdv.calls.length = 0; sdv.fail.clear(); sdv.empty.clear(); block.fn.mockReset(); block.fn.mockResolvedValue(asReads(NETS_BLOCK)); });

const mpjGames = () => playerGamesFromRows(MPJ.games)!;
const boozerGames = () => playerGamesFromRows(MBB_LOG.games)!;
const ts = (b: any) => b.pts / (2 * (b.fga + 0.44 * b.fta));

describe('shading and spread', () => {
    test('rank among the season, best at the green end; ties share the better rank; lower-is-better flips', () => {
        expect(seasonShades([30, 10, 20, null, 30], 1)).toEqual(['hulk-bg-level-8', 'hulk-bg-level-0', 'hulk-bg-level-3', null, 'hulk-bg-level-8']);
        expect(seasonShades([30, 10, 20], -1)).toEqual(['hulk-bg-level-0', 'hulk-bg-level-7', 'hulk-bg-level-3']);
    });
    test('under three values, or an unshaded column: nothing', () => {
        expect(seasonShades([1, 2], 1)).toEqual([null, null]);
        expect(seasonShades([1, 2, 3], 0)).toEqual([null, null, null]);
    });
    test('the spread is the sample standard deviation, null under two values', () => {
        expect(spread([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
        expect(spread([5, null])).toBeNull();
    });
});

describe('player reads, NBA (Michael Porter Jr. 2025-26)', () => {
    test("every game's box agrees with his shot rows, and TS% from the box agrees with the producer's (the ESPN game mapping)", async () => {
        const reads = await retrievePlayerGameLog('nba', 2026, PID);
        expect(reads.degraded).toBe(false);
        const rows = playerLogRows(mpjGames(), reads, false);
        expect(rows).toHaveLength(MPJ.games.length);
        for (const r of rows) {
            const b = reads.box.get(r.gameId)!;
            expect(`${b.fgm}/${b.fga}`).toBe(`${r.game.makes}/${r.game.attempts}`);
            expect(r.espnGameId).toMatch(/^\d{9}$/);
        }
        const rated = rows.filter((r) => r.values.ts_pct !== null);
        expect(rated.length).toBe(rows.length);
        for (const r of rated) expect(Math.abs(ts(reads.box.get(r.gameId)!) - r.values.ts_pct!)).toBeLessThan(0.01);
        // the pros carry impact and EPV on every game he shot in
        expect(rows.every((r) => r.values.poss !== null && r.values.off_rtg !== null && r.values.poe !== null && r.values.epv !== null)).toBe(true);
    });
    test('a failed optional read blanks its columns and marks the read degraded; a failed box read throws', async () => {
        sdv.fail.add('nba_stats.epv_player_games');
        const reads = await retrievePlayerGameLog('nba', 2026, PID);
        expect(reads.degraded).toBe(true);
        expect(reads.epv.size).toBe(0);
        expect(reads.box.size).toBeGreaterThan(0);
        sdv.fail.add('nba_stats.player_box');
        await expect(retrievePlayerGameLog('nba', 2026, PID)).rejects.toThrow('503');
    });
});

describe('player reads, college (Duke 2025-26)', () => {
    test('box, rates and POE by his ESPN id; impact and EPV by his stats.ncaa.org id through the crosswalk, on every game', async () => {
        const reads = await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID);
        expect(reads.degraded).toBe(false);
        expect(sdv.calls.toSorted()).toEqual(['mbb.epv_player_games', 'mbb.game_player_impact', 'mbb.game_player_rates', 'mbb.ncaa_player_box', 'mbb.ncaa_player_crosswalk', 'mbb.player_box', 'mbb.shot_quality_game']);
        const rows = playerLogRows(boozerGames(), reads, true);
        expect(rows).toHaveLength(MBB_LOG.games.length);
        // the contest -> ESPN game join, checked on the data: the stats.ncaa.org box's points for the contest whose impact
        // row landed on a game equal ESPN's box points for that game (a shifted or swapped mapping fails)
        const ncaaPts = new Map(MBB_XW.contests.map((c: any) => [c.contest_id, c.pts]));
        for (const r of rows) {
            const b = reads.box.get(r.gameId)!;
            expect(`${b.fgm}/${b.fga}`).toBe(`${r.game.makes}/${r.game.attempts}`);
            expect(Math.abs(ts(b) - r.values.ts_pct!)).toBeLessThan(0.01);
            expect(r.values.poe).not.toBeNull();
            expect(r.espnGameId).toBe(r.gameId);
            const raw = MBB_XW.impact.filter((i: any) => i.poss === r.values.poss && i.plus_minus === r.values.plus_minus && i.off_rtg === r.values.off_rtg && i.def_rtg === r.values.def_rtg);
            expect(raw).toHaveLength(1);
            expect(ncaaPts.get(raw[0].game_id)).toBe(b.pts);
            expect(r.values.epv).toBe(MBB_XW.epv.find((e: any) => e.game_id === raw[0].game_id).epv_own);
        }
    });
    test('no crosswalk pair: no impact or EPV read and those columns blank; a failed crosswalk read marks the read degraded', async () => {
        sdv.empty.add('mbb.ncaa_player_crosswalk');
        const none = await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID);
        expect(sdv.calls).not.toContain('mbb.game_player_impact');
        expect(sdv.calls).not.toContain('mbb.ncaa_player_box');
        expect([none.impact.size, none.epv.size, none.degraded]).toEqual([0, 0, false]);
        expect(none.box.size).toBe(MBB_LOG.box.length);
        sdv.empty.clear();
        sdv.fail.add('mbb.ncaa_player_crosswalk');
        const failed = await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID);
        expect([failed.impact.size, failed.epv.size, failed.degraded]).toEqual([0, 0, true]);
        expect(failed.rates.size).toBe(MBB_LOG.rates.length);
    });
    test('the contest map read failed: impact and EPV cannot be placed, so they stay blank and the read is degraded', async () => {
        sdv.fail.add('mbb.ncaa_player_box');
        const reads = await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID);
        expect([reads.impact.size, reads.epv.size, reads.degraded]).toEqual([0, 0, true]);
    });
});

describe('team flow', () => {
    test("NBA (Nets): every final maps through the crosswalk, and the flow row's score is the schedule's", async () => {
        const sched = scheduleRows(asReads(NETS_BLOCK).games, NETS_BLOCK.gameRates, NETS_ESPN);
        const flow = await retrieveTeamGameFlow('nba', 2026, NETS, NETS_ESPN, sched);
        const finals = sched.filter((g) => g.completed);
        expect(finals.every((g) => flow.has(g.gameId))).toBe(true);
        const toStats = new Map(NBA_LOG.sched.map((x: any) => [x.espn_game_id, x.nba_game_id]));
        for (const g of finals) {
            const raw = FLOW.nets.find((f: any) => f.game_id === toStats.get(g.gameId));
            expect([raw.pts, raw.opp_pts]).toEqual([g.teamScore, g.oppScore]);
            expect(flow.get(g.gameId)!.lead_pct).toBe(raw.lead_pct);
        }
    });
    test('college (Duke): matched by opponent and score, every final', async () => {
        const sched = scheduleRows(asReads(DUKE_BLOCK).games, DUKE_BLOCK.gameRates, DUKE);
        const flow = await retrieveTeamGameFlow('mbb', 2026, DUKE, DUKE, sched);
        expect(sched.filter((g) => g.completed).every((g) => flow.has(g.gameId))).toBe(true);
    });
});

const fakeAstro = (path: string, id: string, locals: Record<string, unknown>) =>
    ({ params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
const ok = <T,>(r: T) => { if (r && typeof r === 'object' && ('notFound' in r || 'unavailable' in r)) throw new Error(JSON.stringify(r)); return r as Exclude<T, { notFound: true } | { unavailable: true }>; };
const OFF = { preview: true, flagOverrides: { 'bball-game-logs': false } };

describe('the flag', () => {
    test("'bball-game-logs' is a preview flag", () => { expect(FLAGS['bball-game-logs']).toBe('preview'); });
    test('off: no log read, no key, on either page', async () => {
        const p = ok(await prepareNbaPlayer(fakeAstro(`/nba/players/${PID}?season=2026`, String(PID), OFF)));
        const t = ok(await prepareNbaTeam(fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), OFF)));
        expect(sdv.calls).toEqual([]);
        expect('gameLog' in p).toBe(false);
        expect('teamFlow' in t).toBe(false);
    });
    test('on: the player log and the team flow are read', async () => {
        const p = ok(await prepareNbaPlayer(fakeAstro(`/nba/players/${PID}?season=2026`, String(PID), { preview: true })));
        expect(p.gameLog?.box.size).toBeGreaterThan(0);
        const t = ok(await prepareNbaTeam(fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), { preview: true })));
        expect(t.teamFlow?.size).toBeGreaterThan(0);
    });
    test("team, on but 'bball-team-season' off: no flow read", async () => {
        const t = ok(await prepareNbaTeam(fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), { preview: true, flagOverrides: { 'bball-team-season': false } })));
        expect(sdv.calls).toEqual([]);
        expect('teamFlow' in t).toBe(false);
    });
});

const render = (C: any, props: Record<string, unknown>, league: string, path: string) =>
    container.renderToString(C, { props, request: new Request(`https://gameonpaper.com${path}`), locals: { league } as App.Locals });

describe('the logs', () => {
    test('player, NBA: every column, shaded cells, the consistency line; last 5 shows five games still shaded against the season', async () => {
        const reads = await retrievePlayerGameLog('nba', 2026, PID);
        const html = await render(BbPlayerGameLog, { games: mpjGames(), reads }, 'nba', `/nba/players/${PID}`);
        for (const h of ['TS%', 'USG%', 'Poss', '+/-', 'ORtg', 'DRtg', 'POE', 'EPV+', '>FG<', '>3P<', '>FT<']) expect(html).toContain(h);
        expect(html).toMatch(/hulk-bg-level-\d/);
        expect(html).toContain('id="player-game-log-consistency"');
        expect(html.match(/<tr data-game=/g)).toHaveLength(MPJ.games.length);
        const last5 = await render(BbPlayerGameLog, { games: mpjGames(), reads, set: 'last5' }, 'nba', `/nba/players/${PID}?games=last5`);
        expect(last5.match(/<tr data-game=/g)).toHaveLength(5);
        // the shading is the season's: a last-5 row's cells are the full log's cells for the same game
        const id = pickGames(mpjGames(), 'last5')[0].game_id;
        const row = (h: string) => h.split(`data-game="${id}"`)[1].split('</tr>')[0];
        expect(row(last5)).toBe(row(html));
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('player, college: impact and EPV columns through the crosswalk; with no pair they are left out', async () => {
        const reads = await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID);
        const html = await render(BbPlayerGameLog, { games: boozerGames(), reads }, 'mbb', `/mbb/players/${COLLEGE_PID}`);
        for (const h of ['TS%', 'POE', 'Poss', '+/-', 'ORtg', 'DRtg', 'EPV+']) expect(html).toContain(h);
        expect(html).not.toContain('NaN');
        sdv.empty.add('mbb.ncaa_player_crosswalk');
        const unpaired = await render(BbPlayerGameLog, { games: boozerGames(), reads: await retrievePlayerGameLog('mbb', 2026, COLLEGE_PID) }, 'mbb', `/mbb/players/${COLLEGE_PID}`);
        expect(unpaired).toContain('POE');
        for (const h of ['ORtg', 'EPV+', '+/-']) expect(unpaired).not.toContain(`>${h}<`);
    });
    test('player, the box read failed: the log says so', async () => {
        const html = await render(BbPlayerGameLog, { games: mpjGames(), reads: null }, 'nba', `/nba/players/${PID}`);
        expect(html).toContain('id="player-game-log-unavailable"');
    });
    test('team, NBA: ratings, four factors and flow per game; a failed flow read leaves the flow columns out', async () => {
        const sched = scheduleRows(asReads(NETS_BLOCK).games, NETS_BLOCK.gameRates, NETS_ESPN);
        const flow = await retrieveTeamGameFlow('nba', 2026, NETS, NETS_ESPN, sched);
        const props = { data: asReads(NETS_BLOCK), season: 2026, espnId: NETS_ESPN };
        const html = await render(BbTeamGameLog, { ...props, flow }, 'nba', `/nba/team/${NETS}`);
        for (const h of ['ORtg', 'eFG%', 'FT rate', 'Led', 'Lead chg', 'Big lead', 'Best run']) expect(html).toContain(`>${h}<`);
        expect(html.match(/<tr data-game=/g)).toHaveLength(sched.filter((g) => g.completed && g.rates).length);
        expect(html).toContain('id="team-game-log-consistency"');
        const without = await render(BbTeamGameLog, { ...props, flow: null }, 'nba', `/nba/team/${NETS}`);
        expect(without).not.toContain('>Best run<');
        expect(without).toContain('game-flow numbers are temporarily unavailable');
    });
    test('the shading is a function of the season rows alone', () => {
        const rows = teamLogRows(scheduleRows(asReads(DUKE_BLOCK).games, DUKE_BLOCK.gameRates, DUKE), new Map());
        const s = shadeTable(rows, { pts: 1 } as any);
        const best = rows.reduce((a, b) => (b.values.pts! > a.values.pts! ? b : a));
        expect(s.get(best.gameId)!.pts).toBe('hulk-bg-level-9');
        expect(PLAYER_DIRS.tov).toBe(-1);
    });
});
