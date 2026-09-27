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
    off: string;
    def: string;
    margin: string;
    format: FactorFormat;
}

export const FIVE_FACTORS: FiveFactor[] = [
    { label: 'Efficiency', hover: 'Success Rate', off: 'success_off', def: 'success_def', margin: 'success_margin', format: 'pct' },
    { label: 'Explosiveness', hover: 'Explosive Play Rate', off: 'explosive_off', def: 'explosive_def', margin: 'explosive_margin', format: 'pct' },
    { label: 'Field Position', hover: 'Starting Field Position (yards to goal)', off: 'start_position_off', def: 'start_position_def', margin: 'start_position_margin', format: 'num1' },
    { label: 'Finishing Drives', hover: 'Points per Scoring Opportunity', off: 'pts_per_opp_off', def: 'pts_per_opp_def', margin: 'pts_per_opp_margin', format: 'num2' },
    { label: 'Turnovers', hover: 'Turnovers per Game', off: 'turnovers_off', def: 'turnovers_def', margin: 'turnover_margin', format: 'num2' },
];

/**
 * The 15 value columns the table reads. Not their `_rank`s: `retrieveTeamSummaries`
 * appends `_rank` to every column it is handed, and a `_rank_rank` is a 400.
 */
export function fiveFactorColumns(): string[] {
    return FIVE_FACTORS.flatMap((f) => [f.off, f.def, f.margin]);
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
