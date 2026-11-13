// BB-G2: the game page's garbage-time toggle behind 'bball-garbage-time'. The split against sdv-py's own situational
// splits for the same game (the producer's `not_garbage_time` rows, BB-D21), the read, the route's gate, and the page:
// toggle shown, hidden, and the flag-off page byte for byte. Fixtures (fixtures/README.md: garbage-time-*.json.gz) are
// real possession logs with BB-D7's flags from sportsdataverse-py. Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

interface Capture {
    league: 'nba' | 'wnba' | 'wbb'; game_id: string; espnGameId: string | null; teams: { home: number; away: number }
    possessions: Record<string, any>[]; names: Record<string, any>[]
    oracle: Record<'team' | 'player' | 'lineup', Record<string, any>[]>
}
const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const G = {
    nba24: gz('garbage-time-nba-0022300718') as Capture, // TOR 100 at NOP 138, 2023-24: 53 of 193 possessions garbage time
    wbb: gz('garbage-time-wbb-401824983') as Capture, // GW 50 at Temple 86, 2025-26 (contest 6387150): 14 of 140
    wnba: gz('garbage-time-wnba-1022600001') as Capture, // CON 75 at NY 106, 2026: no garbage time (bigballR's starters rule)
    nba27: gz('garbage-time-nba-0022600001') as Capture, // BOS 113 at DET 121, 2026-27: none
};
const wbbImpact = gz('impact-box-wbb-2026'); // BB-G1's reads for the same WBB game

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: [] as any[], crosswalk: [] as any[], splits: [] as any[], box: [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'schedule_crosswalk') return api.crosswalk;
        if (table === 'possessions' || table === 'ncaa_possessions') return api.rows;
        if (table === 'situational_team_games') return api.splits;
        if (table === 'ncaa_team_box') return api.box;
        throw new Error(`unexpected table ${table}`);
    },
}));
const hooks = vi.hoisted(() => ({ impact: null as null | ((...a: unknown[]) => unknown), garbage: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/impactBox', async (orig) => {
    const real = await orig<typeof import('../src/resources/impactBox')>();
    return { ...real, retrieveImpactBox: (...a: unknown[]) => hooks.impact!(...a) };
});
vi.mock('../src/resources/garbageTime', async (orig) => {
    const real = await orig<typeof import('../src/resources/garbageTime')>();
    return { ...real, retrieveGarbageTime: (...a: Parameters<typeof real.retrieveGarbageTime>) => (hooks.garbage ? hooks.garbage(...a) : real.retrieveGarbageTime(...a)) };
});
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));
// BB-G43's market row ('bball-lines', preview, live or final): no row, never a read
vi.mock('../src/resources/gameLines', async (orig) => ({ ...(await orig<typeof import('../src/resources/gameLines')>()), retrieveGameLine: async () => null }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { EMPTY_IMPACT, type ImpactBoxReads } from '../src/resources/impactBox';
import { retrieveGarbageTime, type GarbageReads } from '../src/resources/garbageTime';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { garbageView, hasGarbageFlag, isOut, ncaaPossessions, proPossessions, splitTotals, type SplitPossession } from '../src/utils/garbageTime';

const log = (c: Capture): SplitPossession[] => (c.league === 'wbb' ? ncaaPossessions(c.possessions) : proPossessions(c.possessions, 4, c.league === 'nba' ? 720 : 600));
/** the log and the producer's per-game team splits for the game (the oracle's team rows are situational_team_games' rows) */
const reads = (c: Capture): GarbageReads => ({ teams: c.teams, rows: c.possessions, splits: c.oracle.team as any });
const STATS = ['poss', 'opp_poss', 'pts', 'opp_pts', 'plus_minus'] as const;
const RATES = ['seconds', 'minutes', 'off_rtg', 'def_rtg', 'net_rtg'] as const;
function same(got: Record<string, any>, want: Record<string, any>) {
    for (const k of STATS) expect(got[k], k).toBe(want[k]);
    for (const k of RATES) want[k] == null ? expect(got[k], k).toBeNull() : expect(got[k], k).toBeCloseTo(want[k], 9);
}

describe('the split is the producer\'s (sdv-py situational_team / _player / _lineup on the same log)', () => {
    const splits = [['all', () => true], ['not_garbage_time', isOut], ['garbage_time', (p: SplitPossession) => p.garbage === true]] as const;
    for (const name of ['nba24', 'wbb'] as const) {
        test(`${name}: every team, player and unit, all and either side of garbage time`, () => {
            const c = G[name];
            for (const [split, keep] of splits) {
                const s = splitTotals(log(c), keep);
                const want = (kind: 'team' | 'player' | 'lineup') => c.oracle[kind].filter((r) => r.split === split);
                expect(s.teams).toHaveLength(want('team').length);
                for (const w of want('team')) same(s.teams.find((t) => t.team_id === w.team_id)!, w);
                expect(s.players).toHaveLength(want('player').length);
                for (const w of want('player')) same(s.players.find((p) => p.team_id === w.team_id && String(p.player_id) === String(w.player_id))!, w);
                expect(s.lineups).toHaveLength(want('lineup').length);
                for (const w of want('lineup')) {
                    const u = s.lineups.find((l) => l.team_id === w.team_id && l.lineup_id === w.lineup_id)!;
                    same(u, w);
                    expect(u.players.map(String)).toEqual([1, 2, 3, 4, 5].map((i) => String(w[`player_${i}`])));
                }
            }
        });
    }
    test('the college fixture: Temple 78-42 over 64 possessions with garbage time out, the producer\'s row', () => {
        const t = splitTotals(log(G.wbb), isOut).teams.find((x) => x.team_id === 218)!;
        expect([t.poss, t.pts, t.opp_pts]).toEqual([64, 78, 42]);
        expect(t.off_rtg).toBeCloseTo(G.wbb.oracle.team.find((r) => r.team_id === 218 && r.split === 'not_garbage_time')!.off_rtg, 9);
    });
    test('the pros\' counts: All is the stats.nba.com box (FG 53-104 and 40-84, 3PA 45 and 31), points the final 138-100', () => {
        const s = splitTotals(log(G.nba24), () => true);
        const nop = s.teams.find((t) => t.team_id === 1610612740)!, tor = s.teams.find((t) => t.team_id === 1610612761)!;
        expect([nop.counts!.fgm, nop.counts!.fga, nop.counts!.fg3a, nop.pts]).toEqual([53, 104, 45, 138]);
        expect([tor.counts!.fgm, tor.counts!.fga, tor.counts!.fg3a, tor.pts]).toEqual([40, 84, 31, 100]);
    });
    test('a rate is the summed counts divided once (eFG% of the split, not a mean of possessions)', () => {
        const v = garbageView(reads(G.nba24), impactFor(G.nba24), true, 'nba', 4, 12)!;
        const kept = log(G.nba24).filter((p) => p.garbage === false && p.offense === 1610612740);
        const sum = (k: 'fgm' | 'fg3m' | 'fga') => kept.reduce((t, p) => t + p.counts![k], 0);
        expect(v.rates!.home.out!.efg_pct).toBe((sum('fgm') + 0.5 * sum('fg3m')) / sum('fga'));
    });
});

/** BB-G1's whole-game reads for a fixture: the WBB game's real capture; the 2023-24 NBA game (no BB-G1 capture) gets the stats box's names and the producer's whole-game player rows. */
function impactFor(c: Capture): ImpactBoxReads {
    if (c === G.wbb) return { gameId: c.game_id, teams: c.teams, players: wbbImpact.players, lineups: { home: wbbImpact.home, away: wbbImpact.away }, names: wbbImpact.box.filter((r: any) => r.player_id).map((r: any) => ({ player_id: String(r.player_id), name: r.clean_name })), pageIds: null, pages: new Set() };
    return { gameId: c.game_id, teams: c.teams, players: c.oracle.player.filter((r) => r.split === 'all') as any, lineups: { home: [], away: [] }, names: c.names.map((r) => ({ player_id: String(r.person_id), name: `${r.first_name} ${r.family_name}` })), pageIds: null, pages: new Set() };
}

describe('garbageView', () => {
    test('no toggle: a game with no garbage time, a log without the flag (a release before BB-D7), an unmapped game, no Impact box', () => {
        for (const c of [G.wnba, G.nba27]) {
            expect(c.possessions.every((r) => r.is_garbage_time === false)).toBe(true);
            expect(garbageView(reads(c), impactFor(G.nba24), true, c.league, 4, 12)).toBeUndefined();
        }
        const unflagged = G.nba24.possessions.map(({ is_garbage_time, is_transition, seconds_to_first_shot, ...r }) => r);
        expect(hasGarbageFlag(unflagged)).toBe(false);
        expect(garbageView({ teams: G.nba24.teams, rows: unflagged, splits: [] }, impactFor(G.nba24), true, 'nba', 4, 12)).toBeUndefined();
        // one unclassified possession: All would no longer be the whole log, so there is no split to show
        const partly = G.nba24.possessions.map((r, i) => (i === 0 ? { ...r, is_garbage_time: null } : r));
        expect(hasGarbageFlag(partly)).toBe(false);
        expect(garbageView({ teams: G.nba24.teams, rows: partly, splits: [] }, impactFor(G.nba24), true, 'nba', 4, 12)).toBeUndefined();
        expect(garbageView({ teams: null, rows: [], splits: [] }, impactFor(G.nba24), true, 'nba', 4, 12)).toBeUndefined();
        expect(garbageView(reads(G.nba24), EMPTY_IMPACT, true, 'nba', 4, 12)).toBeUndefined();
        expect(garbageView(reads(G.nba24), null, true, 'nba', 4, 12)).toBeUndefined();
    });
    test('a failed read: nothing without the parameter, "unavailable" with it', () => {
        expect(garbageView(null, impactFor(G.nba24), false, 'nba', 4, 12)).toBeUndefined();
        expect(garbageView(null, impactFor(G.nba24), true, 'nba', 4, 12)?.unavailable).toBe(true);
    });
    test('the toggle alone without ?garbage=out: where garbage time starts and how much of the log it is', () => {
        const v = garbageView(reads(G.nba24), impactFor(G.nba24), false, 'nba', 4, 12)!;
        expect([v.excluded, v.total, v.rates, v.impact]).toEqual([53, 193, undefined, undefined]);
        expect(v.start!.period).toBeGreaterThanOrEqual(3);
    });
    test('?garbage=out, the pros: the four factors and box rows for all and out, the Impact box from the split', () => {
        const v = garbageView(reads(G.nba24), impactFor(G.nba24), true, 'nba', 4, 12)!;
        expect(v.rates!.home.out!.possessions).toBe(70);
        expect(v.rates!.home.out!.off_rtg).toBeCloseTo(155.714, 3);
        expect(v.box!.home.all!.pts).toBe(138);
        expect(v.box!.home.out!.pts).toBe(109);
        expect(v.box!.away.out!.pts).toBe(74);
        const want = G.nba24.oracle.player.filter((r) => r.split === 'not_garbage_time');
        expect(v.impact!.players).toHaveLength(want.length);
        // each side's units are the producer's not_garbage_time lineups, its five most-used (by seconds, then id)
        for (const side of ['home', 'away'] as const) {
            const top = G.nba24.oracle.lineup.filter((r) => r.split === 'not_garbage_time' && r.team_id === G.nba24.teams[side])
                .sort((a, b) => b.seconds - a.seconds || (a.lineup_id < b.lineup_id ? -1 : a.lineup_id > b.lineup_id ? 1 : 0)).slice(0, 5);
            expect(top).toHaveLength(5);
            expect(v.impact!.lineups[side].map((u) => u.lineup_id)).toEqual(top.map((r) => r.lineup_id));
            v.impact!.lineups[side].forEach((u, i) => same(u, top[i]));
        }
    });
    test("?garbage=out: Possessions, ORtg and DRtg are situational_team_games' rows as published; pace stays on the log", () => {
        const want = (team: number, split: string) => G.nba24.oracle.team.find((r) => r.team_id === team && r.split === split)!;
        const v = garbageView(reads(G.nba24), impactFor(G.nba24), true, 'nba', 4, 12)!;
        for (const side of ['home', 'away'] as const) {
            for (const [k, split] of [['all', 'all'], ['out', 'not_garbage_time']] as const) {
                const r = v.rates![side][k]!, w = want(G.nba24.teams[side], split);
                expect([r.possessions, r.off_rtg, r.def_rtg]).toEqual([w.poss, w.off_rtg, w.def_rtg]);
            }
        }
        // a published row is shown as published, never re-derived from the log
        const bumped = { ...reads(G.nba24), splits: G.nba24.oracle.team.map((r) => ({ ...r, poss: r.poss + 1000 })) };
        expect(garbageView(bumped, impactFor(G.nba24), true, 'nba', 4, 12)!.rates!.home.out!.possessions).toBe(1070);
        // no published rows: those three are dashes, the shooting factors and pace stay on the log
        const none = garbageView({ ...reads(G.nba24), splits: [] }, impactFor(G.nba24), true, 'nba', 4, 12)!.rates!.home.out!;
        expect([none.possessions, none.off_rtg, none.def_rtg]).toEqual([null, null, null]);
        expect(none.pace).toBeGreaterThan(0);
        expect(none.efg_pct).toBeGreaterThan(0);
    });
    test('?garbage=out, college: points only, so no shooting factors and no box rows', () => {
        const v = garbageView(reads(G.wbb), impactFor(G.wbb), true, 'wbb', 4, 10)!;
        expect(v.box).toBeNull();
        expect([v.rates!.home.out!.efg_pct, v.rates!.home.out!.orb_pct]).toEqual([null, null]);
        expect(v.rates!.home.out!.possessions).toBe(64);
        expect(v.excluded).toBe(14);
    });
});

describe('retrieveGarbageTime', () => {
    beforeEach(() => { api.calls.length = 0; api.fail = false; hooks.garbage = null; api.splits = []; api.box = []; });
    const SPLIT_QUERY = { select: 'team_id,family,split,poss,off_rtg,def_rtg', limit: '60' };
    test('the pros: the crosswalk, then the stats possessions and the per-game splits by the stats game id, season-filtered, capped', async () => {
        api.crosswalk = [{ nba_game_id: '0022600001', nba_home_team_id: '1610612765', nba_away_team_id: '1610612738' }];
        api.rows = G.nba27.possessions;
        api.splits = G.nba27.oracle.team;
        const r = await retrieveGarbageTime('nba', 2027, '401909088', 8, 2);
        expect(api.calls.map((c) => c.table)).toEqual(['schedule_crosswalk', 'possessions', 'situational_team_games']);
        expect(api.calls[1]).toEqual({ schema: 'nba_stats', table: 'possessions', query: { season: '2027', game_id: '0022600001', limit: '400' } });
        expect(api.calls[2]).toEqual({ schema: 'nba_stats', table: 'situational_team_games', query: { season: '2027', game_id: '0022600001', ...SPLIT_QUERY } });
        expect(r.teams).toEqual({ home: 1610612765, away: 1610612738 });
        expect(r.splits).toBe(api.splits);
    });
    test('college: ncaa_possessions by the ESPN game id, with the flag in the column list; the splits by the contest id from ncaa_team_box', async () => {
        api.rows = G.wbb.possessions;
        api.box = [{ contest_id: G.wbb.game_id }, { contest_id: G.wbb.game_id }];
        api.splits = G.wbb.oracle.team;
        const r = await retrieveGarbageTime('wbb', 2026, '401824983', 218, 45);
        expect(api.calls[0]).toMatchObject({ schema: 'wbb', table: 'ncaa_possessions', query: { season: '2026', espn_game_id: '401824983', limit: '400' } });
        expect(api.calls[0].query.select.split(',')).toContain('is_garbage_time');
        expect(api.calls.slice(1)).toEqual([
            { schema: 'wbb', table: 'ncaa_team_box', query: { season: '2026', espn_game_id: '401824983', select: 'contest_id', limit: '10' } },
            { schema: 'wbb', table: 'situational_team_games', query: { season: '2026', game_id: '6387150', ...SPLIT_QUERY } },
        ]);
        expect(r.teams).toEqual({ home: 218, away: 45 });
        expect(r.splits).toBe(api.splits);
        // no stats.ncaa.org contest for the game: no splits read, and none shown
        api.calls.length = 0; api.box = [];
        expect((await retrieveGarbageTime('wbb', 2026, '401824983', 218, 45)).splits).toEqual([]);
        expect(api.calls.map((c) => c.table)).toEqual(['ncaa_possessions', 'ncaa_team_box']);
    });
    test('an unmapped pro game is empty after one read; a failed or capped read rejects', async () => {
        api.crosswalk = [];
        expect(await retrieveGarbageTime('wnba', 2026, '1', 1, 2)).toEqual({ teams: null, rows: [], splits: [] });
        expect(api.calls).toHaveLength(1);
        api.rows = Array.from({ length: 400 }, () => G.wbb.possessions[0]);
        await expect(retrieveGarbageTime('wbb', 2026, '401824983', 218, 45)).rejects.toThrow('cap'); // a cut log is a failed read
        api.fail = true;
        await expect(retrieveGarbageTime('wbb', 2026, '401824983', 218, 45)).rejects.toThrow('down');
    });
});

const gameApi = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_api.json', import.meta.url)).toString());
function fakeAstro(locals: Record<string, unknown>, search = '') {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: '401766458' }, url: new URL(`https://gameonpaper.com/nba/game/401766458${search}`), locals: { ...locals, flagOverrides: { 'bball-game-flow': false, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    const gfn = vi.fn();
    beforeEach(() => { [sched, rows, gfn].forEach((f) => f.mockReset()); hooks.impact = async () => impactFor(G.nba24); hooks.garbage = gfn; gfn.mockResolvedValue(reads(G.nba24)); });
    test("'bball-garbage-time' is a preview flag", () => { expect(FLAGS['bball-garbage-time']).toBe('preview'); });
    test('off: no read and no garbage key, with or without ?garbage=out', async () => {
        for (const search of ['', '?garbage=out']) {
            ingested();
            const r = await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-garbage-time': false } }, search).astro, 'nba');
            expect('game' in r && 'garbage' in r).toBe(false);
        }
        ingested();
        expect('garbage' in (await prepareBasketballGame(fakeAstro({}, '?garbage=out').astro, 'nba'))).toBe(false); // no preview cookie
        expect(gfn).not.toHaveBeenCalled();
    });
    test('on without the Impact box: no toggle to sit beside, no read', async () => {
        ingested();
        const r = await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-impact-box': false } }, '?garbage=out').astro, 'nba');
        expect('garbage' in r).toBe(false);
        expect(gfn).not.toHaveBeenCalled();
    });
    test('on: one read with the season and the ESPN ids; out only for ?garbage=out', async () => {
        const s = gameApi().schedule[0];
        for (const [search, out] of [['', false], ['?garbage=out', true], ['?garbage=in', false]] as const) {
            ingested();
            const r = await prepareBasketballGame(fakeAstro({ preview: true }, search).astro, 'nba');
            expect('game' in r && r.garbage?.out).toBe(out);
        }
        expect(gfn).toHaveBeenCalledWith('nba', 2025, '401766458', Number(s.home_id), Number(s.away_id));
    });
    test('on, a failed read: reads null, the page renders, nothing is cached', async () => {
        gfn.mockRejectedValue(new Error('down')); ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true }, '?garbage=out');
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.garbage).toEqual({ reads: null, out: true });
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

/** The MIL-CHI final relabelled as the fixture's teams (its ESPN rows; the split keys on the log's own team ids). */
function gameAs(league: string, home: string, away: string): NbaGame {
    const g = fromDataApi(gameApi(), league as any);
    return { ...g, home: { ...g.home, team: { ...g.home.team, abbreviation: home, displayName: home } }, away: { ...g.away, team: { ...g.away.team, abbreviation: away, displayName: away } } };
}
const page = async (league: string, game: NbaGame, impact: ImpactBoxReads, garbage?: { reads: GarbageReads | null; out: boolean }) =>
    normalize(await container.renderToString(NbaGamePage, { props: { game, impact, ...(garbage ? { garbage } : {}) }, locals: { league } as App.Locals }));
const table = (html: string, label: string) => html.split(`aria-label="${label}"`)[1].split('</table>')[0];

describe('NbaGamePage', () => {
    test('byte for byte the flag-off page whenever there is nothing to toggle', async () => {
        const game = gameAs('nba', 'NOP', 'TOR');
        const off = await page('nba', game, impactFor(G.nba24));
        const unflagged = { teams: G.nba24.teams, rows: G.nba24.possessions.map(({ is_garbage_time, ...r }) => r), splits: [] };
        for (const out of [false, true]) {
            expect(await page('nba', game, impactFor(G.nba24), { reads: unflagged, out })).toBe(off); // a release before BB-D7
            expect(await page('nba', game, impactFor(G.nba24), { reads: reads(G.nba27), out })).toBe(off); // no garbage time
            expect(await page('nba', game, impactFor(G.nba24), { reads: { teams: null, rows: [], splits: [] }, out })).toBe(off); // unmapped
        }
        expect(await page('nba', game, impactFor(G.nba24), { reads: null, out: false })).toBe(off); // a failed read, no parameter
        expect(off).not.toContain('garbage');
    });
    test('the toggle beside the Impact box, and nothing else changes without ?garbage=out', async () => {
        const game = gameAs('nba', 'NOP', 'TOR');
        const off = await page('nba', game, impactFor(G.nba24));
        const html = await page('nba', game, impactFor(G.nba24), { reads: reads(G.nba24), out: false });
        expect(html).toContain('id="garbage-toggle"');
        expect(html).toMatch(/<option value="\/nba\/game\/401766458\?garbage=out#impact"[^>]*>Garbage time out/);
        expect(html).toContain('53 of 193 possessions');
        // the toggle and its copy above the four factors (Q8) are the only change
        const strip = (h: string) => h.replace(/<div class="d-flex flex-wrap align-items-center gap-2 mb-2" id="garbage-toggle(?:-factors)?">[\s\S]*?<\/div>/g, '');
        expect(strip(html)).toBe(off);
    });
    test('the same select above the four factors, landing back on #factors, with and without ?garbage=out', async () => {
        const game = gameAs('nba', 'NOP', 'TOR');
        for (const out of [false, true]) {
            const html = await page('nba', game, impactFor(G.nba24), { reads: reads(G.nba24), out });
            const factors = html.slice(html.indexOf('id="factors"'), html.indexOf('id="teambox"'));
            expect(factors).toContain('id="garbage-toggle-factors"');
            expect(factors).toContain('<select id="garbage-factors"');
            expect(factors).toMatch(out ? /<option value="\/nba\/game\/401766458\?garbage=out#factors" selected/ : /<option value="\/nba\/game\/401766458#factors" selected/);
            expect(html.match(/id="garbage-toggle"/g)).toHaveLength(1); // the Impact panel's own, unchanged
        }
        expect(await page('nba', game, impactFor(G.nba24), { reads: null, out: true })).not.toContain('garbage-toggle-factors');
    });
    test('?garbage=out, the pros: split four factors and team box, a whole-game note on the players, the Impact box split', async () => {
        const html = await page('nba', gameAs('nba', 'NOP', 'TOR'), impactFor(G.nba24), { reads: reads(G.nba24), out: true });
        const ff = table(html, 'Four factors, garbage time out');
        expect(ff.match(/<tr/g)).toHaveLength(2 + 8); // two header rows, eight factors
        expect(ff).toContain('155.7'); // NOP's ORtg with garbage time out (109 on 70)
        const box = table(html, 'Team box score, garbage time out');
        expect(box).toContain('>109<');
        expect(box).toContain('>138<');
        expect(html).toContain('id="garbage-players-whole"');
        expect(html).not.toContain('aria-label="Four factors"');
        const top = G.nba24.oracle.player.filter((r) => r.split === 'not_garbage_time' && r.team_id === 1610612740).sort((a, b) => b.minutes - a.minutes)[0];
        const name = G.nba24.names.find((n) => n.person_id === top.player_id)!;
        expect(table(html, 'NOP impact')).toContain(`${name.first_name} ${name.family_name}`);
        // the split's rows come from the possession log, and the box's footer says so (not the substitutions)
        expect(html).toContain('id="impact-source-log"');
        expect(html).not.toContain('substitutions');
        expect(await page('nba', gameAs('nba', 'NOP', 'TOR'), impactFor(G.nba24))).toContain('substitutions');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
    });
    test('?garbage=out, college: Temple\'s producer numbers, no shooting factors, the team box whole', async () => {
        const html = await page('wbb', gameAs('wbb', 'TEM', 'GW'), impactFor(G.wbb), { reads: reads(G.wbb), out: true });
        const ff = table(html, 'Four factors, garbage time out');
        expect(ff.match(/<tr/g)).toHaveLength(2 + 4); // possessions, ORtg, DRtg, pace
        expect(ff).not.toContain('eFG%');
        const temple = G.wbb.oracle.team.find((r) => r.team_id === 218 && r.split === 'not_garbage_time')!;
        expect(ff).toContain(`>${temple.off_rtg.toFixed(1)}<`);
        expect(html).toContain('id="garbage-teambox-whole"');
        expect(html).toContain('aria-label="Team box score"');
        expect(table(html, 'TEM impact').match(/<tr/g)!.length).toBeGreaterThan(5);
        expect(html).not.toContain('NaN');
    });
    test('?garbage=out and a failed read: the whole game, said so', async () => {
        const html = await page('nba', gameAs('nba', 'NOP', 'TOR'), impactFor(G.nba24), { reads: null, out: true });
        expect(html).toContain('id="garbage-unavailable"');
        expect(html).toContain('aria-label="Four factors"');
    });
});
