import { describe, expect, test } from 'vitest';
import { SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS } from '../src/utils/constants';
import { generateCategoryForMetric, generateSubCategoryForMetric, generateTeamMetricTitle } from '../src/utils/misc';

// The chart builder takes any team_summaries column by URL
// (/charts/builder?y=pts_per_opp_off) and titles its axes, tooltip and table
// with generateTeamMetricTitle; a column with no entry in
// SDV_BASE_METRIC_TITLES fell through to the raw key ("Off pts_per_opp_off").
describe('chart builder axis titles', () => {
    test.each([
        ['pts_per_opp_off', 'Off Points/Opp'],
        ['pts_per_opp_def', 'Def Points/Opp'],
        ['pts_per_opp_margin', 'Net Points/Opp'],
        ['pts_per_drive_off', 'Off Points/Drive'],
        ['pts_per_drive_def', 'Def Points/Drive'],
        ['pts_per_drive_margin', 'Net Points/Drive'],
        ['turnovers_off', 'Off Turnovers'],
        ['turnovers_def', 'Def Turnovers'],
        ['turnover_margin', 'Net Turnover Margin'],
    ])('%s reads "%s"', (metric, title) => {
        expect(generateTeamMetricTitle(metric)).toBe(title);
    });

    test('titles that already existed are unchanged', () => {
        expect(generateTeamMetricTitle('EPAplay_off')).toBe('Off EPA/Play');
        expect(generateTeamMetricTitle('available_yards_pct_margin')).toBe('Net Available Yards %');
        expect(generateTeamMetricTitle('adj_off_epa')).toBe('Off Adj EPA/Play');
    });
});

// The dropdown lists SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS, not the title map: a
// metric that gained a title but not a list entry titled fine by URL and was
// missing from the menu (review on #293, /charts/builder?x=pts_per_opp_off).
describe('chart builder dropdown', () => {
    test.each([
        'pts_per_opp_off', 'pts_per_opp_def', 'pts_per_opp_margin',
        'turnovers_off', 'turnovers_def', 'turnover_margin',
    ])('%s is offered, under an Other sub-category', (metric) => {
        expect(SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS).toContain(metric);
        expect(`${generateCategoryForMetric(metric)} - ${generateSubCategoryForMetric(metric)}`)
            .toMatch(/^(Offensive|Defensive|Differential) - Other$/);
    });

    test('pts_per_drive stays off the shared list: the NFL table has no such column', () => {
        expect(SDV_TEAM_SUMMARY_AVAILABLE_COLUMNS).not.toContain('pts_per_drive_off');
    });
});
