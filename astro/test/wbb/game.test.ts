import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { biggestPlays } from '../../src/nba/data/game';
import { fromDataApi, fromProcessor, type NbaGame, type NbaPlayerRow, type NbaSide } from '../../src/resources/nbaGame';
import { sanityGate } from '../../src/routes/basketball/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/${name}.json`, import.meta.url)).toString());

/**
 * Plays whose published running score differs from sdv-py's rebuild (spec D7), exactly as Task 3 Step 3 printed. Empty: the
 * 2026-10-19 capture, after the owner's 2026-10-18 wehoop-wbb-data republish of plan #1's rebuild (2009-2027), found none.
 * 401827362 row 341 (62-56 after the 63-56 free throw), 401805076 rows 476-477 (90-87 after 91-87) and 400550784's halves-era
 * rows 354-355 (54-54 and 52-54 after 54-56) now read as in the rebuild. 273130043 (2008, not republished) never differed.
 */
const RELEASE_SCORE_ROWS: Record<string, number[]> = {};

/**
 * Fields the release lacks or defines differently from ESPN's live summary (ruling R-W15), the same on both sides of a game.
 * Measured on the local warehouse 2026-10-19: wehoop-wbb-data's schedules carry `*_linescores` / `*_records` only from 2024 and
 * its team box `fast_break_points` / `points_in_paint` only from 2024, so a halves-era game reads null / empty where the processor
 * reads ESPN's values. 2008's release `total_rebounds` also counts team rebounds (Stanford 55 = 50 + 5, Yale 33 = 32 + 1) and
 * its player box has no minutes where the processor has ESPN's 0s; the adapters read that as not recorded (R-W16), so both are
 * null and minutes no longer differ. Exactly these differ: a new gap or a fixed one fails the test.
 */
const RELEASE_FIELD_GAPS: Record<string, { fields: string[]; minutesUnrecorded?: true }> = {
    '400550784': { fields: ['box.fast_break_points', 'box.points_in_paint', 'linescores', 'records'] },
    '273130043': {
        fields: ['box.fast_break_points', 'box.points_in_paint', 'box.total_rebounds', 'linescores', 'records'],
        minutesUnrecorded: true,
    },
};

/** ESPN's live roster metadata (names, jerseys, positions, headshots) is re-edited after the fact; the parity is on the box, not on it. */
const ROSTER_METADATA = new Set(['name', 'short_name', 'headshot', 'position', 'jersey']);
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
/** Every compared field of one side that differs between the Data API (`a`) and the processor (`p`), as sorted paths. */
const diffPaths = (a: NbaSide, p: NbaSide): string[] => {
    const out = new Set<string>();
    for (const k of ['score', 'winner', 'records', 'linescores', 'rates'] as const) if (!same(a[k], p[k])) out.add(k);
    for (const k of new Set([...Object.keys(a.box ?? {}), ...Object.keys(p.box ?? {})])) if (!same((a.box as any)?.[k], (p.box as any)?.[k])) out.add(`box.${k}`);
    const byId = Object.fromEntries(p.players.map((x) => [x.athlete_id, x]));
    for (const r of a.players) for (const k of Object.keys(r)) if (!ROSTER_METADATA.has(k) && !same((r as any)[k], (byId[r.athlete_id] as any)?.[k])) out.add(`players.${k}`);
    return [...out].sort();
};
const teamRebounds = (g: NbaGame, side: 'home' | 'away') =>
    g.plays.filter((x) => /Rebound/.test(x.typeText ?? '') && x.athleteId === null && String(x.teamId) === g[side].team.id).length;

const GAMES = [
    { id: '401827362', label: 'quarters, a line', reg: 4, kind: 'quarter', periods: 4, ot: false, proc: 'spread', api: 'hfa', minutes: 40 },
    { id: '401805076', label: 'quarters, one overtime', reg: 4, kind: 'quarter', periods: 5, ot: true, proc: 'hfa', api: 'hfa', minutes: 45 },
    { id: '401856459', label: 'neutral site, no line', reg: 4, kind: 'quarter', periods: 4, ot: false, proc: 'neutral', api: 'neutral', minutes: 40 },
    { id: '400550784', label: '2014, two halves', reg: 2, kind: 'half', periods: 2, ot: false, proc: 'hfa', api: 'hfa', minutes: 40 },
    { id: '273130043', label: '2008, two halves, no turnovers', reg: 2, kind: 'half', periods: 2, ot: false, proc: 'hfa', api: 'hfa', minutes: 40 },
] as const;

describe.each(GAMES)('wbb $id ($label): processor and Data API', (g) => {
    const rows = read(`game_${g.id}_api`);
    const proc = fromProcessor(read(`game_${g.id}_processor`), 'wbb');
    const api = fromDataApi(rows, 'wbb');
    const skip: number[] = RELEASE_SCORE_ROWS[g.id] ?? [];

    test("the ingested rows pass the sanity gate (the game's own regulation, overtime from status_period)", () => {
        expect(sanityGate(rows, 'wbb')).toBeNull();
    });
    test('plays, scores and shot coordinates agree (the parity gate)', () => {
        expect(api.plays.length).toBe(proc.plays.length);
        for (let i = 0; i < proc.plays.length; i++) {
            const a = api.plays[i], p = proc.plays[i];
            expect([a.n, a.id, a.period, a.wpRegime, a.text, a.teamId], `play ${p.n}`).toEqual([p.n, p.id, p.period, p.wpRegime, p.text, p.teamId]);
            expect([a.xLegacy, a.yLegacy], `play ${p.n}`).toEqual([p.xLegacy, p.yLegacy]);
            if (!skip.includes(p.n)) expect([a.homeScore, a.awayScore], `play ${p.n}`).toEqual([p.homeScore, p.awayScore]);
        }
        const differs = proc.plays.filter((p, i) => api.plays[i].homeScore !== p.homeScore || api.plays[i].awayScore !== p.awayScore).map((p) => p.n);
        expect(differs).toEqual(skip); // the named rows, and only them (G2)
    });
    test('box, rates, players, linescores, records agree, except exactly the named release gaps (R-W15)', () => {
        const gap = RELEASE_FIELD_GAPS[g.id];
        for (const side of ['home', 'away'] as const) {
            const ids = (r: NbaPlayerRow[]) => r.map((x) => x.athlete_id).sort((x, y) => x - y);
            expect(ids(api[side].players), side).toEqual(ids(proc[side].players));
            expect(diffPaths(api[side], proc[side]), side).toEqual(gap?.fields ?? []);
            expect(proc[side].rates!.game_minutes).toBe(g.minutes);
            expect(proc[side].linescores).toHaveLength(g.periods);
            if (!gap) continue;
            // each gap in the direction measured: the release null / empty where ESPN has a value
            expect([api[side].records, typeof proc[side].records], side).toEqual([null, 'string']);
            expect([api[side].linescores, proc[side].linescores.every((n) => typeof n === 'number')], side).toEqual([[], true]);
            for (const k of ['fast_break_points', 'points_in_paint'] as const) expect([api[side].box![k], proc[side].box![k] === null], `${side} ${k}`).toEqual([null, false]);
            if (gap.fields.includes('box.total_rebounds')) {
                expect(api[side].box!.total_rebounds, side).toBe(proc[side].box!.total_rebounds! + teamRebounds(proc, side));
            }
            if (gap.minutesUnrecorded) {
                // R-W16: the release's null and the processor's ESPN 0s both read as not recorded
                for (const x of [api, proc]) expect(x[side].players.map((r) => r.minutes), side).toEqual(x[side].players.map(() => null));
            }
        }
    });
    test('the regulation shape, periods and overtime from both sources; each source its own prior (G1, D33)', () => {
        for (const x of [proc, api]) expect([x.regulation, x.periodKind, x.periods, x.hasOvertime], x.source).toEqual([g.reg, g.kind, g.periods, g.ot]);
        expect([proc.prior?.source, api.prior?.source]).toEqual([g.proc, g.api]);
        expect(api.prior!.gameSpreadAvailable).toBe(false); // wehoop-wbb-data carries no line (Decision 8)
        expect(proc.prior!.gameSpreadAvailable).toBe(g.proc === 'spread');
        expect([api.status.completed, proc.status.completed]).toEqual([true, true]);
    });
    test('win probability is the same play by play where both sources share the prior', () => {
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

describe('D12: before 2009 the turnover rates are null from both sources, never 0', () => {
    test('273130043 (2007-11-09): TOV%, possessions, ratings, pace, total turnovers and every usage are null', () => {
        for (const x of [fromProcessor(read('game_273130043_processor'), 'wbb'), fromDataApi(read('game_273130043_api'), 'wbb')]) {
            for (const side of ['home', 'away'] as const) {
                const r = x[side].rates!;
                expect([r.tov_pct, r.possessions, r.off_rtg, r.def_rtg, r.pace, r.total_turnovers], `${x.source} ${side}`).toEqual([null, null, null, null, null, null]);
                expect(r.efg_pct, `${x.source} ${side}`).not.toBeNull();
                expect(x[side].players.filter((p) => !p.did_not_play).every((p) => p.usg_pct === null), `${x.source} ${side}`).toBe(true);
            }
        }
    });
    test("R-W16: ESPN's 2008 0s for turnovers and minutes read as not recorded (null) from both adapters; 2026 keeps its numbers", () => {
        for (const x of [fromProcessor(read('game_273130043_processor'), 'wbb'), fromDataApi(read('game_273130043_api'), 'wbb')]) {
            for (const side of ['home', 'away'] as const) {
                const b = x[side].box!;
                expect([b.turnovers, b.team_turnovers, b.total_turnovers], `${x.source} ${side}`).toEqual([null, null, null]);
                expect(x[side].players.every((p) => p.turnovers === null && p.minutes === null), `${x.source} ${side}`).toBe(true);
                expect(b.steals, `${x.source} ${side}`).not.toBeNull(); // only the unrecorded counts are blanked
            }
        }
        for (const x of [fromProcessor(read('game_401827362_processor'), 'wbb'), fromDataApi(read('game_401827362_api'), 'wbb')]) {
            for (const side of ['home', 'away'] as const) {
                expect(typeof x[side].box!.total_turnovers, `${x.source} ${side}`).toBe('number');
                expect(x[side].players.some((p) => (p.minutes ?? 0) > 0), `${x.source} ${side}`).toBe(true);
            }
        }
    });
    test('2026 has real turnovers: TOV% is a number on both sides', () => {
        const x = fromDataApi(read('game_401827362_api'), 'wbb');
        expect([typeof x.home.rates!.tov_pct, typeof x.away.rates!.tov_pct]).toEqual(['number', 'number']);
    });
});

describe('the halves-era release rows, after the republish (Decision 7)', () => {
    test('400550784: the release and the processor both end on the final, 54-56', () => {
        const rows = read('game_400550784_api');
        expect([rows.pbp.at(-1).home_score, rows.pbp.at(-1).away_score].map(Number)).toEqual([54, 56]);
        expect([rows.schedule[0].home_score, rows.schedule[0].away_score].map(Number)).toEqual([54, 56]);
        const proc = fromProcessor(read('game_400550784_processor'), 'wbb');
        expect([proc.plays.at(-1)!.homeScore, proc.plays.at(-1)!.awayScore]).toEqual([54, 56]);
    });
});

describe("ESPN's women's end-of-period rows are the settle rows biggestPlays skips (spec §7 item 4), in three eras", () => {
    const ends = (id: string) => fromProcessor(read(`game_${id}_processor`), 'wbb').plays.filter((p) => /^End of /.test(p.text));
    test('2026 quarters + OT, 2014 halves, 2008 halves: every end row is End Period / End Game', () => {
        expect(ends('401805076').map((p) => [p.text, p.typeText])).toEqual([
            ['End of 1st Quarter', 'End Period'], ['End of 2nd Quarter', 'End Period'], ['End of 3rd Quarter', 'End Period'],
            ['End of 4th Quarter', 'End Period'], ['End of 1st Overtime', 'End Period'], ['End of Game', 'End Game'],
        ]);
        expect(ends('400550784').map((p) => [p.text, p.typeText])).toEqual([['End of 1st half', 'End Period'], ['End of 2nd half', 'End Period'], ['End of Game', 'End Game']]);
        expect(ends('273130043').map((p) => [p.text, p.typeText])).toEqual([['End of the 1st Half.', 'End Period']]);
    });
    test('none of them is ever a biggest play', () => {
        for (const id of ['401805076', '400550784', '273130043']) {
            const plays = fromProcessor(read(`game_${id}_processor`), 'wbb').plays;
            const big = biggestPlays(plays, 50).map((p) => p.n);
            for (const e of plays.filter((p) => /^End of /.test(p.text))) expect(big, `${id} ${e.text}`).not.toContain(e.n);
        }
    });
});
