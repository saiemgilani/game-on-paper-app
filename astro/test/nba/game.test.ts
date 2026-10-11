import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fromDataApi, fromProcessor, parseLinescores, parseRecord } from '../../src/resources/nbaGame';
import type { NbaPlay } from '../../src/resources/nbaGame';
import { biggestPlays, dash, orderPlayers, shotsOf, wpChartPlays } from '../../src/nba/data/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const proc = fromProcessor(read('game_401766458_processor'));
const api = fromDataApi(read('game_401766458_api'));

/**
 * game_play_number 440 and 441 (sequence 658 and 659) are logged after the technical free throw at sequence 738.
 * hoopR's parser (the API's pbp scores) carries 109-87 through them; sdv-py's port and ESPN's own raw homeScore
 * say 108-87. A known hoopR/sdv-py disagreement on out-of-order rows, so score parity skips exactly these two.
 */
const OUT_OF_ORDER_SCORE_ROWS = [440, 441];

describe('NbaGame adapters', () => {
    test('both sources agree on every number the page shows (the parity gate)', () => {
        expect(api.plays.length).toBe(proc.plays.length);
        for (let i = 0; i < proc.plays.length; i++) {
            const a = api.plays[i], p = proc.plays[i];
            expect([a.n, a.id, a.period, a.wpRegime, a.text, a.teamId]).toEqual([p.n, p.id, p.period, p.wpRegime, p.text, p.teamId]);
            // Shot coordinates: every located shot, both axes.
            expect([a.xLegacy, a.yLegacy]).toEqual([p.xLegacy, p.yLegacy]);
            if (!OUT_OF_ORDER_SCORE_ROWS.includes(p.n)) expect([a.homeScore, a.awayScore]).toEqual([p.homeScore, p.awayScore]);
        }
        for (const side of ['home', 'away'] as const) {
            expect(api[side].score).toBe(proc[side].score);
            expect(api[side].winner).toBe(proc[side].winner);
            expect(api[side].records).toBe(proc[side].records);
            expect(api[side].rates).toEqual(proc[side].rates);
            expect(api[side].box).toEqual(proc[side].box);
            expect(api[side].linescores).toEqual(proc[side].linescores);
            const byId = (rows: typeof api.home.players) => Object.fromEntries(rows.map((r) => [r.athlete_id, r]));
            const a = byId(api[side].players), p = byId(proc[side].players);
            expect(Object.keys(a).sort()).toEqual(Object.keys(p).sort());
            for (const k of Object.keys(a)) expect([a[k].ts_pct, a[k].usg_pct, a[k].points, a[k].minutes]).toEqual([p[k].ts_pct, p[k].usg_pct, p[k].points, p[k].minutes]);
        }
        expect([api.periods, api.hasOvertime, api.status.completed, api.venue]).toEqual([proc.periods, proc.hasOvertime, proc.status.completed, proc.venue]);
        expect([api.source, proc.source]).toEqual(['data_api', 'processor']);
    });

    // Win probability is deliberately NOT equated across sources. The two sources priced this game before different
    // information: ESPN has since emptied pickcenter on this old final, so the processor falls back to the home-court
    // prior; the API's WP was scored while the 6.0 line still existed. Everything downstream of the prior
    // (homeWinProb, wpDelta) differs by design, so each source's prior is asserted on its own.
    test('each source carries its own prior: processor home-court, API the stored spread', () => {
        expect(proc.prior).toEqual({ homeWinProb: expect.closeTo(0.5598, 3), source: 'hfa', homeTeamSpread: 2.5, gameSpreadAvailable: false });
        expect(api.prior).toEqual({ homeWinProb: expect.closeTo(0.6604, 3), source: 'spread', homeTeamSpread: 6, gameSpreadAvailable: true });
        for (const g of [proc, api]) {
            expect(g.plays.every((p) => p.homeWinProb !== null && p.homeWinProb >= 0 && p.homeWinProb <= 1)).toBe(true);
            expect(g.plays.at(-1)!.homeWinProb).toBeCloseTo(1, 6);
        }
    });

    test('the final game: completed status, winner, four quarters, ORL at home', () => {
        expect(proc.status.completed && proc.home.winner && !proc.away.winner).toBe(true);
        expect(proc.home.team.abbreviation).toBe('ORL');
        expect(proc.home.team.logo).toBe('https://a.espncdn.com/i/teamlogos/nba/500/orl.png');
        expect(proc.venue).toBe('Kia Center');
        expect(proc.periods).toBe(4);
        expect(proc.hasOvertime).toBe(false);
        expect(proc.home.linescores).toEqual([32, 29, 18, 41]);
        expect(proc.home.records).toBe('41-41');
    });

    test('a null rate stays null; it is never coerced to 0 or NaN', () => {
        const rows = read('game_401766458_api');
        rows.game_team_rates[0] = { ...rows.game_team_rates[0], efg_pct: null, tov_pct: null, orb_pct: undefined, ft_rate: NaN };
        const g = fromDataApi(rows);
        const r = [g.home.rates, g.away.rates].find((x) => x!.efg_pct === null)!;
        expect([r.efg_pct, r.tov_pct, r.orb_pct, r.ft_rate]).toEqual([null, null, null, null]);
        const dnp = g.away.players.concat(g.home.players).filter((p) => p.did_not_play);
        expect(dnp.length).toBeGreaterThan(0);
        expect(dnp.every((p) => p.ts_pct === null && p.usg_pct === null && p.minutes === null)).toBe(true);
    });
});

describe("Python's values, pinned from the fixtures", () => {
    // Read from the Python-scored frames (sdv-py nba_game_page); a key swap inside an adapter helper cannot pass both sources.
    for (const [name, g] of [['processor', proc], ['data_api', api]] as const) {
        test(`${name}: home team rates, box and a player row are the values Python computed`, () => {
            expect(g.home.rates!.off_rtg).toBeCloseTo(120.70006, 4);
            expect(g.home.rates!.def_rtg).toBeCloseTo(95.55422, 4);
            expect(g.home.rates!.efg_pct).toBeCloseTo(0.543956, 5);
            expect(g.home.rates!.tov_pct).toBeCloseTo(0.0885897, 5);
            expect(g.home.rates!.orb_pct).toBeCloseTo(0.266667, 5);
            expect(g.home.rates!.ft_rate).toBeCloseTo(0.296703, 5);
            expect(g.home.rates!.pace).toBeCloseTo(99.42, 4);
            expect(g.away.rates!.efg_pct).toBeCloseTo(0.404762, 5);
            expect([g.home.rates!.total_turnovers, g.away.rates!.total_turnovers, g.home.rates!.game_minutes]).toEqual([10, 8, 48]);
            expect([g.home.box!.team_score, g.home.box!.field_goals_made, g.home.box!.field_goals_attempted, g.home.box!.fast_break_points, g.home.box!.points_in_paint, g.home.box!.largest_lead]).toEqual([120, 44, 91, '19', '58', '29']);
            const banchero = g.home.players.find((p) => p.athlete_id === 4432573)!;
            expect([banchero.points, banchero.minutes, banchero.plus_minus, banchero.fg, banchero.ft]).toEqual([17, 33, '+18', '4-13', '9-11']);
            expect(banchero.ts_pct).toBeCloseTo(0.476457, 5);
            expect(banchero.usg_pct).toBeCloseTo(26.85394, 4);
        });
        test(`${name}: one team's offensive rating is the other's defensive rating`, () => {
            expect(g.home.rates!.off_rtg).toBe(g.away.rates!.def_rtg);
            expect(g.home.rates!.def_rtg).toBe(g.away.rates!.off_rtg);
        });
    }
});

describe('overtime', () => {
    test('the processor carries periods 5, an ot play and 53 minutes', () => {
        const j = read('game_401766458_processor');
        j.periods = 5;
        j.plays.at(-1).wp_regime = 'ot';
        j.plays.at(-1).period_number = 5;
        for (const ha of ['home', 'away']) j.teams[ha].rates.game_minutes = 53;
        const g = fromProcessor(j);
        expect([g.periods, g.hasOvertime, g.plays.at(-1)!.wpRegime, g.plays.at(-1)!.period, g.home.rates!.game_minutes, g.away.rates!.game_minutes]).toEqual([5, true, 'ot', 5, 53, 53]);
        expect(g.plays[0].wpRegime).toBe('reg');
    });
    test('the Data API derives periods 5 from the plays and carries the ot regime and 53 minutes', () => {
        const rows = read('game_401766458_api');
        rows.play_wp.at(-1).wp_regime = 'ot';
        rows.pbp.at(-1).period_number = 5;
        for (const r of rows.game_team_rates) r.game_minutes = 53;
        const g = fromDataApi(rows);
        expect([g.periods, g.hasOvertime, g.plays.at(-1)!.wpRegime, g.plays.at(-1)!.period, g.home.rates!.game_minutes, g.away.rates!.game_minutes]).toEqual([5, true, 'ot', 5, 53, 53]);
        expect(fromDataApi(read('game_401766458_api')).hasOvertime).toBe(false);
    });
});

describe('nothing is invented', () => {
    test('absent minutes, turnovers and box counts stay null on both adapters', () => {
        const rows = read('game_401766458_api');
        delete rows.game_team_rates[0].game_minutes;
        rows.game_team_rates[0].total_turnovers = null;
        rows.team_box[0].assists = null;
        delete rows.team_box[0].steals;
        const g = fromDataApi(rows);
        const rates = [g.home.rates!, g.away.rates!].find((r) => r.game_minutes === null)!;
        expect([rates.game_minutes, rates.total_turnovers]).toEqual([null, null]);
        const box = [g.home.box!, g.away.box!].find((b) => b.assists === null)!;
        expect([box.assists, box.steals]).toEqual([null, null]);
        const j = read('game_401766458_processor');
        delete j.teams.home.rates.game_minutes;
        j.teams.home.rates.total_turnovers = null;
        delete j.teams.home.box.blocks;
        const p = fromProcessor(j);
        expect([p.home.rates!.game_minutes, p.home.rates!.total_turnovers, p.home.box!.blocks]).toEqual([null, null, null]);
    });
    test('no play_wp rows means no prior, not a home-court 0.5', () => {
        const rows = read('game_401766458_api');
        rows.play_wp = [];
        const g = fromDataApi(rows);
        expect(g.prior).toBeNull();
        expect(g.plays.every((p) => p.homeWinProb === null)).toBe(true);
    });
});

describe('schedule list columns (G3)', () => {
    test('linescores parse from the Python repr the Data API ships', () => {
        const repr = "[{'value': 32.0, 'displayValue': '32', 'period': 1.0}\n {'value': 29.0, 'displayValue': '29', 'period': 2.0}\n {'value': 7.0, 'displayValue': '7', 'period': 5.0}]";
        expect(parseLinescores(repr)).toEqual([32, 29, 7]);
        expect(api.home.linescores).toEqual([32, 29, 18, 41]);
        expect(api.away.linescores).toEqual([17, 30, 26, 22]);
    });
    test('linescores parse from real JSON, and from an already-parsed array', () => {
        const json = '[{"value":32,"displayValue":"32","period":1},{"value":29,"displayValue":"29","period":2}]';
        expect(parseLinescores(json)).toEqual([32, 29]);
        expect(parseLinescores(JSON.parse(json))).toEqual([32, 29]);
        expect(parseLinescores(null)).toEqual([]);
    });
    test('a period without a number is null in both paths, so later periods do not shift', () => {
        expect(parseLinescores("[{'displayValue': '-'}\n {'displayValue': '30'}]")).toEqual([null, 30]);
        expect(parseLinescores('[{"displayValue":"-"},{"displayValue":"30"}]')).toEqual([null, 30]);
        expect(parseLinescores([{ displayValue: '-' }, { displayValue: '30' }])).toEqual([null, 30]);
    });
    test('records take the total entry even when it is not first', () => {
        expect(parseRecord("[{'name': 'Home', 'type': 'home', 'summary': '22-19'}\n {'name': 'overall', 'type': 'total', 'summary': '41-41'}]")).toBe('41-41');
        expect(parseRecord('[{"type":"home","summary":"22-19"},{"summary":"41-41","type":"total"}]')).toBe('41-41');
        expect(parseRecord([{ type: 'home', summary: '22-19' }, { type: 'total', summary: '41-41' }])).toBe('41-41');
    });
    test('records pick the overall summary from either encoding', () => {
        expect(parseRecord("[{'name': 'overall', 'abbreviation': 'Total', 'type': 'total', 'summary': '41-41'}\n {'name': 'Home', 'summary': '22-19'}]")).toBe('41-41');
        expect(parseRecord('[{"type":"total","summary":"41-41"},{"type":"home","summary":"22-19"}]')).toBe('41-41');
        expect(parseRecord(undefined)).toBeNull();
    });
});

describe('pure helpers', () => {
    test('biggestPlays returns the ten largest absolute swings, largest first', () => {
        const top = biggestPlays(proc.plays);
        expect(top).toHaveLength(10);
        for (let i = 1; i < top.length; i++) expect(Math.abs(top[i].wpDelta!)).toBeLessThanOrEqual(Math.abs(top[i - 1].wpDelta!));
        const eligible = proc.plays.filter((p) => p.n !== 1 && p.typeText !== 'End Period' && p.typeText !== 'End Game');
        expect(Math.abs(top[0].wpDelta!)).toBe(Math.max(...eligible.map((p) => Math.abs(p.wpDelta ?? 0))));
    });
    test('biggestPlays skips the first play and the period-end and game-end settle rows', () => {
        const mk = (n: number, typeText: string, wpDelta: number): NbaPlay => ({ ...proc.plays[10], n, id: String(n), typeText, wpDelta });
        const plays = [mk(1, 'Jumpball', 0.9), mk(2, 'End Period', -0.8), mk(3, 'End Game', 0.7), mk(4, 'Jump Shot', 0.1), mk(5, 'Jump Shot', -0.2)];
        expect(biggestPlays(plays).map((p) => p.n)).toEqual([5, 4]);
        const top = biggestPlays(proc.plays);
        expect(top.some((p) => p.n === 1 || p.typeText === 'End Period' || p.typeText === 'End Game')).toBe(false);
        expect(top).toHaveLength(10);
    });
    test('shotsOf keeps located shots of one team only', () => {
        const s = shotsOf(proc.plays, Number(proc.home.team.id));
        expect(s.length).toBeGreaterThan(40);
        expect(s.every((p) => p.xLegacy !== null && p.teamId === Number(proc.home.team.id))).toBe(true);
    });
    test('orderPlayers: starters by minutes, bench by minutes, DNPs last', () => {
        const { starters, bench, dnp } = orderPlayers(proc.away.players);
        expect(starters).toHaveLength(5);
        for (let i = 1; i < starters.length; i++) expect(starters[i].minutes!).toBeLessThanOrEqual(starters[i - 1].minutes!);
        expect(bench.every((r) => !r.starter && !r.did_not_play)).toBe(true);
        expect(dnp.length).toBeGreaterThan(0);
        expect(dnp.every((r) => r.did_not_play)).toBe(true);
    });
    test('wpChartPlays feeds the football chart home WP as pos_team = home', () => {
        const rows = wpChartPlays(proc);
        expect(rows[0]).toEqual({ period: proc.plays[0].period, pos_team: proc.home.team.id, winProbability: { before: proc.plays[0].homeWinProb } });
    });
    test('dash renders null as a dash', () => {
        expect(dash(null, (n) => n.toFixed(1))).toBe('–');
        expect(dash(0.512, (n) => (100 * n).toFixed(1))).toBe('51.2');
    });
});
