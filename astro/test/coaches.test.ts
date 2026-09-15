import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
    COACH_BOARDS,
    COACH_BOARD_SLUGS,
    COACH_MIN_PLAYS,
    coachBoard,
    coachBoardColumn,
    coachMetricColumns,
    formatCoachValue,
    formatSeasonSpan,
    numericValue,
    rankCoachRows,
    resolveCoachSort,
    sortCoachRows,
    splitByMinPlays,
    type CoachRow,
} from '../src/utils/coaches';
import { COACH_BOARD_COPY } from '../src/utils/seo';
import { prepareCoachBoard, prepareCoachCareers, prepareCoachIndex } from '../src/routes/leaderboards';
import { CURRENT_YEAR, LAST_YEAR } from '../src/utils/constants';

// The head-coach boards against the real 2024 builder output
// (fixtures/nfl-coaches-2024.json): every column a board names must be one
// the payload carries, because one unknown column in `select` is a 400 and
// an empty page.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-coaches-2024.json', import.meta.url)).toString()) as {
    team_tendencies: CoachRow[]; coach_tendencies: CoachRow[]; coach_careers: CoachRow[];
};

describe('board definitions', () => {
    test('the six boards, each with a default sort it owns', () => {
        expect(COACH_BOARD_SLUGS).toEqual(['pace', 'tendencies', 'efficiency', 'scoring', 'fourth-downs', 'defense']);
        for (const b of Object.values(COACH_BOARDS)) {
            expect(b.columns.map((c) => c.key), b.slug).toContain(b.defaultSort);
            expect(new Set(b.columns.map((c) => c.key)).size).toBe(b.columns.length);
        }
    });

    test('every board column exists in all three real payloads', () => {
        for (const [table, rows] of Object.entries(fx)) {
            const keys = new Set(Object.keys(rows[0]));
            for (const c of coachMetricColumns()) expect(keys.has(c), `${c} in ${table}`).toBe(true);
        }
        // and the key columns the resource selects
        const season = new Set(Object.keys(fx.coach_tendencies[0]));
        for (const k of ['season', 'pos_team_id', 'pos_team', 'coach', 'role', 'games', 'plays', 'drives']) expect(season.has(k), k).toBe(true);
        const career = new Set(Object.keys(fx.coach_careers[0]));
        for (const k of ['coach', 'role', 'teams', 'seasons', 'first_season', 'last_season', 'games', 'plays', 'drives']) expect(career.has(k), k).toBe(true);
    });

    test('pct columns hold 0-1 fractions and the point-scaled columns do not (the format convention)', () => {
        const rows = fx.coach_tendencies.concat(fx.coach_careers);
        for (const b of Object.values(COACH_BOARDS)) {
            for (const c of b.columns) {
                const vals = rows.map((r) => numericValue(r, c.key)).filter((v): v is number => v !== null);
                expect(vals.length, c.key).toBeGreaterThan(0);
                const maxAbs = Math.max(...vals.map(Math.abs));
                if (c.format === 'pct') expect(maxAbs, `${c.key} formatted as pct`).toBeLessThanOrEqual(1);
            }
        }
        // the three percentage-POINT columns would render as 2700% under pct
        for (const k of ['third_down_over_expected', 'fourth_wp_left_per_decision', 'fourth_wp_left']) {
            const col = Object.values(COACH_BOARDS).flatMap((b) => b.columns).find((c) => c.key === k);
            expect(col?.format, k).toMatch(/^num/);
        }
        expect(Math.max(...fx.coach_tendencies.map((r) => numericValue(r, 'fourth_wp_left') as number))).toBeGreaterThan(1);
    });

    test('resolveCoachSort honours a column the board has and falls back otherwise', () => {
        expect(resolveCoachSort('pace', 'plays_per_game')).toBe('plays_per_game');
        expect(resolveCoachSort('pace', 'go_rate')).toBe('sec_per_play'); // a fourth-down column, not on pace
        expect(resolveCoachSort('pace', null)).toBe('sec_per_play');
        expect(resolveCoachSort('pace', 'plays_per_game; drop table')).toBe('sec_per_play');
        expect(resolveCoachSort('bogus', 'sec_per_play')).toBe('');
        // inherited names are not boards (an `in` check would have returned Object.prototype.toString)
        expect(resolveCoachSort('toString', 'sec_per_play')).toBe('');
        expect(resolveCoachSort('constructor', null)).toBe('');
        expect(coachBoard('toString')).toBeUndefined();
        expect(coachBoard('hasOwnProperty')).toBeUndefined();
        expect(coachBoard('pace')?.slug).toBe('pace');
        expect(coachBoardColumn('constructor', 'go_rate')).toBeUndefined();
    });
});

describe('sorting and ranking', () => {
    const col = (key: string, lowerIsBetter = false) => ({ key, label: key, hover: '', format: 'num2' as const, lowerIsBetter });
    const rows: CoachRow[] = [
        { coach: 'a', v: 0.5 },
        { coach: 'b', v: null },
        { coach: 'c', v: 0.9 },
        { coach: 'd', v: undefined },
        { coach: 'e', v: 0.1 },
        { coach: 'f', v: 0.9 },
        { coach: 'g', v: 'NA' },
    ];

    test('descending by default, nulls (null, undefined, "NA") last in input order', () => {
        expect(sortCoachRows(rows, col('v')).map((r) => r.coach)).toEqual(['c', 'f', 'a', 'e', 'b', 'd', 'g']);
    });

    test('lowerIsBetter sorts ascending, nulls still last', () => {
        expect(sortCoachRows(rows, col('v', true)).map((r) => r.coach)).toEqual(['e', 'a', 'c', 'f', 'b', 'd', 'g']);
    });

    test('ties share a rank, the next distinct value skips, nulls get none', () => {
        const sorted = sortCoachRows(rows, col('v'));
        expect(rankCoachRows(sorted, 'v')).toEqual([1, 1, 3, 4, null, null, null]);
    });

    test('the real fixture: the fastest offense ranks first on pace, the highest go rate first on fourth downs', () => {
        const pace = sortCoachRows(fx.coach_tendencies, COACH_BOARDS.pace.columns[0]);
        const secs = pace.map((r) => numericValue(r, 'sec_per_play') as number);
        expect(secs).toEqual([...secs].sort((a, b) => a - b));
        const go = sortCoachRows(fx.coach_tendencies, COACH_BOARDS['fourth-downs'].columns.find((c) => c.key === 'go_rate')!);
        const rates = go.map((r) => numericValue(r, 'go_rate') as number);
        expect(rates).toEqual([...rates].sort((a, b) => b - a));
        expect(rankCoachRows(go, 'go_rate')[0]).toBe(1);
        expect(rankCoachRows(go, 'go_rate')).toHaveLength(32);
    });

    test('sorting does not mutate the input', () => {
        const copy = rows.map((r) => ({ ...r }));
        sortCoachRows(rows, col('v'));
        expect(rows).toEqual(copy);
    });
});

describe('formatting', () => {
    test('each format, and a dash for anything missing', () => {
        expect(formatCoachValue(0.4567, 'pct')).toBe('45.7%');
        expect(formatCoachValue(-0.0261, 'pct')).toBe('-2.6%');
        expect(formatCoachValue(27.4, 'num1')).toBe('27.4');
        expect(formatCoachValue(0.2345, 'num2')).toBe('0.23');
        expect(formatCoachValue(126.6, 'int')).toBe('127');
        expect(formatCoachValue(null, 'pct')).toBe('—');
        expect(formatCoachValue(undefined, 'num1')).toBe('—');
        expect(formatCoachValue(NaN, 'num2')).toBe('—');
    });

    test('numericValue reads numbers, numeric strings, and treats blanks/NA as null', () => {
        expect(numericValue({ x: 1.5 }, 'x')).toBe(1.5);
        expect(numericValue({ x: '1.5' }, 'x')).toBe(1.5);
        expect(numericValue({ x: 'NA' }, 'x')).toBeNull();
        expect(numericValue({ x: '' }, 'x')).toBeNull();
        expect(numericValue({}, 'x')).toBeNull();
    });

    test('season span for a career row', () => {
        expect(formatSeasonSpan({ first_season: 2023, last_season: 2024, seasons: 2 })).toBe('2023–2024 (2)');
        expect(formatSeasonSpan({ first_season: 2024, last_season: 2024, seasons: 1 })).toBe('2024');
        expect(formatSeasonSpan({})).toBe('—');
    });
});

describe('the plays floor', () => {
    test('season: 300 plays; every 2024 head-coach season qualifies', () => {
        expect(COACH_MIN_PLAYS.season).toBe(300);
        const { qualified, partial } = splitByMinPlays(fx.coach_tendencies, COACH_MIN_PLAYS.season);
        expect(qualified).toHaveLength(32);
        expect(partial).toHaveLength(0);
    });

    test('careers: 1,500 plays; interim stints fall below the divider in their sort order', () => {
        expect(COACH_MIN_PLAYS.careers).toBe(1500);
        const sorted = sortCoachRows(fx.coach_careers, COACH_BOARDS.efficiency.columns[0]);
        const { qualified, partial } = splitByMinPlays(sorted, COACH_MIN_PLAYS.careers);
        expect(qualified.length + partial.length).toBe(42);
        expect(partial.map((r) => r.coach)).toEqual(expect.arrayContaining(['Giff Smith', 'Chris Tabor', 'Josh McDaniels']));
        expect(qualified.map((r) => r.coach)).toEqual(expect.arrayContaining(['Andy Reid', 'Dan Campbell']));
        for (const r of qualified) expect(numericValue(r, 'plays')).toBeGreaterThanOrEqual(1500);
        for (const r of partial) expect(numericValue(r, 'plays')).toBeLessThan(1500);
        // each half keeps the sort order it arrived in
        const epa = (rs: CoachRow[]) => rs.map((r) => numericValue(r, 'epa_per_play') as number);
        expect(epa(partial)).toEqual([...epa(partial)].sort((a, b) => b - a));
    });
});

describe('copy', () => {
    test('every board has copy that names the head coach, the league and its subject', () => {
        for (const b of COACH_BOARD_SLUGS) {
            const k = COACH_BOARD_COPY[b];
            expect(k, b).toBeDefined();
            for (const league of ['cfb', 'nfl'] as const) {
                const name = league === 'nfl' ? 'NFL' : 'College Football';
                for (const s of [2024, null]) {
                    const text = [k.h1(s, league), k.title(s, league), k.description(s, league)].join(' ');
                    expect(text).toMatch(/head coach/i);
                    expect(text).toContain(name);
                    if (s !== null) expect(k.title(s, league)).toContain('2024');
                    else expect(k.title(s, league)).toContain('Career');
                }
            }
            expect(k.variables.length).toBeGreaterThan(0);
        }
        expect(COACH_BOARD_COPY['fourth-downs'].title(2024, 'nfl')).toMatch(/fourth down/i);
        expect(COACH_BOARD_COPY.pace.title(2024, 'nfl')).toMatch(/pace/i);
        expect(COACH_BOARD_COPY.tendencies.h1(2024, 'cfb')).toMatch(/pass rate/i);
    });

    test('titles stay near the SERP truncation', () => {
        for (const b of COACH_BOARD_SLUGS) {
            const t = COACH_BOARD_COPY[b].title(2024, 'nfl').replace(/ \| Game on Paper$/, '');
            expect(t.length, t).toBeLessThanOrEqual(80);
        }
    });
});

function fakeAstro(path: string, params: Record<string, string>) {
    return { params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any } as any;
}

describe('coach loaders', () => {
    test('season board: unknown board or malformed year is a 404, the current season redirects, ?sort is validated', () => {
        expect(prepareCoachBoard(fakeAstro('/year/2024/coaches/bogus', { year: '2024', board: 'bogus' }), 'cfb')).toEqual({ notFound: true });
        expect(prepareCoachBoard(fakeAstro('/year/2024x/coaches/pace', { year: '2024x', board: 'pace' }), 'cfb')).toEqual({ notFound: true });
        // Object.prototype names: `in` would admit them and the page would crash on .columns
        for (const inherited of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
            expect(prepareCoachBoard(fakeAstro(`/year/2024/coaches/${inherited}`, { year: '2024', board: inherited }), 'cfb'), inherited).toEqual({ notFound: true });
        }
        const a = fakeAstro(`/nfl/year/${CURRENT_YEAR}/coaches/pace`, { year: `${CURRENT_YEAR}`, board: 'pace' });
        expect(prepareCoachBoard(a, 'nfl')).toEqual({ redirect: `/nfl/year/${LAST_YEAR}/coaches/pace` });
        expect(a.locals.league).toBe('nfl');
        expect(prepareCoachBoard(fakeAstro('/nfl/year/2024/coaches/fourth-downs?sort=fourth_agreement_rate', { year: '2024', board: 'fourth-downs' }), 'nfl'))
            .toEqual({ season: 2024, board: 'fourth-downs', metric: 'fourth_agreement_rate' });
        expect(prepareCoachBoard(fakeAstro('/year/2024/coaches/pace?sort=nope', { year: '2024', board: 'pace' }), 'cfb'))
            .toEqual({ season: 2024, board: 'pace', metric: 'sec_per_play' });
    });

    test('careers board: no season, same board and sort checks', () => {
        expect(prepareCoachCareers(fakeAstro('/coaches/bogus', { board: 'bogus' }), 'cfb')).toEqual({ notFound: true });
        for (const inherited of ['toString', 'constructor', 'valueOf']) {
            expect(prepareCoachCareers(fakeAstro(`/nfl/coaches/${inherited}`, { board: inherited }), 'nfl'), inherited).toEqual({ notFound: true });
        }
        expect(prepareCoachCareers(fakeAstro('/nfl/coaches/defense?sort=def_success_rate', { board: 'defense' }), 'nfl'))
            .toEqual({ board: 'defense', metric: 'def_success_rate' });
        expect(prepareCoachCareers(fakeAstro('/coaches/pace', { board: 'pace' }), 'cfb')).toEqual({ board: 'pace', metric: 'sec_per_play' });
    });

    test('the hubs redirect to the default board', () => {
        expect(prepareCoachIndex(fakeAstro('/coaches', {}), 'cfb')).toEqual({ redirect: '/coaches/pace' });
        expect(prepareCoachIndex(fakeAstro('/nfl/coaches', {}), 'nfl')).toEqual({ redirect: '/nfl/coaches/pace' });
        expect(prepareCoachIndex(fakeAstro('/year/2024/coaches', { year: '2024' }), 'cfb')).toEqual({ redirect: '/year/2024/coaches/pace' });
        expect(prepareCoachIndex(fakeAstro(`/nfl/year/${CURRENT_YEAR}/coaches`, { year: `${CURRENT_YEAR}` }), 'nfl')).toEqual({ redirect: `/nfl/year/${LAST_YEAR}/coaches/pace` });
        expect(prepareCoachIndex(fakeAstro('/year/abcd/coaches', { year: 'abcd' }), 'cfb')).toEqual({ notFound: true });
    });
});
