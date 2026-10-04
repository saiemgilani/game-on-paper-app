/**
 * Render-level table contract tests for the game page (plan V3b).
 *
 * Three things, on a real processed game for both leagues:
 *
 *  1. CONTRACT — every table cell is compared against the payload field its
 *     header claims to show, after the same `roundNumber`/`pct`/`signed`
 *     formatting the component applies. A table that quietly renders a
 *     different field than its header names fails here.
 *  2. TWIN PARITY — the classic twin (`components/game/classic/**`, what the
 *     public sees) and the v2 twin render the same numbers for the same
 *     payload. Sections that exist in only one twin are listed in the PR body,
 *     not failed; the rows where the twins differ on purpose are named, one by
 *     one, under TWIN EXCEPTIONS below, and nothing else may differ.
 *  3. AGGREGATION RECONCILIATION — where the page computes from plays (drive
 *     rates, per-play means) the displayed value is recomputed from the
 *     payload's plays; where it reads `advBoxScore`, the team totals are
 *     checked against the sum over qualifying plays. This is the GOP mirror of
 *     the plan's V1b.
 *
 * The fixtures are real, offline and deterministic: `usage-<league>-<id>.json.gz`
 * is the exact `/{league}/{id}/process` body (see test/fixtures/README.md).
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import {
    BOX_SCORE_NON_RATE_COLUMNS,
    BOX_SCORE_NON_RATE_DECIMAL_COLUMNS,
    BOX_SCORE_NON_RATE_PERCENT_COLUMNS,
    METRIC_KEY_TITLE_MAPPING,
} from '../src/utils/constants';
import { roundNumber, metricDecimalPoints } from '../src/utils/misc';
import { pct, signed, sortDesc, teamRows, withoutUsageSections } from '../src/utils/usage';
import { isScrimmage } from '../src/utils/situational';
import { loadGzJson, locals, parseTable, tableWithHeading, text } from './helpers/tables';

const FIXTURES = {
    cfb: { file: 'usage-cfb-400869270.json.gz', id: 400869270 },
    nfl: { file: 'usage-nfl-401872922.json.gz', id: 401872922 },
} as const;
type Lg = keyof typeof FIXTURES;

// The whole-page renders go through `retrieveProcessedGame` exactly as the route
// does -- it is what adds the "all" span and sorts every box section away-first --
// by answering the processor fetch with the fixture for the league in the URL.
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const m = String(url).match(/\/(cfb|nfl)\/(\d+)\/process/);
        if (!m) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(JSON.stringify(loadGzJson(FIXTURES[m[1] as Lg].file)), {
            status: 200, headers: { 'content-type': 'application/json' },
        });
    },
}));

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => null,
    retrieveMatchupHistory: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const games: Record<string, any> = {};
const game = (league: Lg) => (games[league] ??= loadGzJson(FIXTURES[league].file));

/**
 * A whole game page, rendered from the route's own processed game.
 *
 * Component-level contract tests supply their own props, so they cannot see a
 * page that wires a table to the wrong `advBoxScore` section or drops a column
 * from one. These render the page and check the tables where they actually land.
 * A fresh game object per call: both page components mutate what they are given.
 */
async function renderPage(twin: 'classic' | 'v2', league: Lg): Promise<{ g: any, html: string }> {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const g: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
    const Page = twin === 'classic'
        ? (await import('../src/components/game/classic/GamePage.astro')).default
        : (await import('../src/components/game/GamePage.astro')).default;
    const html = await container.renderToString(Page, {
        props: { id: String(FIXTURES[league].id), game: g, league },
        request: new Request(`https://gameonpaper.com/game/${FIXTURES[league].id}`),
        locals: locals(league),
    });
    return { g, html };
}

/**
 * The v2 Team Stats island on its own, with the props the page gives it. Since
 * #270 the page mounts it `client:load` with every span's box minus the
 * per-player usage sections (edcb37ff): `withoutUsageSections` keeps team_usage,
 * drive_scripting and st_team, which three of the twelve tables read.
 */
async function renderSituationalSection(league: Lg): Promise<{ g: any, html: string }> {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const g: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
    const { default: SituationalSection } = await import('../src/components/game/metrics/SituationalSection.svelte');
    const html = await container.renderToString(SituationalSection as any, {
        props: { season: g.season.year, advBoxScoreSpans: withoutUsageSections(g.advBoxScoreSpans), league, percentiles: [] },
        locals: locals(league),
    });
    return { g, html };
}

/**
 * `off_yards` minus the sum of ESPN's per-play `statYardage`, where the fixture
 * itself disagrees. One team, by one yard; every other team must be exact.
 */
const STAT_YARDAGE_GAPS: Record<string, number> = { 'cfb:2117': 1 };

/**
 * The eight team-metric tables, exactly as the classic GamePage configures them.
 * The v2 TeamMetricsTable still renders every one of them (the twin-parity
 * check); the v2 page's own layout is V2_METRIC_TABLES below.
 */
const METRIC_TABLES = [
    { title: 'Expected Points', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_plays', 'EPA_overall_total', 'EPA_overall_offense', 'EPA_special_teams', 'EPA_penalty'] },
    { title: 'Production', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['scrimmage_plays', 'off_yards', 'yards_per_play', 'EPA_overall_off', 'EPA_per_play', 'passes', 'pass_yards', 'yards_per_pass', 'EPA_passing_overall', 'EPA_passing_per_play', 'rushes', 'rush_yards', 'yards_per_rush', 'EPA_rushing_overall', 'EPA_rushing_per_play'] },
    { title: 'Rushing', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['scrimmage_plays', 'rushes', 'rushing_power', 'rushing_power_success', 'rushing_stuff', 'rushing_stopped', 'rushing_opportunity', 'line_yards', 'line_yards_per_carry', 'rushing_highlight_yards', 'rushing_highlight_yards_per_opp'] },
    { title: 'Explosiveness', section: 'team', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_plays', 'scrimmage_plays', 'EPA_explosive', 'EPA_explosive_passing', 'EPA_explosive_rushing', 'EPA_non_explosive', 'EPA_non_explosive_per_play', 'EPA_non_explosive_passing', 'EPA_non_explosive_passing_per_play', 'EPA_non_explosive_rushing', 'EPA_non_explosive_rushing_per_play'] },
    { title: 'Situational', section: 'situational', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: ['EPA_success', 'EPA_success_pass', 'EPA_success_rush', 'EPA_success_standard_down', 'EPA_success_passing_down', 'EPA_success_early_down', 'EPA_success_late_down', 'EPA_middle_8_success', 'early_downs', 'early_down_first_down', 'EPA_early_down', 'EPA_early_down_per_play', 'early_down_pass', 'early_down_rush', 'EPA_success_early_down_pass', 'EPA_success_early_down_rush', 'late_downs', 'EPA_late_down', 'EPA_late_down_per_play', 'late_down_pass', 'late_down_rush', 'EPA_success_late_down_pass', 'EPA_success_late_down_rush', 'late_down_avg_distance', 'middle_8', 'EPA_middle_8', 'EPA_middle_8_per_play', 'middle_8_pass', 'middle_8_rush', 'EPA_middle_8_success_pass', 'EPA_middle_8_success_rush'] },
    { title: 'Drives', section: 'drives', teamKey: 'pos_team', useSuffix: false, decimalPoints: 2, columns: ['drives', 'avg_field_position', 'plays_per_drive', 'yards_per_drive', 'drive_total_gained_yards_rate'] },
    { title: 'Defensive', section: 'defensive', teamKey: 'def_pos_team', useSuffix: true, decimalPoints: 0, columns: ['scrimmage_plays', 'drive_stopped_rate', 'havoc_total', 'havoc_total_pass', 'havoc_total_rush', 'TFL', 'TFL_pass', 'TFL_rush', 'sacks', 'pass_breakups', 'def_int', 'fumbles'] },
    { title: 'Turnovers', section: 'turnover', teamKey: 'pos_team', useSuffix: false, decimalPoints: 2, columns: ['turnovers', 'total_fumbles', 'fumbles_lost', 'fumbles_recovered', 'Int', 'turnover_margin', 'expected_turnovers', 'expected_turnover_margin', 'turnover_luck'] },
] as const;

type MetricTable = { title: string, teamKey: string, useSuffix: boolean, decimalPoints: number, columns: readonly string[], section?: string };

const classic = (title: string) => METRIC_TABLES.find((t) => t.title === title)!.columns;
const dotted = (section: string, keys: readonly string[]) => keys.map((k) => `${section}.${k}`);

/**
 * The twelve v2 Team Stats tables, exactly as SituationalSection.svelte
 * configures them since #270: each key is `<box section>.<field>`, and a
 * drive-scripting key also names the script its row reads. The classic
 * Situational table is split four ways, and the former Situational & Special
 * Teams panel's rows (third downs, red zone, scoring opportunities, scripted
 * drives, the kicking game) sit in Late Downs, Drives and Special Teams.
 */
const V2_METRIC_TABLES: MetricTable[] = [
    { title: 'Expected Points', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('team', classic('Expected Points')) },
    { title: 'Production', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('team', classic('Production')) },
    { title: 'Rushing', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('team', classic('Rushing')) },
    { title: 'Special Teams', teamKey: 'pos_team', useSuffix: false, decimalPoints: 0, columns: dotted('st_team', ['fg_attempts', 'kickoff_touchback_rate', 'kickoff_return_avg_allowed', 'punt_net_avg', 'kick_return_avg', 'punt_blocks_by', 'fg_blocks_by']) },
    { title: 'Explosiveness', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('team', classic('Explosiveness')) },
    { title: 'Success', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('situational', ['EPA_success', 'EPA_success_pass', 'EPA_success_rush', 'EPA_success_standard_down', 'EPA_success_passing_down', 'EPA_success_early_down', 'EPA_success_late_down', 'EPA_middle_8_success']) },
    { title: 'Early Downs', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('situational', ['early_downs', 'early_down_first_down', 'EPA_early_down', 'EPA_early_down_per_play', 'early_down_pass', 'early_down_rush', 'EPA_success_early_down_pass', 'EPA_success_early_down_rush']) },
    { title: 'Late Downs', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: [
        ...dotted('situational', ['late_downs', 'EPA_late_down', 'EPA_late_down_per_play', 'late_down_pass', 'late_down_rush', 'EPA_success_late_down_pass', 'EPA_success_late_down_rush', 'late_down_avg_distance']),
        ...dotted('team_usage', ['third_down_opportunities', 'third_down_conversions', 'third_down_expected']),
    ] },
    { title: 'Middle 8', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2, columns: dotted('situational', ['middle_8', 'EPA_middle_8', 'EPA_middle_8_per_play', 'middle_8_pass', 'middle_8_rush', 'EPA_middle_8_success_pass', 'EPA_middle_8_success_rush']) },
    { title: 'Drives', teamKey: 'pos_team', useSuffix: false, decimalPoints: 2, columns: [
        ...dotted('drives', classic('Drives')),
        ...dotted('team_usage', ['so_trips', 'so_touchdown_rate', 'so_points_per_trip', 'so_success_rate', 'so_epa_per_play', 'rz_trips', 'rz_touchdown_rate', 'rz_points_per_trip', 'rz_success_rate', 'rz_epa_per_play']),
        ...dotted('drive_scripting', ['scripted.drives', 'scripted.success_rate', 'scripted.epa_per_play', 'scripted.points_per_drive', 'non_scripted.drives', 'non_scripted.success_rate', 'non_scripted.epa_per_play', 'non_scripted.points_per_drive']),
    ] },
    { title: 'Defensive', teamKey: 'def_pos_team', useSuffix: true, decimalPoints: 0, columns: dotted('defensive', classic('Defensive')) },
    { title: 'Turnovers', teamKey: 'pos_team', useSuffix: false, decimalPoints: 2, columns: dotted('turnover', classic('Turnovers')) },
];

type Twin = 'classic' | 'v2';

/**
 * TWIN EXCEPTIONS -- the complete list of rows where the v2 twin may differ from
 * the classic twin, as of AE/design-fixes at 69a9029f (#270), keyed by the row's
 * field. Twin parity is enforced on every label and every cell NOT named here,
 * so a new divergence fails. Each side of a named one is pinned to its own
 * source, and the two must really differ on the fixture, so an entry that has
 * gone stale (the classic twin adopting v2's formula, say) fails as well and is
 * deleted rather than left behind as a hole.
 */

/**
 * Cells. None differ between the twins any more. For a while only v2 derived
 * Yards/Play from the pass + rush total (4174aaa7); since #270's review both
 * twins print Production's "Yards" as the payload's net `off_yards` and
 * Yards/Play as the payload's `yards_per_play`, so the yards lost on sacks are in
 * both rows (owner decision 2026-10-04). The list stays as the place to record
 * a value the twins are MEANT to print differently.
 */
const V2_ONLY_VALUES: readonly string[] = [];

/**
 * Row labels. 4b9a96c2 ("constants: revert change to remove tabs in v1 game
 * page"): METRIC_KEY_TITLE_MAPPING is the classic twin's again, and
 * TeamMetricsTable.svelte overrides it for v2, which splits the classic
 * Situational table into Success / Early Downs / Late Downs / Middle 8 tables
 * whose headings carry the group's name. Only the four overrides a reader can
 * see are listed: the rest differ from the classic label by indentation alone,
 * which `text()` collapses.
 */
const V2_ROW_LABELS: Record<string, string> = { EPA_success: 'Plays', early_downs: 'Plays', late_downs: 'Plays', middle_8: 'Plays' };

/**
 * What the cell for `item` must read in `twin`, derived straight from the payload row.
 *
 * The branch order is TeamMetricsTable's (the v2 twin's is a superset of the
 * classic's, and the two agree on every key the classic renders but the ones in
 * V2_ONLY_VALUES): the hand-formatted rows first, then a percent column, a
 * fixed-decimal column, a bare count, a scripted-drive metric, and anything
 * else is "count (rate%)".
 */
function expectedMetricCell(item: string, row: any, useSuffix: boolean, decimalPoints: number, twin: Twin): string {
    // the shared guard (#269): an explicit 0 means zero places, a missing value means one
    const dp = metricDecimalPoints(decimalPoints);
    const v = (k: string) => row[k] || 0;
    // Production's total is the payload's net off_yards: statYardage over scrimmage
    // plays, so the yards lost on sacks are in it. (It was rush + pass under #269,
    // which leaves sacks out.)
    if (item === 'off_yards') return roundNumber(v('off_yards'), 2, 0);
    // ...and Yards/Play is that total per scrimmage play, the payload's own value, at
    // two places in both twins; a team with no scrimmage plays gets an em-dash
    if (item === 'yards_per_play') {
        const plays = parseFloat(v('scrimmage_plays'));
        return plays ? roundNumber(parseFloat(v('yards_per_play')), 2, 2) : '—';
    }
    if (item === 'avg_field_position') {
        const val = v(item);
        return `${val >= 50 ? 'Own' : 'Opp'} ${roundNumber(val >= 50 ? 100 - parseFloat(val) : val, 2, 0)}`;
    }
    // the usage-box rates arrive as fractions, and the made-of pairs show their attempts
    // (#270), or an em-dash when there were none (b6dce6a0)
    if (['kickoff_touchback_rate', 'rz_success_rate', 'so_success_rate', 'rz_touchdown_rate', 'so_touchdown_rate'].includes(item)) return `${roundNumber(parseFloat(v(item)) * 100, 2, 0)}%`;
    if (item === 'fg_attempts') return v(item) == 0 ? '—' : `${v('fg_made')}/${v(item)} (${roundNumber(100 * v('fg_made') / v(item), 2, 0)}%)`;
    if (item === 'third_down_conversions' || item === 'third_down_expected') {
        const att = v('third_down_opportunities');
        return att == 0 ? '—' : `${roundNumber(v(item), 2, item === 'third_down_expected' ? 1 : 0)} (${roundNumber(100 * v(item) / att, 2, 0)}%)`;
    }
    if (BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(item)) return `${roundNumber(parseFloat(v(item)), 2, 0)}%`;
    if (BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(item)) return roundNumber(parseFloat(v(item)), 2, dp);
    if (BOX_SCORE_NON_RATE_COLUMNS.includes(item)) return String(v(item));
    if (item.startsWith('scripted.') || item.startsWith('non_scripted.')) {
        const metric = item.split('.')[1];
        if (metric === 'epa_per_play' || metric === 'points_per_drive') return roundNumber(v(metric), 2, 2);
        if (metric === 'success_rate') return `${roundNumber(v(metric) * 100, 2, 0)}%`;
        return String(v(metric));
    }
    const val = v(item);
    const rate = useSuffix ? 100.0 * row[`${item}_rate`] : 100.0 * (parseFloat(val) / parseFloat(row['scrimmage_plays']));
    return `${val} (${roundNumber(rate, 2, 0)}%)`;
}

/** `<section>.<field>` → [section, field]; a bare key reads the table's own section. */
const splitKey = (key: string, section?: string): [string, string] => {
    const dot = key.indexOf('.');
    return dot < 0 ? [section!, key] : [key.slice(0, dot), key.slice(dot + 1)];
};

/** The box row a cell reads: the team's row of the section, or its row for the named script. */
function rowFor(rows: any[], team: string, teamKey: string, item: string): any {
    const script = item.startsWith('scripted.') ? 'scripted' : item.startsWith('non_scripted.') ? 'non_scripted' : null;
    return rows.find((r) => String(r[teamKey]) === team && (script === null || r.script === script));
}

/**
 * The contract for one team-metric table: the row labels are the ones its
 * columns map to, and every cell reads the payload row of the team whose logo
 * heads that column. Shared by the component-level tests and the page-level
 * ones, so the page is checked against the same expectation rather than against
 * its own wiring. `twin` picks the side of each TWIN EXCEPTION the table is on.
 */
function assertMetricTable(html: string, cfg: MetricTable, box: Record<string, any[]>, twin: Twin): void {
    const { rows, rowHtml } = parseTable(html);
    // row 0 is the header: the title, then one logo per team in column order
    const teams = [...rowHtml[0].matchAll(/team-logo-(\d+)/g)].map((m) => m[1]);
    expect(teams.length, `${cfg.title}: a team column per logo`).toBeGreaterThan(0);
    const body = rows.slice(1);
    expect(body, `${cfg.title}: one row per configured column`).toHaveLength(cfg.columns.length);
    cfg.columns.forEach((key, i) => {
        const [section, item] = splitKey(key, cfg.section);
        const [label, ...cells] = body[i];
        expect(label, `${cfg.title} row ${i} label`).toBe((twin === 'v2' && V2_ROW_LABELS[item]) || text(METRIC_KEY_TITLE_MAPPING[item] || item));
        expect(cells, `${cfg.title} / ${key}: one cell per team`).toHaveLength(teams.length);
        teams.forEach((team, t) => {
            const row = rowFor(box[section] ?? [], team, cfg.teamKey, item);
            expect(row, `${cfg.title} / ${key}: a ${section} row for team ${team}`).toBeTruthy();
            expect(cells[t], `${cfg.title} / ${key} / team ${team}`)
                .toBe(expectedMetricCell(item, row, cfg.useSuffix, cfg.decimalPoints, twin));
        });
    });
}

async function renderMetricTable(twin: 'classic' | 'v2', league: Lg, cfg: (typeof METRIC_TABLES)[number]) {
    const g = game(league);
    const rows = g.advBoxScore[cfg.section];
    const shared = { title: cfg.title, teamKey: cfg.teamKey, season: g.season.year, useSuffix: cfg.useSuffix, decimalPoints: cfg.decimalPoints };
    // the v2 table reads a box by `<section>.<field>` keys and takes the league as a prop (#270)
    const [mod, props] = twin === 'classic'
        ? [await import('../src/components/game/classic/TeamMetricsTable.astro'), { ...shared, columns: [...cfg.columns], teamBoxScores: rows }]
        : [await import('../src/components/game/metrics/TeamMetricsTable.svelte'), { ...shared, league, columns: dotted(cfg.section, cfg.columns), box: { [cfg.section]: rows } }];
    return container.renderToString(mod.default as any, { props, locals: locals(league) });
}

for (const league of Object.keys(FIXTURES) as Lg[]) {
    describe(`[${league}] team metric tables show the field their row label names`, () => {
        for (const cfg of METRIC_TABLES) {
            test(`${cfg.title}: every cell equals its payload field`, async () => {
                const g = game(league);
                const rowsData: any[] = g.advBoxScore[cfg.section];
                expect(rowsData.length, `${cfg.section} has rows`).toBeGreaterThan(0);
                assertMetricTable(await renderMetricTable('classic', league, cfg), cfg, g.advBoxScore, 'classic');
            }, 30_000);
        }

        test('the team columns are in the payload order, one per box row', async () => {
            const g = game(league);
            const html = await renderMetricTable('classic', league, METRIC_TABLES[0]);
            const ids = [...html.matchAll(/team-logo-(\d+)/g)].map((m) => m[1]);
            expect(ids).toEqual(g.advBoxScore.team.map((r: any) => String(r.pos_team)));
        }, 30_000);
    });

    describe(`[${league}] twin parity: classic vs v2`, () => {
        for (const cfg of METRIC_TABLES) {
            test(`${cfg.title} renders identical numbers in both twins`, async () => {
                const [classic, v2] = await Promise.all([
                    renderMetricTable('classic', league, cfg),
                    renderMetricTable('v2', league, cfg),
                ]);
                const body = (h: string) => parseTable(h).rows.slice(1);
                const [c, v] = [body(classic), body(v2)];
                expect(c, `${cfg.title}: one classic row per configured column`).toHaveLength(cfg.columns.length);
                expect(v, `${cfg.title}: the same rows in both twins`).toHaveLength(c.length);
                const box: any[] = game(league).advBoxScore[cfg.section];
                cfg.columns.forEach((item, i) => {
                    const [cLabel, ...cCells] = c[i];
                    const [vLabel, ...vCells] = v[i];
                    // Identical, label and cells, unless TWIN EXCEPTIONS names the row; and a
                    // named row has each twin on its own source and the two really apart.
                    if (item in V2_ROW_LABELS) {
                        expect(cLabel, `${item}: the classic label`).toBe(text(METRIC_KEY_TITLE_MAPPING[item]));
                        expect(vLabel, `${item}: the v2 label`).toBe(V2_ROW_LABELS[item]);
                        expect(vLabel, `${item}: V2_ROW_LABELS entry is stale, the twins agree`).not.toBe(cLabel);
                    } else {
                        expect(vLabel, `${cfg.title} / ${item}: label`).toBe(cLabel);
                    }
                    if (V2_ONLY_VALUES.includes(item)) {
                        const want = (twin: Twin) => box.map((row) => expectedMetricCell(item, row, cfg.useSuffix, cfg.decimalPoints, twin));
                        expect(cCells, `${item}: the classic cells`).toEqual(want('classic'));
                        expect(vCells, `${item}: the v2 cells`).toEqual(want('v2'));
                        expect(vCells, `${item}: V2_ONLY_VALUES entry is stale, the twins agree`).not.toEqual(cCells);
                        // what the classic twin prints is what v2 keeps as the cell's tooltip
                        const tips = [...parseTable(v2).rowHtml[i + 1].matchAll(/title="ESPN: ([^"]*)"/g)].map((m) => roundNumber(parseFloat(m[1]), 2, 2));
                        expect(tips, `${item}: the v2 tooltips`).toEqual(cCells);
                    } else {
                        expect(vCells, `${cfg.title} / ${item}: cells`).toEqual(cCells);
                    }
                });
            }, 30_000);
        }

        test('PlayerBoxScore: the five numeric columns agree in both twins', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const box = {
                pass: g.advBoxScore.pass.filter((r: any) => r.pos_team == teamId),
                rush: g.advBoxScore.rush.filter((r: any) => r.pos_team == teamId),
                receiver: g.advBoxScore.receiver.filter((r: any) => r.pos_team == teamId),
            };
            const classic = await container.renderToString(
                (await import('../src/components/game/classic/PlayerBoxScore.astro')).default,
                { props: { ...box }, locals: locals(league) });
            const v2 = await container.renderToString(
                (await import('../src/components/game/metrics/PlayerBoxScore.astro')).default,
                { props: { ...box, plays: g.plays, teamId }, locals: locals(league) });
            // a player's name row is name + Yards/play, EPA/play, EPA, SR, WPA; the stat
            // line is its own spanning row (#274) and differs by design (v2 appends LNG /
            // best-play extremes). The header row also has six cells, so drop it by name.
            const tail = (h: string) => parseTable(h).rows.filter((r) => r.length === 6 && r[1] !== 'Yards/play').map((r) => r.slice(1).join('|'));
            const c = tail(classic);
            expect(c.length).toBeGreaterThan(3);
            // v2 also renders a Defense block the classic twin has no equivalent for;
            // compare the rows the classic twin actually has, in order.
            expect(tail(v2).slice(0, c.length)).toEqual(c);
        }, 30_000);
    });

    describe(`[${league}] the player box and the Binion box read their box rows`, () => {
        test('PlayerBoxScore: every player line equals its advBoxScore row', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const pick = (section: string) => g.advBoxScore[section]
                .filter((r: any) => r.pos_team == teamId)
                .filter((r: any) => (r[`${{ pass: 'passer', rush: 'rusher', receiver: 'receiver' }[section]}_player_name`]?.length ?? 0) > 0)
                .toSorted((a: any, b: any) => b.EPA - a.EPA);
            const [pass, rush, receiver] = ['pass', 'rush', 'receiver'].map(pick);
            const html = await container.renderToString(
                (await import('../src/components/game/classic/PlayerBoxScore.astro')).default,
                { props: { pass, rush, receiver }, locals: locals(league) });
            const { rows } = parseTable(html);
            // name rows are six cells (the stat line is a spanning row of its own, #274);
            // the header row is six too, so it is dropped by its first label
            const body = rows.filter((r) => r.length === 6 && r[1] !== 'Yards/play');
            // group headings are single-cell rows, so the player rows arrive in
            // section order: dropbacks, then rushes, then targets
            const expected = [
                ...pass.map((p: any) => [p.passer_player_name, p.YPA, p]),
                ...rush.map((p: any) => [p.rusher_player_name, p.YPC, p]),
                ...receiver.map((p: any) => [p.receiver_player_name, p.YPT, p]),
            ];
            expect(body).toHaveLength(expected.length);
            expect(expected.length).toBeGreaterThan(5);
            expected.forEach(([name, perPlay, p]: any, i) => {
                const c = body[i];
                expect(c[0], `row ${i} name`).toBe(String(name));
                expect(c[1], `${name} yards/play`).toBe(roundNumber(perPlay || 0, 2, 2));
                expect(c[2], `${name} EPA/play`).toBe(roundNumber(p.EPA_per_Play, 2, 2));
                expect(c[3], `${name} EPA`).toBe(roundNumber(p.EPA, 2, 2));
                expect(c[4], `${name} SR`).toBe(`${roundNumber(p.SR * 100, 2, 0)}%`);
                expect(c[5], `${name} WPA`).toBe(`${roundNumber(p.WPA * 100, 2, 1)}%`);
            });
        }, 30_000);

        test('BinionBoxScore: each row reads the section its label names', async () => {
            const g = game(league);
            const html = await container.renderToString(
                (await import('../src/components/game/classic/BinionBoxScore.astro')).default,
                { props: { season: g.season.year, advancedBoxScore: g.advBoxScore, percentiles: [] }, locals: locals(league) });
            const { rows } = parseTable(html);
            const body = rows.slice(1);
            const COLUMNS: [string, string, string][] = [
                // [key, section, label]
                ['EPA_per_play', 'team', 'EPA/Play'],
                ['EPA_success', 'situational', 'Success Rate'],
                ['yards_per_play', 'team', 'Yards/Play'],
                ['EPA_passing_per_play', 'team', 'EPA/Dropback'],
                ['EPA_rushing_per_play', 'team', 'EPA/Rush'],
                ['yards_per_pass', 'team', 'Yards/Dropback'],
                ['EPA_explosive', 'team', 'Explosive Play Rate'],
                ['EPA_success_rate_third', 'situational', '3rd Down Success Rate'],
                ['EPA_success_rate_rz', 'situational', 'Red Zone Success Rate'],
                ['rushing_stuff', 'team', 'Def Run Stuff Rate'],
                ['havoc_total', 'defensive', 'Havoc Rate'],
            ];
            expect(body).toHaveLength(COLUMNS.length);
            COLUMNS.forEach(([key, section, label], i) => {
                const cells = body[i];
                expect(cells[0], `row ${i} label`).toBe(label);
                // the run-stuff row is deliberately shown against the other team
                const src = key === 'rushing_stuff' ? [...g.advBoxScore[section]].reverse() : g.advBoxScore[section];
                src.forEach((row: any, t: number) => {
                    const v = parseFloat(row[key] ?? '0');
                    const expectedStart = BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(key)
                        ? `${roundNumber(v * (key.includes('_third') || key.includes('_rz') ? 100 : 1), 2, 0)}%`
                        : BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(key)
                            ? roundNumber(v, 2, 2)
                            : BOX_SCORE_NON_RATE_COLUMNS.includes(key)
                                ? String(v)
                                : `${roundNumber(100 * parseFloat(row[`${key}_rate`]), 2, 0)}%`;
                    expect(cells[1 + t].split(' ')[0], `${label} / team ${t}`).toBe(expectedStart);
                });
            });
        }, 30_000);

        test('BinionBoxScore renders identical numbers in both twins', async () => {
            const g = game(league);
            const props = { season: g.season.year, advancedBoxScore: g.advBoxScore, percentiles: [] };
            const [classic, v2] = await Promise.all([
                container.renderToString((await import('../src/components/game/classic/BinionBoxScore.astro')).default, { props, locals: locals(league) }),
                container.renderToString((await import('../src/components/game/metrics/BinionBoxScore.svelte')).default as any, { props: { ...props, league }, locals: locals(league) }),
            ]);
            const strip = (h: string) => parseTable(h).rows.slice(1).map((r) => r.join('|'));
            expect(strip(v2)).toEqual(strip(classic));
        }, 30_000);
    });

    describe(`[${league}] usage, situational and special-teams tables (#252)`, () => {
        test('UsageBoxScore: each player row reads its player_usage fields', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/UsageBoxScore.astro')).default,
                { props: { box: g.advBoxScore, teamId }, locals: locals(league) });
            const usage = sortDesc(teamRows(g.advBoxScore.player_usage, teamId), 'opportunities');
            expect(usage.length).toBeGreaterThan(3);
            const { rows } = parseTable(html, 0);
            const body = rows.slice(1).slice(0, usage.length);
            usage.forEach((p: any, i) => {
                const cells = body[i];
                expect(cells[0], `row ${i} name`).toContain(p.player_name);
                expect(cells[1]).toBe(String(p.opportunities));
                expect(cells[2]).toBe(pct(p.target_share, 0));
                expect(cells[3]).toBe(pct(p.first_down_share, 0));
                expect(cells[4]).toBe(pct(p.fd_td_rate, 0));
                expect(cells[5]).toBe(pct(p.explosive_rate, 0));
                expect(cells[6]).toBe(`${p.rz_touches} (${p.rz_touchdowns})`);
                expect(cells[7]).toBe(`${p.so_touches} (${p.so_touchdowns})`);
                expect(cells[8]).toBe(p.third_down_opportunities > 0 ? signed(p.third_down_over_expected) : '—');
            });
        }, 30_000);

        test('UsageBoxScore: the tackle table reads the tackles section, or is not emitted at all', async () => {
            const g = game(league);
            const teamId = parseInt(g.header.competitions[0].competitors[0].team.id);
            const tackles = sortDesc(teamRows(g.advBoxScore.tackles, teamId, 'def_pos_team'), 'tackle_share');
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/UsageBoxScore.astro')).default,
                { props: { box: g.advBoxScore, teamId }, locals: locals(league) });
            const table = tableWithHeading(html, 'Defensive Usage');
            if (tackles.length === 0) {
                // The section is optional and an empty one must render NOTHING
                // rather than an empty table (UsageBoxScore.astro's own contract).
                // The CFB fixture has no play participants, so this is its branch.
                expect(table, 'no tackle rows means no tackle table').toBeNull();
                expect(html).not.toContain('Tackles: share =');
                return;
            }
            expect(table, 'tackle rows mean a tackle table').toBeTruthy();
            const body = parseTable(table!).rows.slice(1).slice(0, tackles.length);
            tackles.forEach((t: any, i) => {
                expect(body[i][0]).toContain(t.player_name);
                expect(body[i][1]).toBe(String(t.tackles));
                expect(body[i][2]).toBe(String(t.assists));
                expect(body[i][3]).toBe(pct(t.tackle_share, 0));
            });
        }, 30_000);

        test('SituationalSection: all twelve Team Stats tables read the sections their keys name', async () => {
            // The former SituationalSplits contract, on the tables that absorbed its
            // rows (#270): the island is handed the full-game box and every cell of
            // every table must read the team_usage / st_team / drive_scripting row
            // (or the metric row) of the team whose logo heads its column.
            const { g, html } = await renderSituationalSection(league);
            expect(g.advBoxScore.team_usage.length, 'both teams have a team_usage row').toBe(2);
            for (const cfg of V2_METRIC_TABLES) {
                const table = tableWithHeading(html, cfg.title);
                expect(table, `the island renders a "${cfg.title}" table`).toBeTruthy();
                assertMetricTable(table!, cfg, g.advBoxScore, 'v2');
            }
        }, 30_000);

        test('TeamMetricsTable (v2): a zero denominator prints an em-dash, not a rate', async () => {
            // Neither fixture has a team without a scrimmage play, a field-goal try or a
            // third down, so the guards (4174aaa7, b6dce6a0) are exercised on the real
            // rows with those three denominators zeroed.
            const g = game(league);
            const zeroed = (section: string, k: string) => g.advBoxScore[section].map((r: any) => ({ ...r, [k]: 0 }));
            const box = { team: zeroed('team', 'scrimmage_plays'), st_team: zeroed('st_team', 'fg_attempts'), team_usage: zeroed('team_usage', 'third_down_opportunities') };
            const cfg: MetricTable = {
                title: 'Zero denominators', teamKey: 'pos_team', useSuffix: true, decimalPoints: 2,
                columns: ['team.yards_per_play', 'st_team.fg_attempts', 'team_usage.third_down_conversions', 'team_usage.third_down_expected'],
            };
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/TeamMetricsTable.svelte')).default as any,
                { props: { ...cfg, league, season: g.season.year, box }, locals: locals(league) });
            assertMetricTable(html, cfg, box, 'v2');
            expect(parseTable(html).rows.slice(1).flatMap((r) => r.slice(1))).toEqual(Array(8).fill('—'));
        }, 30_000);
    });

    describe(`[${league}] the numbers the page derives from plays reconcile`, () => {
        test('advBoxScore.team totals equal the sum over the qualifying plays', async () => {
            const g = game(league);
            for (const row of g.advBoxScore.team) {
                const mine = g.plays.filter((p: any) => p.pos_team == row.pos_team);
                const scrimmage = mine.filter((p: any) => p.scrimmage_play === true);
                const sum = (rows: any[], k: string) => rows.reduce((a, p) => a + (Number(p[k]) || 0), 0);
                // plays
                expect(row.scrimmage_plays, 'scrimmage_plays').toBe(scrimmage.length);
                expect(row.EPA_plays, 'EPA_plays').toBe(mine.filter((p: any) => p.play === true).length);
                expect(row.rushes, 'rushes').toBe(scrimmage.filter((p: any) => p.rush === true).length);
                expect(row.passes, 'passes').toBe(scrimmage.filter((p: any) => p.pass === true).length);
                // EPA. The box rounds to two decimals, so the tolerance is
                // exactly that rounding and nothing wider.
                expect(row.EPA_overall_off, 'EPA_overall_off').toBeCloseTo(sum(scrimmage, 'EPA_scrimmage'), 2);
                expect(row.EPA_rushing_overall, 'EPA_rushing_overall').toBeCloseTo(sum(scrimmage, 'EPA_rush'), 2);
                expect(row.EPA_passing_overall, 'EPA_passing_overall').toBeCloseTo(sum(scrimmage, 'EPA_pass'), 2);
                // success + explosive
                expect(row.EPA_explosive, 'EPA_explosive').toBe(sum(scrimmage, 'EPA_explosive'));
                // yards. rush_yards / pass_yards are the processor's own parsed
                // yardage; off_yards is ESPN's per-play statYardage, so the two
                // are NOT the same universe -- see the PR body. Each is pinned
                // against the plays it actually comes from.
                expect(row.rush_yards, 'rush_yards').toBe(sum(scrimmage.filter((p: any) => p.rush === true), 'yds_rushed'));
                expect(row.pass_yards, 'pass_yards').toBe(sum(scrimmage.filter((p: any) => p.pass === true), 'yds_receiving'));
                // Exact, not a tolerance: a blanket +/-1 would absorb any future
                // one-yard drift on any team. The single team where this fixture
                // already disagrees is named instead.
                expect(row.off_yards - sum(scrimmage, 'statYardage'), `off_yards vs statYardage, ${league} team ${row.pos_team}`)
                    .toBe(STAT_YARDAGE_GAPS[`${league}:${row.pos_team}`] ?? 0);
                // per-play means recompute from the totals the same table shows
                expect(Number(row.EPA_per_play), 'EPA_per_play').toBeCloseTo(row.EPA_overall_off / row.scrimmage_plays, 2);
                expect(Number(row.yards_per_play), 'yards_per_play').toBeCloseTo(row.off_yards / row.scrimmage_plays, 2);
            }
        });

        test('the situational box success counts equal the successful plays', () => {
            const g = game(league);
            for (const row of g.advBoxScore.situational) {
                const scrimmage = g.plays.filter((p: any) => p.pos_team == row.pos_team && p.scrimmage_play === true);
                const n = (k: string) => scrimmage.reduce((a: number, p: any) => a + (Number(p[k]) || 0), 0);
                expect(row.EPA_success, 'EPA_success').toBe(n('EPA_success'));
                expect(row.EPA_success_pass, 'EPA_success_pass').toBe(n('EPA_success_pass'));
                expect(row.EPA_success_rush, 'EPA_success_rush').toBe(n('EPA_success_rush'));
                expect(row.early_downs, 'early_downs').toBe(scrimmage.filter((p: any) => p.early_down === true).length);
                expect(row.late_downs, 'late_downs').toBe(scrimmage.filter((p: any) => p.late_down === true).length);
                expect(row.middle_8, 'middle_8').toBe(scrimmage.filter((p: any) => p.middle_8 === true).length);
            }
        });

        test('the turnover box equals the turnovers in the plays', () => {
            const g = game(league);
            for (const row of g.advBoxScore.turnover) {
                const mine = g.plays.filter((p: any) => p.pos_team == row.pos_team);
                const ints = mine.filter((p: any) => p.int === true || p.int === 1).length;
                const lost = mine.filter((p: any) => p.fumble_lost === true || p.fumble_lost === 1).length;
                expect(row.Int, 'Int').toBe(ints);
                expect(row.fumbles_lost, 'fumbles_lost').toBe(lost);
                expect(row.turnovers, 'turnovers').toBe(ints + lost);
            }
        });

        test('DrivesTable: every drive row recomputes from that drive\'s plays', async () => {
            const g = game(league);
            const drives = g.drives.previous;
            const html = await container.renderToString(
                (await import('../src/components/game/drives/DrivesTable.astro')).default,
                {
                    props: {
                        drives, gamePlays: g.plays, prefix: 'drives', expandable: true, showGuide: false,
                        homeTeam: g.teamInfo.home, awayTeam: g.teamInfo.away, isNeutralSite: false,
                    },
                    locals: locals(league),
                });
            const summary = parseTable(html).rowHtml.filter((r) => r.includes('accordion-toggle'));
            expect(summary.length).toBe(drives.filter((d: any) => g.plays.some((p: any) => p['drive.id'] == d.id)).length);
            let checked = 0;
            for (const rowHtml of summary) {
                const id = rowHtml.match(/#drive-drives-([^"]+)"/)?.[1];
                const plays = g.plays.filter((p: any) => String(p['drive.id']) === id);
                if (plays.length === 0) continue;
                const scrimmage = plays.filter(isScrimmage as any);
                const totalEPA = plays.reduce((a: number, p: any) => a + (p.EPA || 0), 0);
                const avgEPA = scrimmage.length === 0 ? 0 : scrimmage.reduce((a: number, p: any) => a + (p.EPA || 0), 0) / scrimmage.length;
                const sr = scrimmage.length === 0 ? 0 : scrimmage.reduce((a: number, p: any) => a + (Number(p.EPA_success) || 0), 0) / scrimmage.length;
                const cells = [...rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((m) => text(m[0]));
                expect(cells[4], `drive ${id} SR%`).toBe(`${roundNumber(sr * 100, 3, 0)}%`);
                expect(cells[5], `drive ${id} EPA`).toBe(`${roundNumber(totalEPA, 2, 2)} ${roundNumber(avgEPA, 2, 2)}/play`);
                expect(cells[7], `drive ${id} start WP`).toBe(`${roundNumber(plays[0].winProbability.before * 100, 3, 1)}%`);
                checked++;
            }
            expect(checked).toBeGreaterThan(10);
        }, 30_000);
    });

    describe(`[${league}] the page wires each section to the payload its heading names`, () => {
        // The component tests above supply their own props, so they cannot see a
        // PAGE that hands a table the wrong advBoxScore section or drops a column
        // from one. These render the real page and re-run the same contract where
        // the tables actually land.
        test('classic: all eight team-metric tables, against the sections their titles name', async () => {
            const { g, html } = await renderPage('classic', league);
            for (const cfg of METRIC_TABLES) {
                const table = tableWithHeading(html, cfg.title);
                expect(table, `the classic page renders a "${cfg.title}" table`).toBeTruthy();
                assertMetricTable(table!, cfg, g.advBoxScore, 'classic');
            }
        }, 60_000);

        test('classic: the player box and, for the cfb only, the Binion box', async () => {
            const { g, html } = await renderPage('classic', league);
            const away = g.header.competitions[0].competitors.find((c: any) => c.homeAway === 'away').team;
            const passer = g.advBoxScore.pass
                .filter((r: any) => r.pos_team == parseInt(away.id) && (r.passer_player_name?.length ?? 0) > 0)
                .toSorted((a: any, b: any) => b.EPA - a.EPA)[0];
            expect(passer, 'the fixture has a passer for the away team').toBeTruthy();
            // his line must appear with the numbers his box row carries
            const row = html.split('<tr').find((r) => r.includes(String(passer.passer_player_name)) && r.includes('numeral'));
            expect(row, `a player row for ${passer.passer_player_name}`).toBeTruthy();
            const cells = [...row!.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((m) => text(m[0]));
            // name row: name, yards/play, EPA/play, EPA, SR, WPA (the stat line is the next row, #274)
            expect(cells[3]).toBe(roundNumber(passer.EPA, 2, 2));
            expect(cells[4]).toBe(`${roundNumber(passer.SR * 100, 2, 0)}%`);
        }, 60_000);

        test('v2: the Paper Index, linescore, Team Stats, usage box and drives all read the payload', async () => {
            const { g, html } = await renderPage('v2', league);
            const competitors = g.header.competitions[0].competitors;
            const awayTeam = competitors[1].team;

            // Deserved Win %
            const fmt = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${roundNumber(v, 2, digits)}`;
            const margins = tableWithHeading(html, 'Margin');
            expect(margins, 'the page renders the Paper Index margin table').toBeTruthy();
            const byMargin = new Map(parseTable(margins!).rows.slice(1).map((r) => [r[0], r[1]]));
            expect(byMargin.get('Turnovers')).toBe(fmt(g.paperIndex.margins.turnovers, 0));
            expect(byMargin.get('Havoc Rate')).toBe(`${fmt(g.paperIndex.margins.havoc * 100)}%`);

            // Linescore -- away row first, its periods from the header
            const line = tableWithHeading(html, 'Linescore');
            expect(line, 'the page renders the linescore').toBeTruthy();
            const away = competitors.find((c: any) => c.homeAway === 'away');
            const lineRow = parseTable(line!).rows[1];
            away.linescores.forEach((ls: any, q: number) => expect(lineRow[1 + q], `period ${q + 1}`).toBe(String(ls.displayValue)));

            // Team Stats -- server-rendered since #270, so the twelve tables are checked
            // where they land, against the sections their keys name
            const teamStats = html.slice(html.indexOf('id="team-stats"'), html.indexOf('id="player-stats"'));
            for (const cfg of V2_METRIC_TABLES) {
                const table = tableWithHeading(teamStats, cfg.title);
                expect(table, `the v2 page renders a "${cfg.title}" table`).toBeTruthy();
                assertMetricTable(table!, cfg, g.advBoxScore, 'v2');
            }

            // Usage box -- the away team's leading player, in the away panel
            const awayPanel = html.slice(html.indexOf('id="away-stats-panel"'), html.indexOf('id="home-stats-panel"'));
            const top = sortDesc(teamRows(g.advBoxScore.player_usage, awayTeam.id), 'opportunities')[0] as any;
            const usage = tableWithHeading(awayPanel, 'Offensive Usage');
            expect(usage, 'the away panel renders the usage table').toBeTruthy();
            const first = parseTable(usage!).rows[1];
            expect(first[0]).toContain(top.player_name);
            expect(first[1]).toBe(String(top.opportunities));

            // Drives -- the first drive's success rate off its own plays
            const drives = html.slice(html.indexOf('id="drives"'));
            const firstDrive = [...drives.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => r.includes('accordion-toggle'));
            expect(firstDrive, 'the page renders drive rows').toBeTruthy();
            const driveId = firstDrive!.match(/#drive-drives-([^"]+)"/)?.[1];
            const dp = g.plays.filter((pl: any) => String(pl['drive.id']) === driveId).filter(isScrimmage as any);
            const sr = dp.length === 0 ? 0 : dp.reduce((a: number, pl: any) => a + (Number(pl.EPA_success) || 0), 0) / dp.length;
            const dCells = [...firstDrive!.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((m) => text(m[0]));
            expect(dCells[4], `drive ${driveId} SR%`).toBe(`${roundNumber(sr * 100, 3, 0)}%`);
        }, 60_000);
    });

    describe(`[${league}] Linescore and Paper Index read the header and the fitted result`, () => {
        test('Linescore prints each period from the competitor linescores, and the final from the score', async () => {
            const g = game(league);
            const competitors = g.header.competitions[0].competitors;
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/Linescore.astro')).default,
                { props: { competitors, season: g.season.year }, locals: locals(league) });
            const { rows } = parseTable(html);
            const order = [competitors.find((c: any) => c.homeAway === 'away'), competitors.find((c: any) => c.homeAway === 'home')];
            const body = rows.slice(1);
            expect(body).toHaveLength(2);
            order.forEach((t: any, i) => {
                const cells = body[i];
                expect(cells[0]).toContain(t.team.abbreviation ?? t.team.shortDisplayName);
                t.linescores.forEach((ls: any, q: number) => expect(cells[1 + q], `period ${q + 1}`).toBe(String(ls.displayValue)));
                expect(cells[cells.length - 1], 'final').toBe(String(t.score));
                // and the periods add up to the final the header carries
                const periods = t.linescores.map((ls: any) => Number(ls.displayValue));
                expect(periods.reduce((a: number, b: number) => a + b, 0)).toBe(Number(t.score));
            });
        }, 30_000);

        test('PaperIndex: the margin rows read paperIndex.margins and the meter reads homeShare', async () => {
            const g = game(league);
            expect(g.paperIndex, 'the fixture carries a fitted paper index').toBeTruthy();
            const [home, away] = [g.header.competitions[0].competitors[0].team, g.header.competitions[0].competitors[1].team];
            const html = await container.renderToString(
                (await import('../src/components/game/metrics/PaperIndex.astro')).default,
                { props: { result: g.paperIndex, homeTeam: home, awayTeam: away, completed: true }, locals: locals(league) });
            const m = g.paperIndex.margins;
            const fmt = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${roundNumber(v, 2, digits)}`;
            const { rows } = parseTable(html);
            const byLabel = new Map(rows.slice(1).map((r) => [r[0], r[1]]));
            expect(byLabel.get('Success Rate')).toBe(`${fmt(m.success * 100)}%`);
            expect(byLabel.get('Explosive Play Rate')).toBe(`${fmt(m.explosive * 100)}%`);
            expect(byLabel.get('Explosiveness (EPA/success)')).toBe(fmt(m.explosive_epa, 2));
            expect(byLabel.get('Opportunity Conversion Rate')).toBe(`${fmt(m.opp_conversion * 100)}%`);
            expect(byLabel.get('Points per opportunity')).toBe(fmt(m.pts_per_opp));
            expect(byLabel.get('Field position (EP)')).toBe(fmt(m.field_position, 2));
            expect(byLabel.get('Havoc Rate')).toBe(`${fmt(m.havoc * 100)}%`);
            expect(byLabel.get('Turnovers')).toBe(fmt(m.turnovers, 0));
            // the meter: the home share, clamped to 1..99, and the away side its
            // complement. Read off the role="meter" element itself, then the
            // visible text either side of it: away's share before the bar, home's after.
            const homePct = Math.min(99, Math.max(1, Math.round(g.paperIndex.homeShare * 100)));
            const meters = html.match(/<[^>]*\brole="meter"[^>]*>/g) ?? [];
            expect(meters, 'exactly one meter').toHaveLength(1);
            expect(meters[0].match(/\baria-valuenow="([^"]*)"/)?.[1]).toBe(String(homePct));
            const at = html.indexOf(meters[0]);
            expect(text(html.slice(0, at)).split(' ').at(-1)).toBe(`${100 - homePct}%`);
            expect(text(html.slice(at)).split(' ')[0]).toBe(`${homePct}%`);
        }, 30_000);
    });
}

describe('twin inventory: which sections each twin renders', () => {
    // Behavioural, not a source grep: each case renders the twin and looks for
    // the section's own markup. A reformat, a `===`, or a differently-written
    // gate changes nothing here; a change in what is RENDERED does.
    const BINION = 'Concept from Robert Binion';
    const TRADITIONAL = 'Traditional Stats';
    const PENALTIES = 'Accepted penalties only.';
    /** The body rows of the table the Binion caption belongs to, or null if none rendered. */
    const binionRows = (html: string): string[][] | null => {
        const table = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]).find((t) => t.includes(BINION));
        return table ? parseTable(table).rows.slice(1) : null;
    };

    for (const league of Object.keys(FIXTURES) as Lg[]) {
        test(`[${league}] the classic twin renders the Binion box for the cfb only`, async () => {
            // The divergence the PR reports: promoting game-page-v2 would add a
            // Binion box to every NFL game page. Asserted from the rendered page.
            const { html } = await renderPage('classic', league);
            expect(binionRows(html) !== null, `classic ${league} Binion box`).toBe(league === 'cfb');
        }, 60_000);

        test(`[${league}] the v2 Team Stats island renders the Binion box for both leagues`, async () => {
            // Populated, not just present: its 11 metric rows, a value per team.
            const v2 = binionRows((await renderSituationalSection(league)).html);
            expect(v2, `v2 ${league} Binion box`).not.toBeNull();
            expect(v2).toHaveLength(11);
            for (const r of v2!) {
                expect(r, r[0]).toHaveLength(3);
                expect(r.slice(1).every((c) => /\d/.test(c)), r[0]).toBe(true);
            }
            // and where both twins render it, the same fixture gives the same rows
            if (league === 'cfb') expect(v2).toEqual(binionRows((await renderPage('classic', league)).html));
        }, 60_000);

        test(`[${league}] neither twin renders TraditionalTeamStats or PenaltyBreakdown`, async () => {
            // TraditionalTeamStats.astro and its utility went with #270;
            // PenaltyBreakdown.astro is live code with a unit test behind it
            // (test/penalties.test.ts) but no call site. Pinned by rendering all
            // three surfaces that could carry them, so wiring either in goes red here.
            const surfaces = [
                (await renderPage('classic', league)).html,
                (await renderPage('v2', league)).html,
                (await renderSituationalSection(league)).html,
            ];
            for (const html of surfaces) {
                expect(html).not.toContain(TRADITIONAL);
                expect(html).not.toContain(PENALTIES);
            }
        }, 90_000);
    }
});
