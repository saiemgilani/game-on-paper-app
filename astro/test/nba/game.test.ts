import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fromDataApi, fromProcessor, parseLinescores, parseRecord } from '../../src/resources/nbaGame';
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
        expect(Math.abs(top[0].wpDelta!)).toBe(Math.max(...proc.plays.map((p) => Math.abs(p.wpDelta ?? 0))));
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
