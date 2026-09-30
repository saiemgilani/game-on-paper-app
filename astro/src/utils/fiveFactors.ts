import { generateMarginalString, numberOrNull, roundNumber } from './misc';

/**
 * The season team page's Five Factors table: one row per factor, read from
 * `team_summaries` as offense / defense / margin columns, each with the `_rank`
 * the producer publishes (ranks are already direction-aware: 1 is best).
 */
export type FactorFormat = 'pct' | 'num1' | 'num2';

export interface FiveFactor {
    label: string;
    hover: string;
    off: string | null;
    def: string | null;
    margin: string | null;
    format: FactorFormat;
    /** a second measure of the family above it: indented, lighter label */
    sub?: boolean;
}

export const FIVE_FACTORS: FiveFactor[] = [
    { label: 'Efficiency', hover: 'Success Rate (EPA > 0)', off: 'success_off', def: 'success_def', margin: 'success_margin', format: 'pct' },
    { label: 'Explosiveness', hover: 'Explosive Play Rate', off: 'explosive_off', def: 'explosive_def', margin: 'explosive_margin', format: 'pct' },
    { label: 'Field Position', hover: 'Drive Start EP: expected points of each drive start, per drive', off: 'drive_start_ep_off', def: 'drive_start_ep_def', margin: 'drive_start_ep_margin', format: 'num2' },
    { label: 'Start (yds)', hover: 'Average starting field position per drive, yards to goal', off: 'start_position_off', def: 'start_position_def', margin: 'start_position_margin', format: 'num1', sub: true },
    { label: 'Finishing Drives', hover: 'Points per Scoring Opportunity', off: 'pts_per_opp_off', def: 'pts_per_opp_def', margin: 'pts_per_opp_margin', format: 'num2' },
    { label: 'Turnovers', hover: 'Giveaways per Game (Offense) / Takeaways per Game (Defense)', off: 'turnovers_off', def: 'turnovers_def', margin: 'turnover_margin', format: 'num2' },
    { label: 'Expected', hover: 'Expected giveaways (Offense) / takeaways (Defense) per game: fumbles 50/50, INTs at the national share of passes defensed', off: 'expected_turnovers_off', def: 'expected_turnovers_def', margin: 'expected_turnover_margin', format: 'num2', sub: true },
    { label: 'Luck (pts)', hover: 'Turnover luck, points per game: 5 x (expected - actual giveaways) on Offense, 5 x (actual - expected takeaways) on Defense; positive = lucky', off: 'turnover_luck_off', def: 'turnover_luck_def', margin: 'turnover_luck', format: 'num2', sub: true },
    { label: 'Havoc', hover: 'Havoc Rate: sacks, INTs, fumbles, PBUs and TFLs per play (Offense allowed / Defense created; Margin = created - allowed)', off: 'havoc_off', def: 'havoc_def', margin: 'havoc_margin', format: 'pct' },
    { label: 'EPA / Game', hover: 'EPA per game on havoc plays (Offense lost / Defense inflicted)', off: 'havoc_EPAgame_off', def: 'havoc_EPAgame_def', margin: 'havoc_EPAgame_margin', format: 'num2', sub: true },
];

/**
 * The 15 value columns the table reads. Not their `_rank`s: `retrieveTeamSummaries`
 * appends `_rank` to every column it is handed, and a `_rank_rank` is a 400.
 */
export function fiveFactorColumns(): string[] {
    return FIVE_FACTORS.flatMap((f) => [f.off, f.def, f.margin]).filter((c): c is string => c !== null);
}

/** A factor cell's number: rates as percentages, margins signed, an em dash when absent. */
export function formatFactor(value: unknown, format: FactorFormat, signed = false): string {
    const x = numberOrNull(value);
    if (x === null) return '—';
    const shown = format === 'pct' ? 100 * x : x;
    const fixed = format === 'num2' ? 2 : 1;
    const text = signed ? generateMarginalString(shown, 2, fixed) : roundNumber(shown, 2, fixed);
    return format === 'pct' ? `${text}%` : text;
}
