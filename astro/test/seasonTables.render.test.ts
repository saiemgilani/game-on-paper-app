/**
 * Render-level table contract tests for the season surfaces (plan V3b).
 *
 *  1. CONTRACT — every cell of the team, player and head-coach boards, and of
 *     the team card, is compared against the payload field its column header
 *     names, after that column's own `[multiplier, power10, fixed]` formatting.
 *  2. RECONCILIATION — the published season row's additive columns are checked
 *     against the parts they decompose into. GOP never sums game rows itself
 *     (the season assets arrive aggregated from nfl-data / cfbfastR-cfb-data),
 *     so the game-level sum is asserted where the row still carries it: the
 *     pass/rush split of every total, the per-play and per-game means, and the
 *     off/def margins.
 *
 * Fixtures are real published rows: `cfb-summaries-2024.json` (top 4 FBS teams
 * by net adjusted EPA) and `nfl-summaries-2025.json`.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import {
    SDV_PLAYER_METRIC_CATEGORIES,
    SDV_PLAYER_METRIC_FORMATTING_VALUES,
    SDV_PLAYER_PERCENT_COLUMNS,
    SDV_TEAM_METRIC_CATEGORIES,
    SDV_TEAM_METRIC_FORMATTING_VALUES,
    SDV_TEAM_PERCENT_COLUMNS,
} from '../src/utils/constants';
import { generateMarginalString, retrieveValue, roundNumber } from '../src/utils/misc';
import { COACH_BOARDS, formatCoachValue, numericValue, resolveCoachSort, sortCoachRows, splitByMinPlays, COACH_MIN_PLAYS } from '../src/utils/coaches';
import { loadJson, locals, parseTable } from './helpers/tables';

const cfb = loadJson('cfb-summaries-2024.json');
const nfl = loadJson('nfl-summaries-2025.json');
const coaches = loadJson('nfl-coaches-2024.json');

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async ({ league }: any) => (league === 'nfl' ? nfl.team_summaries : cfb.team_summaries),
    retrievePlayerSummaries: async () => nfl.passing,
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

/** The team grid's cell for `key`, derived from the payload row. */
function expectedTeamCell(category: string, key: string, row: any): string {
    const [multiplier, power10, fixed] = SDV_TEAM_METRIC_FORMATTING_VALUES[category][key] || [1, 2, 2];
    const value = parseFloat(retrieveValue(row, key)) * multiplier;
    const s = category === 'differential' ? generateMarginalString(value, power10, fixed) : roundNumber(value, power10, fixed);
    return s + (SDV_TEAM_PERCENT_COLUMNS.includes(key) ? '%' : '');
}

const CASES = [
    { league: 'cfb' as const, season: 2024, rows: () => cfb.team_summaries, categories: ['differential', 'offensive', 'defensive'] },
    { league: 'nfl' as const, season: 2025, rows: () => nfl.team_summaries, categories: ['differential', 'offensive', 'defensive', 'tendencies', 'fourth-downs', 'luck'] },
];

for (const c of CASES) {
    describe(`[${c.league}] team season board cells equal the column they are headed by`, () => {
        for (const category of c.categories) {
            test(`${category}`, async () => {
                const { default: Table } = await import('../src/components/leaderboards/TeamLeaderboardTable.astro');
                const metric = Object.keys(SDV_TEAM_METRIC_CATEGORIES[category])[0];
                const html = await container.renderToString(Table, {
                    props: { season: c.season, category, metric },
                    request: new Request(`https://gameonpaper.com/year/${c.season}/teams/${category}`),
                    locals: locals(c.league),
                });
                const { headers, rows } = parseTable(html);
                const keys = Object.keys(SDV_TEAM_METRIC_CATEGORIES[category]);
                expect(headers.slice(2).map((h) => h.replace(/\s*$/, ''))).toEqual(Object.values(SDV_TEAM_METRIC_CATEGORIES[category]));
                const body = rows.filter((r) => r.length === keys.length + 2);
                expect(body.length).toBe(c.rows().length);
                // the rendered order is the component's sort, so match rows by team name
                for (const cells of body) {
                    const row = c.rows().find((t: any) => cells[1].includes(String(t.pos_team)));
                    expect(row, `a payload row for ${cells[1]}`).toBeTruthy();
                    keys.forEach((key, i) => {
                        expect(cells[2 + i], `${category} / ${key} / ${row.pos_team}`).toBe(expectedTeamCell(category, key, row));
                    });
                }
            }, 30_000);
        }
    });

    describe(`[${c.league}] the published season row reconciles with the parts it is summed from`, () => {
        test('every offensive and defensive total is its pass total plus its rush total', () => {
            for (const r of c.rows()) {
                for (const side of ['off', 'def']) {
                    expect(r[`plays_${side}`], `plays_${side}`).toBe(r[`plays_${side}_pass`] + r[`plays_${side}_rush`]);
                    expect(r[`yards_${side}`], `yards_${side}`).toBe(r[`yards_${side}_pass`] + r[`yards_${side}_rush`]);
                    expect(r[`TEPA_${side}`], `TEPA_${side}`).toBeCloseTo(r[`TEPA_${side}_pass`] + r[`TEPA_${side}_rush`], 6);
                }
            }
        });

        test('every per-play and per-game mean recomputes from its own total', () => {
            for (const r of c.rows()) {
                for (const side of ['off', 'def']) {
                    expect(r[`EPAplay_${side}`], `EPAplay_${side}`).toBeCloseTo(r[`TEPA_${side}`] / r[`plays_${side}`], 6);
                    expect(r[`playsgame_${side}`], `playsgame_${side}`).toBeCloseTo(r[`plays_${side}`] / r.valid_games, 6);
                    expect(r[`yardsgame_${side}`], `yardsgame_${side}`).toBeCloseTo(r[`yards_${side}`] / r.valid_games, 6);
                    expect(r[`yardsdrive_${side}`], `yardsdrive_${side}`).toBeCloseTo(r[`yards_${side}`] / r[`drives_${side}`], 6);
                    expect(r[`playsdrive_${side}`], `playsdrive_${side}`).toBeCloseTo(r[`plays_${side}`] / r[`drives_${side}`], 6);
                    expect(r[`available_yards_pct_${side}`], `available_yards_pct_${side}`)
                        .toBeCloseTo(r[`total_gained_yards_${side}`] / r[`total_available_yards_${side}`], 6);
                }
            }
        });

        test('every margin the differential board shows is offence minus defence', () => {
            for (const r of c.rows()) {
                expect(r.net_adj_epa, 'net_adj_epa').toBeCloseTo(r.adj_off_epa - r.adj_def_epa, 6);
                expect(r.TEPA_margin, 'TEPA_margin').toBeCloseTo(r.TEPA_off - r.TEPA_def, 6);
                expect(r.EPAplay_margin, 'EPAplay_margin').toBeCloseTo(r.EPAplay_off - r.EPAplay_def, 6);
                expect(r.success_margin, 'success_margin').toBeCloseTo(r.success_off - r.success_def, 6);
                expect(r.yardsplay_margin, 'yardsplay_margin').toBeCloseTo(r.yardsplay_off - r.yardsplay_def, 6);
                expect(r.available_yards_pct_margin, 'available_yards_pct_margin')
                    .toBeCloseTo(r.available_yards_pct_off - r.available_yards_pct_def, 6);
            }
        });
    });
}

describe('Yards/Play does not share a denominator with Plays in the NFL season tables', () => {
    // A real, cross-league divergence found by these tests, pinned so it is
    // visible rather than silent -- see the PR body. The CFB producer's
    // yardsplay_* is exactly yards_*/plays_*; the NFL producer's is not (its
    // denominator runs about a fifth short of plays_off), so the "Plays" and
    // "Yards/Play" numbers on the same NFL season row do not reconcile.
    // NOT a GOP render bug: the page shows the field its header names.
    test('cfb: yardsplay_off == yards_off / plays_off', () => {
        for (const r of cfb.team_summaries) expect(r.yardsplay_off).toBeCloseTo(r.yards_off / r.plays_off, 6);
    });
    test('nfl: it does not, and the implied denominator is short of plays_off', () => {
        for (const r of nfl.team_summaries) {
            const implied = r.yards_off / r.yardsplay_off;
            expect(implied).toBeLessThan(r.plays_off);
            expect(implied / r.plays_off).toBeGreaterThan(0.7);
        }
    });
});

describe('player season board cells equal the column they are headed by', () => {
    test('nfl passing', async () => {
        const { default: Table } = await import('../src/components/leaderboards/PlayerLeaderboardTable.astro');
        const category = 'passing';
        const metric = 'EPAplay';
        const html = await container.renderToString(Table, {
            props: { season: 2025, category, metric },
            request: new Request('https://gameonpaper.com/nfl/year/2025/players/passing'),
            locals: locals('nfl'),
        });
        const keys = Object.keys(SDV_PLAYER_METRIC_CATEGORIES[category]);
        const { rows } = parseTable(html);
        const body = rows.filter((r) => r.length === keys.length + 4);
        expect(body.length).toBe(nfl.passing.length);
        const cell = (key: string, p: any) => {
            const [multiplier, power10, fixed] = SDV_PLAYER_METRIC_FORMATTING_VALUES[category][key] || [1, 2, 2];
            return roundNumber(parseFloat(retrieveValue(p, key)) * multiplier, power10, fixed)
                + (SDV_PLAYER_PERCENT_COLUMNS.includes(key) ? '%' : '');
        };
        for (const cells of body) {
            const p = nfl.passing.find((x: any) => cells[1] === String(x.passer_player_name));
            expect(p, `a payload row for ${cells[1]}`).toBeTruthy();
            expect(cells[3], 'games').toBe(cell('games', p));
            keys.forEach((key, i) => expect(cells[4 + i], `${key} / ${p.passer_player_name}`).toBe(cell(key, p)));
        }
    }, 30_000);
});

describe('head-coach board cells equal the column they are headed by', () => {
    for (const board of ['pace', 'fourth-downs', 'efficiency']) {
        test(`nfl ${board} season board`, async () => {
            const { default: Table } = await import('../src/components/leaderboards/CoachLeaderboardTable.astro');
            const def = COACH_BOARDS[board];
            const metric = def.defaultSort;
            const rows = coaches.coach_tendencies;
            const html = await container.renderToString(Table, {
                props: { season: 2024, board, metric, rows },
                request: new Request(`https://gameonpaper.com/nfl/year/2024/coaches/${board}`),
                locals: locals('nfl'),
            });
            const sortColumn = def.columns.find((c: any) => c.key === resolveCoachSort(board, metric)) ?? def.columns[0];
            const { qualified } = splitByMinPlays(sortCoachRows(rows, sortColumn), COACH_MIN_PLAYS.season);
            const { rows: parsed } = parseTable(html);
            const body = parsed.filter((r) => r.length === def.columns.length + 5 && r[0] !== 'Rk');
            expect(body.length).toBe(qualified.length);
            qualified.forEach((row: any, i: number) => {
                const cells = body[i];
                expect(cells[1], `row ${i} coach`).toContain(String(row.coach));
                expect(cells[3], `row ${i} games`).toBe(String(row.games));
                expect(cells[4], `row ${i} plays`).toBe(String(row.plays));
                def.columns.forEach((c: any, j: number) => {
                    expect(cells[5 + j], `${board} / ${c.key} / ${row.coach}`).toBe(formatCoachValue(numericValue(row, c.key), c.format));
                });
            });
        }, 30_000);
    }
});

describe('the team card shows the season row it was handed', () => {
    test('record, adjusted EPA and the margins, each with its own rank', async () => {
        const { default: TeamCard } = await import('../src/components/team/TeamCard.astro');
        const summary = cfb.team_summaries[0];
        const team = { id: String(summary.team_id), color: '000000', alternateColor: 'ffffff', displayName: summary.pos_team, location: summary.pos_team, name: summary.pos_team, abbreviation: 'OSU' };
        const html = await container.renderToString(TeamCard, {
            props: { team, season: 2024, teamSeason: { record: '14-2', confRecord: '8-1' }, summary, hideNavigation: true },
            locals: locals('cfb'),
        });
        const { rows } = parseTable(html, 0);
        const cells = rows[rows.length - 1];
        expect(cells[0]).toBe('14-2 (Conf: 8-1)');
        expect(cells[1]).toContain(generateMarginalString(summary.net_adj_epa, 2, 2));
        expect(cells[2]).toContain(generateMarginalString(summary.EPAplay_margin, 2, 2));
        const second = parseTable(html, 1).rows;
        const m = second[second.length - 1];
        expect(m[0]).toContain(generateMarginalString(summary.yardsplay_margin, 2, 2));
        expect(m[1]).toContain(generateMarginalString(100 * summary.available_yards_pct_margin, 2, 1));
        expect(m[2]).toContain(generateMarginalString(100 * summary.success_margin, 2, 1));
    }, 30_000);
});
