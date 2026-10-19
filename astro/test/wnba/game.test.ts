import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { fromDataApi, fromProcessor, priorSource, type NbaPlayerRow, type NbaTeamBox } from '../../src/resources/nbaGame';
import { sanityGate } from '../../src/routes/basketball/game';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/wnba/${name}.json`, import.meta.url)).toString());

/**
 * Plays whose published running score has not been rebuilt yet (spec D7), keyed by game: exactly the lists Task 3 Step 3
 * printed. Empty: the 2026-10-18 capture found none. 401736325's rows 126-127 (two substitutions logged between Rhyne
 * Howard's free throws) matched the processor's rebuilt score once the owner republished the 2025 release.
 */
const RELEASE_SCORE_ROWS: Record<string, number[]> = {};

/**
 * Release-vs-live differences that are source facts, not bugs (spec D7 sibling; controller ruling 2026-10-18). ESPN's raw
 * 2005 final for 250603003 carries 19 team stats and neither fast-break points nor points in the paint, so the release's
 * team box has them null; and Erin Thorn (510) is `active: false` with every stat "--", which the release keeps absent
 * (null, or the adapter's dash) while ESPN's live box now prints 0 / "0-0". The Data API side must be absent on exactly
 * these fields and the processor present; every other box field and every other player field (IDENTITY aside) is equal.
 */
const RELEASE_SOURCE_FACTS: Record<string, { box: (keyof NbaTeamBox)[]; players: Record<string, (keyof NbaPlayerRow)[]> }> = {
    '250603003': {
        box: ['fast_break_points', 'points_in_paint'],
        players: { '510': ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fg', 'fg3', 'ft', 'plus_minus'] },
    },
};

/** Identity strings, not numbers: never compared (ESPN renamed 3054590 Coffey -> Brodie; the live 2005 box has no jerseys). */
const IDENTITY: (keyof NbaPlayerRow)[] = ['name', 'short_name', 'jersey'];
/** A stat the source did not report: null, or the dash the adapter prints for a missing made-attempted / plus-minus. */
const absent = (v: unknown) => v === null || v === '–' || v === '--';

const GAMES = [
    { id: '401736287', label: 'regulation', regulation: 4, kind: 'quarter', periods: 4, ot: false, prior: 'hfa', minutes: 40 },
    { id: '401736289', label: 'double overtime', regulation: 4, kind: 'quarter', periods: 6, ot: true, prior: 'hfa', minutes: 50 },
    { id: '250603003', label: '2005: two halves and an overtime', regulation: 2, kind: 'half', periods: 3, ot: true, prior: 'hfa', minutes: 45 },
    { id: '401736325', label: 'neutral site, no line', regulation: 4, kind: 'quarter', periods: 4, ot: false, prior: 'neutral', minutes: 40 },
] as const;

describe.each(GAMES)('wnba $id ($label): processor and Data API', (g) => {
    const rows = read(`game_${g.id}_api`);
    const proc = fromProcessor(read(`game_${g.id}_processor`), 'wnba');
    const api = fromDataApi(rows, 'wnba');
    const skip = RELEASE_SCORE_ROWS[g.id] ?? [];
    const facts = RELEASE_SOURCE_FACTS[g.id] ?? { box: [], players: {} };
    /** A copy without the named fields, so the rest is compared whole. */
    const without = <T extends object>(o: T | null, keys: readonly string[]) => (o ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : o);

    test('the ingested rows pass the sanity gate (regulation from the schedule, overtime from status_period)', () => {
        expect(sanityGate(rows, 'wnba')).toBeNull();
    });
    test('plays, scores and shot coordinates agree (the parity gate)', () => {
        expect(api.plays.length).toBe(proc.plays.length);
        for (let i = 0; i < proc.plays.length; i++) {
            const a = api.plays[i], p = proc.plays[i];
            expect([a.n, a.id, a.period, a.wpRegime, a.text, a.teamId]).toEqual([p.n, p.id, p.period, p.wpRegime, p.text, p.teamId]);
            expect([a.xLegacy, a.yLegacy]).toEqual([p.xLegacy, p.yLegacy]);
            if (!skip.includes(p.n)) expect([a.homeScore, a.awayScore], `play ${p.n}`).toEqual([p.homeScore, p.awayScore]);
        }
    });
    test('box, rates, players, linescores, records agree', () => {
        const seen: string[] = [];
        for (const side of ['home', 'away'] as const) {
            expect([api[side].score, api[side].winner, api[side].records]).toEqual([proc[side].score, proc[side].winner, proc[side].records]);
            expect(api[side].rates).toEqual(proc[side].rates);
            for (const k of facts.box) expect([api[side].box![k], proc[side].box![k] === null], `${side} box.${k}: null in the release, reported live`).toEqual([null, false]);
            expect(without(api[side].box, facts.box)).toEqual(without(proc[side].box, facts.box));
            expect(api[side].linescores).toEqual(proc[side].linescores);
            const byId = (r: typeof api.home.players) => Object.fromEntries(r.map((x) => [x.athlete_id, x]));
            const a = byId(api[side].players), p = byId(proc[side].players);
            expect(Object.keys(a).sort()).toEqual(Object.keys(p).sort());
            for (const k of Object.keys(a)) {
                const named = facts.players[k] ?? [];
                for (const f of named) expect([absent(a[k][f]), absent(p[k][f])], `player ${k}.${f}: absent in the release, reported live`).toEqual([true, false]);
                if (named.length) seen.push(k);
                const drop = [...IDENTITY, ...named];
                expect(without(a[k], drop), `player ${k}`).toEqual(without(p[k], drop));
            }
            expect(proc[side].rates!.game_minutes).toBe(g.minutes);
            expect(proc[side].linescores).toHaveLength(g.periods);
        }
        expect(seen.sort(), 'every named player fact was found').toEqual(Object.keys(facts.players).sort());
    });
    test('regulation, periods, overtime and the prior are the same from both sources', () => {
        for (const x of [proc, api]) {
            expect([x.regulation, x.periodKind, x.periods, x.hasOvertime, x.prior?.source], x.source).toEqual([g.regulation, g.kind, g.periods, g.ot, g.prior]);
            expect(x.prior!.gameSpreadAvailable).toBe(false);
        }
        expect(api.prior!.homeWinProb).toBeCloseTo(proc.prior!.homeWinProb, 6);
        expect([api.status.completed, proc.status.completed]).toEqual([true, true]);
    });
    test('win probability is the same play by play (both sources priced the game from the same prior)', () => {
        // Each play's WP depends on its own state only, so a release-score row is skipped by itself, never the whole game.
        let compared = 0;
        for (let i = 0; i < proc.plays.length; i++) {
            if (skip.includes(proc.plays[i].n)) continue;
            expect(api.plays[i].homeWinProb, `play ${proc.plays[i].n}`).toBeCloseTo(proc.plays[i].homeWinProb!, 6);
            compared++;
        }
        expect(compared).toBe(proc.plays.length - skip.length);
    });
    test('the last play settles on the result', () => {
        for (const x of [proc, api]) expect(x.plays.at(-1)!.homeWinProb).toBe(x.home.winner ? 1 : 0);
    });
});

describe('a neutral site is its own prior source (D13)', () => {
    test('priorSource keeps spread and neutral, everything else is hfa', () => {
        expect(['spread', 'neutral', 'hfa', null, undefined, '', 'Neutral'].map(priorSource)).toEqual(['spread', 'neutral', 'hfa', 'hfa', 'hfa', 'hfa', 'hfa']);
    });
    test('401736325: 0.5 from both adapters, never relabelled home-court', () => {
        const api = fromDataApi(read('game_401736325_api'), 'wnba');
        const proc = fromProcessor(read('game_401736325_processor'), 'wnba');
        expect(read('game_401736325_api').play_wp[0].prior_source).toBe('neutral'); // the raw row the old mapping turned into 'hfa'
        for (const x of [api, proc]) expect([x.prior!.source, x.prior!.homeWinProb]).toEqual(['neutral', 0.5]);
    });
});

describe('the halves game (D14, Review Focus 1)', () => {
    test('250603003: the 2005 Detroit Shock is DET (era tricode), never ESPN\'s TUL, on both sources', () => {
        for (const x of [fromProcessor(read('game_250603003_processor'), 'wnba'), fromDataApi(read('game_250603003_api'), 'wnba')]) {
            expect([x.away.team.abbreviation, x.home.team.abbreviation]).toEqual(['NYL', 'DET']);
        }
    });
    test('250603003: periods 1 and 2 are regulation halves, 3 is the overtime, on both sources', () => {
        for (const x of [fromProcessor(read('game_250603003_processor'), 'wnba'), fromDataApi(read('game_250603003_api'), 'wnba')]) {
            const regime = (per: number) => [...new Set(x.plays.filter((p) => p.period === per).map((p) => p.wpRegime))];
            expect([regime(1), regime(2), regime(3)]).toEqual([['reg'], ['reg'], ['ot']]);
            expect(x.season).toBe(2005);
        }
    });
});
