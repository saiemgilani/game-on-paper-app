// BB-G52: the lineup ON/OFF filter on real shot_lineups rows (fixtures/lineup-shots.json.gz: three 2025-26 Nets games and
// one 2026-27 Colorado State women's game, both sides, with that team's crosswalk and season-player rows).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { leagueContextFromRows } from '../src/nba/adapters';
import { COURT } from '../src/nba/data/court';
import { lineupOptions, lineupShots, matches, parseFilters, parseSide, teamFive, toShotLite, type LineupShotRow, type LineupSide } from '../src/nba/lineupShots';

const fx = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/lineup-shots.json.gz', import.meta.url))).toString());
const sideRows = (lg: 'nba' | 'wbb', side: LineupSide): LineupShotRow[] =>
    fx[lg].rows.filter((r: any) => (side === 'offense' ? r.team_id : r.opp_team_id) === fx[lg].team_id);

const reads = vi.hoisted(() => ({ rows: vi.fn(), crosswalk: vi.fn() }));
vi.mock('../src/resources/lineupShots', () => ({ retrieveLineupShotRows: reads.rows, retrieveLineupCrosswalk: reads.crosswalk }));
const realReads = () => {
    reads.rows.mockImplementation(async (_s: number, _t: number, side: LineupSide, lg: 'nba' | 'wbb') => sideRows(lg, side));
    reads.crosswalk.mockImplementation(async (_s: number, _t: number, lg: string) => (lg === 'wbb' ? fx.wbb.crosswalk.map((r: any) => [String(r.ncaa_player_id), String(r.espn_athlete_id)]) : []));
};
beforeEach(() => { vi.clearAllMocks(); realReads(); });
import { readLineupShots } from '../src/routes/basketball/lineupShots';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/nba/league_context.json', import.meta.url)).toString());
const ctxRows = oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 }));
const league = leagueContextFromRows(ctxRows);
const zoneAttempts = (d: ReturnType<typeof lineupShots>) => Object.values(d.hex!.zones).reduce((a, z) => a + z.player.attempts, 0);

describe('parsing', () => {
    test('side defaults to offense', () => {
        expect(parseSide(null)).toBe('offense');
        expect(parseSide('defense')).toBe('defense');
        expect(parseSide('DEFENSE')).toBe('offense');
    });
    test('filters: known ids only, each once, at most five, a missing or unknown state is ON', () => {
        const known = new Set(['1', '2', '3', '4', '5', '6']);
        expect(parseFilters(['1', '', 'x', '2', '1'], ['off', 'on', 'on', 'bogus', 'on'], known)).toEqual([{ id: '1', on: false }, { id: '2', on: true }]);
        expect(parseFilters(['1', '2', '3', '4', '5', '6'], [], known)).toHaveLength(5);
        expect(parseFilters([' 3 '], ['off'], known)).toEqual([{ id: '3', on: false }]);
    });
    test('matches: every filter must hold, and a filtered shot needs all five known', () => {
        expect(matches(['1', '2', '3', '4', null], [])).toBe(true);
        expect(matches(['1', '2', '3', '4', null], [{ id: '1', on: true }])).toBe(false);
        expect(matches(['1', '2', '3', '4', '5'], [{ id: '1', on: true }, { id: '9', on: false }])).toBe(true);
        expect(matches(['1', '2', '3', '4', '5'], [{ id: '1', on: false }])).toBe(false);
    });
});

describe('NBA (Nets 2025-26, three games)', () => {
    const off = sideRows('nba', 'offense');
    const def = sideRows('nba', 'defense');
    const names = new Map<string, string>();
    test('the side picks its own five: offense off_player_*, defense def_player_*, ids as text', () => {
        expect(teamFive(off[0], 'offense')).toEqual([1, 2, 3, 4, 5].map((i) => String((off[0] as any)[`off_player_${i}`])));
        expect(teamFive(def[0], 'defense')).toEqual([1, 2, 3, 4, 5].map((i) => String((def[0] as any)[`def_player_${i}`])));
        const offIds = new Set(lineupOptions(off, 'offense', names).map((o) => o.id));
        const defIds = new Set(lineupOptions(def, 'defense', names).map((o) => o.id));
        // the same team's players on both sides, never the opponents'
        expect([...defIds].filter((id) => offIds.has(id)).length).toBeGreaterThan(5);
    });
    test('options: most shots first, a nameless id reads as #id; five-man slots add up to five per shot', () => {
        const opts = lineupOptions(off, 'offense', new Map([[String(off[0].off_player_1), 'Named']]));
        expect(opts.map((o) => o.shots)).toEqual([...opts.map((o) => o.shots)].sort((a, b) => b - a));
        expect(opts.reduce((a, o) => a + o.shots, 0)).toBe(off.filter((r) => !teamFive(r, 'offense').includes(null)).length * 5);
        expect(opts.some((o) => o.name === 'Named')).toBe(true);
        expect(opts.find((o) => o.name !== 'Named')!.name).toMatch(/^#\d+$/);
    });
    test('ON and OFF one player split the side: the two charts add up to every placed shot', () => {
        const opts = lineupOptions(off, 'offense', names);
        const star = opts[0].id;
        const all = lineupShots(off, 'offense', [], opts, league, COURT, null);
        const on = lineupShots(off, 'offense', [{ id: star, on: true }], opts, league, COURT, null);
        const offF = lineupShots(off, 'offense', [{ id: star, on: false }], opts, league, COURT, null);
        expect(all.line.attempts).toBe(off.length);
        expect(all.total).toBe(off.length);
        expect(on.line.attempts).toBe(opts[0].shots);
        expect(on.line.attempts + offF.line.attempts + on.unknown).toBe(off.length);
        expect(on.line.makes + offF.line.makes).toBeLessThanOrEqual(all.line.makes);
        // the chart's zones hold exactly the matching shots
        expect(zoneAttempts(on)).toBe(on.line.attempts);
        expect(zoneAttempts(all)).toBe(off.length);
        expect(on.hex!.squares.reduce((a, c) => a + c.attempts, 0)).toBe(on.line.attempts);
    });
    test('two players ON is the intersection; an impossible filter is an empty chart, not a crash', () => {
        const opts = lineupOptions(def, 'defense', names);
        const [a, b] = [opts[0].id, opts[1].id];
        const both = lineupShots(def, 'defense', [{ id: a, on: true }, { id: b, on: true }], opts, league, COURT, null);
        expect(both.line.attempts).toBe(def.filter((r) => { const f = teamFive(r, 'defense'); return f.includes(a) && f.includes(b); }).length);
        const none = lineupShots(def, 'defense', [{ id: a, on: true }, { id: a + '0', on: true }], opts, league, COURT, null);
        expect(none.line.attempts).toBe(0);
        expect(none.hex).toBeNull();
    });
    test('defense: the opponent unit is the shooting five (off_player_*), never the Nets players', () => {
        expect(teamFive(def[0], 'defense', 'opponent')).toEqual([1, 2, 3, 4, 5].map((i) => String((def[0] as any)[`off_player_${i}`])));
        const own = new Set(lineupOptions(def, 'defense', names).map((o) => o.id));
        const opp = lineupOptions(def, 'defense', names, 'opponent');
        expect(opp.length).toBeGreaterThan(5);
        expect(opp.some((o) => own.has(o.id))).toBe(false);
        expect(opp.reduce((a, o) => a + o.shots, 0)).toBe(def.length * 5);
    });
    test('defense: an opponent player ON and OFF split the opponent shots; with a Nets filter it is the intersection', () => {
        const opts = lineupOptions(def, 'defense', names);
        const oppOpts = lineupOptions(def, 'defense', names, 'opponent');
        const y = oppOpts[0].id;
        const on = lineupShots(def, 'defense', [], opts, league, COURT, null, { filters: [{ id: y, on: true }], options: oppOpts });
        const off = lineupShots(def, 'defense', [], opts, league, COURT, null, { filters: [{ id: y, on: false }], options: oppOpts });
        expect(on.line.attempts).toBe(oppOpts[0].shots);
        expect(on.line.attempts + off.line.attempts + on.unknown).toBe(def.length);
        expect(on.oppFilters).toEqual([{ id: y, on: true }]);
        expect(on.oppOptions).toBe(oppOpts);
        expect(zoneAttempts(on)).toBe(on.line.attempts);
        const x = opts[0].id;
        const both = lineupShots(def, 'defense', [{ id: x, on: true }], opts, league, COURT, null, { filters: [{ id: y, on: true }], options: oppOpts });
        expect(both.line.attempts).toBe(def.filter((r) => teamFive(r, 'defense').includes(x) && teamFive(r, 'defense', 'opponent').includes(y)).length);
        expect(both.line.attempts).toBeLessThanOrEqual(on.line.attempts);
        // no opponent filter: the chart is the Nets-only one it was
        expect(lineupShots(def, 'defense', [{ id: x, on: true }], opts, league, COURT, null).line).toEqual(lineupShots(def, 'defense', [{ id: x, on: true }], opts, league, COURT, null, { filters: [], options: oppOpts }).line);
    });
    test('shot distance is rounded feet from the hoop', () => {
        expect(toShotLite({ ...off[0], x_legacy: 30, y_legacy: 40 }).shot_distance).toBe(5);
        expect(toShotLite({ ...off[0], made: true }).shot_result).toBe('Made');
    });
});

describe('the route step', () => {
    const astro = (url: string) => ({ url: new URL(url) }) as any;
    const nets = fx.nba.team_id;
    test('NBA: ?side and ?p/?s pairs reach the filter, names from the season rows', async () => {
        const opts = lineupOptions(sideRows('nba', 'defense'), 'defense', new Map());
        const id = opts[0].id;
        const players = [{ person_id: Number(id), player_name: 'Some Player' }] as any;
        const v = await readLineupShots(astro(`https://x.test/nba/team/${nets}?side=defense&p=${id}&s=off&p=nope&s=on`), 'nba', 2026, nets, players, ctxRows);
        expect(v.status).toBe('ok');
        if (v.status !== 'ok') return;
        expect(v.data.side).toBe('defense');
        expect(v.data.filters).toEqual([{ id, on: false }]);
        expect(v.data.options[0].name).toBe('Some Player');
        expect(v.data.oppFilters).toEqual([]);
    });
    test('NBA defense: ?op/?os pairs filter the shooting opponents, named from the league season rows; offense ignores them', async () => {
        const y = lineupOptions(sideRows('nba', 'defense'), 'defense', new Map(), 'opponent')[0].id;
        const players = [{ person_id: Number(y), player_name: 'Opposing Player' }] as any;
        const v = await readLineupShots(astro(`https://x.test/nba/team/${nets}?side=defense&op=${y}&os=on&op=nope&os=off`), 'nba', 2026, nets, players, ctxRows);
        expect(v.status).toBe('ok');
        if (v.status !== 'ok') return;
        expect(v.data.oppFilters).toEqual([{ id: y, on: true }]);
        expect(v.data.oppOptions[0]).toMatchObject({ id: y, name: 'Opposing Player' });
        expect(v.data.line.attempts).toBe(v.data.oppOptions[0].shots);
        const o = await readLineupShots(astro(`https://x.test/nba/team/${nets}?op=${y}&os=on`), 'nba', 2026, nets, players, ctxRows);
        if (o.status !== 'ok') throw new Error(o.status);
        expect(o.data.oppFilters).toEqual([]);
        expect(o.data.oppOptions).toEqual([]);
        expect(o.data.line.attempts).toBe(o.data.total);
    });
    test('college: a season before 2026-27 is unavailable without a read; 2026-27 names go through the crosswalk', async () => {
        expect(await readLineupShots(astro('https://x.test/wbb/team/36'), 'wbb', 2026, 36, [], ctxRows)).toEqual({ status: 'unavailable', side: 'offense' });
        expect(reads.rows).not.toHaveBeenCalled();
        expect(reads.crosswalk).not.toHaveBeenCalled();
        const v =await readLineupShots(astro('https://x.test/wbb/team/36'), 'wbb', 2027, 36, fx.wbb.season_players, ctxRows);
        expect(v.status).toBe('ok');
        if (v.status !== 'ok') return;
        const named = v.data.options.filter((o) => !o.name.startsWith('#'));
        // every crosswalked player with a season row is named, by the ESPN id's name
        const espnName = new Map(fx.wbb.season_players.map((r: any) => [String(r.person_id), r.player_name]));
        const expected = fx.wbb.crosswalk.filter((r: any) => espnName.has(String(r.espn_athlete_id)) && v.data.options.some((o) => o.id === String(r.ncaa_player_id)));
        expect(named.length).toBe(expected.length);
        expect(named.length).toBeGreaterThan(0);
        for (const r of expected) expect(v.data.options.find((o) => o.id === String(r.ncaa_player_id))!.name).toBe(espnName.get(String(r.espn_athlete_id)));
        // an ESPN id is never read as a stats.ncaa.org id
        expect(v.data.options.some((o) => espnName.has(o.id))).toBe(false);
        expect(reads.rows).toHaveBeenCalledWith(2027, 36, 'offense', 'wbb');
        expect(reads.crosswalk).toHaveBeenCalledWith(2027, 36, 'wbb');
        // defense names the opponents too: the league's crosswalk
        const d = await readLineupShots(astro('https://x.test/wbb/team/36?side=defense'), 'wbb', 2027, 36, fx.wbb.season_players, ctxRows);
        expect(reads.crosswalk).toHaveBeenLastCalledWith(2027, null, 'wbb');
        if (d.status !== 'ok') throw new Error(d.status);
        expect(d.data.oppOptions.length).toBeGreaterThan(0);
        expect(d.data.oppOptions.some((o) => d.data.options.some((t) => t.id === o.id))).toBe(false);
    });
    test('a failed crosswalk keeps the chart with #id names; a failed shot read is the error state', async () => {
        reads.crosswalk.mockRejectedValueOnce(new Error('504'));
        const v = await readLineupShots(astro('https://x.test/wbb/team/36'), 'wbb', 2027, 36, fx.wbb.season_players, ctxRows);
        expect(v.status).toBe('ok');
        if (v.status === 'ok') expect(v.data.options.every((o) => o.name.startsWith('#'))).toBe(true);
        reads.rows.mockRejectedValueOnce(new Error('504'));
        expect(await readLineupShots(astro('https://x.test/wbb/team/36?side=defense'), 'wbb', 2027, 36, [], ctxRows)).toEqual({ status: 'error', side: 'defense' });
        reads.rows.mockResolvedValueOnce([]);
        expect(await readLineupShots(astro(`https://x.test/nba/team/${nets}`), 'nba', 2026, nets, [], ctxRows)).toEqual({ status: 'unavailable', side: 'offense' });
    });
});
