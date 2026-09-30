import { describe, expect, test } from 'vitest';
import { generateTeamMetricTitle } from '../src/utils/misc';

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
