import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { biggestPlays } from '../../src/nba/data/game';
import { fromDataApi, fromProcessor } from '../../src/resources/nbaGame';
import { playerBoxSelect } from '../../src/resources/nbaGames';
import { sanityGate } from '../../src/routes/basketball/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/${name}.json`, import.meta.url)).toString());

/**
 * Plays whose published running score differs from sdv-py's rebuild (spec D7), exactly as Task 3 Step 3 printed. Empty: the
 * 2026-10-18 capture, after the owner's hoopR-mbb-data republish of plan #1's rebuild, found none. 401744223's rows 458-461
 * (four substitutions ESPN logged after Sean Durugordon's free throw, row 457) read 59-61 in the republished release, as in the rebuild.
 */
const RELEASE_SCORE_ROWS: Record<string, number[]> = {};
/**
 * A game whose release rows carry ESPN's swapped neutral-site sides (plan #1). Null: the republish fixed 401829457 (its last
 * release row reads UND 58 - CCU 75), so it is in the parity gate below like the others (Decision 7, post-republish).
 */
const SWAPPED_RELEASE: string | null = null;

const GAMES = [
    { id: '401808271', label: 'regulation, a line', periods: 2, ot: false, proc: 'spread', api: 'hfa', minutes: 40 },
    { id: '401820775', label: 'one overtime, a line', periods: 3, ot: true, proc: 'spread', api: 'hfa', minutes: 45 },
    { id: '401744223', label: 'neutral site, no line', periods: 2, ot: false, proc: 'neutral', api: 'neutral', minutes: 40 },
    { id: '401829457', label: 'neutral, ESPN swapped the sides', periods: 2, ot: false, proc: 'neutral', api: 'neutral', minutes: 40 },
] as const;

describe.each(GAMES.filter((g) => g.id !== SWAPPED_RELEASE))('mbb $id ($label): processor and Data API', (g) => {
    const rows = read(`game_${g.id}_api`);
    const proc = fromProcessor(read(`game_${g.id}_processor`), 'mbb');
    const api = fromDataApi(rows, 'mbb');
    const skip: number[] = RELEASE_SCORE_ROWS[g.id] ?? [];

    test('the ingested rows pass the sanity gate (two halves, overtime from status_period)', () => {
        expect(sanityGate(rows, 'mbb')).toBeNull();
    });
    test('plays, scores and shot coordinates agree (the parity gate)', () => {
        expect(api.plays.length).toBe(proc.plays.length);
        for (let i = 0; i < proc.plays.length; i++) {
            const a = api.plays[i], p = proc.plays[i];
            expect([a.n, a.id, a.period, a.wpRegime, a.text, a.teamId], `play ${p.n}`).toEqual([p.n, p.id, p.period, p.wpRegime, p.text, p.teamId]);
            expect([a.xLegacy, a.yLegacy], `play ${p.n}`).toEqual([p.xLegacy, p.yLegacy]);
            if (!skip.includes(p.n)) expect([a.homeScore, a.awayScore], `play ${p.n}`).toEqual([p.homeScore, p.awayScore]);
        }
    });
    test('box, rates, players, linescores, records agree', () => {
        for (const side of ['home', 'away'] as const) {
            expect([api[side].score, api[side].winner, api[side].records]).toEqual([proc[side].score, proc[side].winner, proc[side].records]);
            expect(api[side].rates).toEqual(proc[side].rates);
            expect(api[side].box).toEqual(proc[side].box);
            expect(api[side].linescores).toEqual(proc[side].linescores);
            const byId = (r: typeof api.home.players) => Object.fromEntries(r.map((x) => [x.athlete_id, x]));
            const a = byId(api[side].players), p = byId(proc[side].players);
            expect(Object.keys(a).sort()).toEqual(Object.keys(p).sort());
            for (const k of Object.keys(a)) expect([a[k].ts_pct, a[k].usg_pct, a[k].points, a[k].minutes]).toEqual([p[k].ts_pct, p[k].usg_pct, p[k].points, p[k].minutes]);
            expect(proc[side].rates!.game_minutes).toBe(g.minutes);
            expect(proc[side].linescores).toHaveLength(g.periods);
        }
    });
    test('halves, periods and overtime from both sources; each source its own prior (G1, Decision 8)', () => {
        for (const x of [proc, api]) expect([x.regulation, x.periodKind, x.periods, x.hasOvertime], x.source).toEqual([2, 'half', g.periods, g.ot]);
        expect([proc.prior?.source, api.prior?.source]).toEqual([g.proc, g.api]);
        expect(api.prior!.gameSpreadAvailable).toBe(false); // hoopR-mbb-data carries no line 2024-2026
        expect(proc.prior!.gameSpreadAvailable).toBe(g.proc === 'spread');
        expect([api.status.completed, proc.status.completed]).toEqual([true, true]);
    });
    test('win probability is the same play by play where both sources share the prior (the neutral games)', () => {
        if (g.proc !== g.api) return; // a line on one side only: everything downstream of the prior differs by design (G1)
        expect(api.prior!.homeWinProb).toBeCloseTo(proc.prior!.homeWinProb, 6);
        for (let i = 0; i < proc.plays.length; i++) {
            if (skip.includes(proc.plays[i].n)) continue; // a row whose score differs prices its own state
            expect(api.plays[i].homeWinProb, `play ${proc.plays[i].n}`).toBeCloseTo(proc.plays[i].homeWinProb!, 6);
        }
    });
    test('the last play settles on the result', () => {
        for (const x of [proc, api]) expect(x.plays.at(-1)!.homeWinProb).toBe(x.home.winner ? 1 : 0);
    });
});

describe('the neutral-site game ESPN swapped, after the republish (Decision 7)', () => {
    test('401829457: the release now reads UND 58 - CCU 75 to the last row, so the Data API rows pass the sanity gate', () => {
        const rows = read('game_401829457_api');
        expect([rows.pbp.at(-1).home_score, rows.pbp.at(-1).away_score].map(Number)).toEqual([58, 75]);
        expect([rows.schedule[0].home_score, rows.schedule[0].away_score].map(Number)).toEqual([58, 75]);
        expect(sanityGate(rows, 'mbb')).toBeNull();
    });
    test("401829457 from the processor: UND 58 - CCU 75, UND's opening three reads 3-0, neutral prior", () => {
        const proc = fromProcessor(read('game_401829457_processor'), 'mbb');
        expect([proc.home.score, proc.away.score].map(Number)).toEqual([58, 75]);
        expect([proc.plays.at(-1)!.homeScore, proc.plays.at(-1)!.awayScore]).toEqual([58, 75]);
        const first = proc.plays.find((p) => p.homeScore + p.awayScore > 0)!;
        expect([first.homeScore, first.awayScore]).toEqual([3, 0]);
        expect([proc.prior!.source, proc.prior!.homeWinProb]).toEqual(['neutral', 0.5]);
    });
});

describe("ESPN's college end-of-half rows are the settle rows biggestPlays skips (spec §7 item 4)", () => {
    test("401820775: 'End of 1st half', 'End of 2nd half', 'End of 1st OT' are typeText 'End Period' and never a biggest play", () => {
        const proc = fromProcessor(read('game_401820775_processor'), 'mbb');
        const ends = proc.plays.filter((p) => /^End of /.test(p.text));
        expect(ends.map((p) => [p.text, p.typeText])).toEqual([
            ['End of 1st half', 'End Period'], ['End of 2nd half', 'End Period'], ['End of 1st OT', 'End Period'], ['End of Game', 'End Game'],
        ]);
        const big = biggestPlays(proc.plays, 50).map((p) => p.n);
        for (const e of ends) expect(big).not.toContain(e.n);
    });
});

describe('the player_box select per league (R16: the college box has no plus-minus or DNP reason at the source)', () => {
    test('mbb leaves out plus_minus and reason; nba and wnba still read both; every other column is shared', () => {
        const cols = (l: Parameters<typeof playerBoxSelect>[0]) => playerBoxSelect(l).split(',');
        for (const l of ['nba', 'wnba'] as const) expect(cols(l)).toEqual(expect.arrayContaining(['plus_minus', 'reason']));
        expect(cols('mbb')).not.toContain('plus_minus');
        expect(cols('mbb')).not.toContain('reason');
        expect(cols('mbb')).toEqual(cols('nba').filter((c) => c !== 'plus_minus' && c !== 'reason'));
    });
});
