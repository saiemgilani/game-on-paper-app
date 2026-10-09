import type { SDVSeasonPercentile } from '../resources/sdv';
import { BOX_SCORE_NON_RATE_DECIMAL_COLUMNS, BOX_SCORE_NON_RATE_PERCENT_COLUMNS } from './constants';
import { generateColorRampValue, getNumberWithOrdinal, numberOrNull, offenseYardsPerPlay, roundNumber, yardsPerDropback } from './misc';

/** The SDV percentile-ladder column each Binion box row is ranked against. */
export const BOX_PERCENTILE_KEYS: Record<string, string> = {
    "EPA_per_play": "EPAplay",
    "EPA_passing_per_play": "EPAdropback",
    "EPA_rushing_per_play": "EPArush",
    "havoc_total": "havoc",
    "EPA_success": "success",
    "EPA_explosive": "explosive",
    "yards_per_pass": "yardsdropback",
    "yards_per_play": "yardsplay",
    "rushing_stuff": "play_stuffed",
    "EPA_success_rate_third": "third_down_success",
    "EPA_success_rate_rz": "red_zone_success",
};

export interface BoxScorePercentile {
    pctl: number | null
    min: number | null
    mid: number | null
    max: number | null
}

// equal within float noise: box rates and ladder breakpoints are both doubles
const EPS = 1e-9;

/**
 * Where `value` sits on one season's percentile ladder (one row per `pctile`,
 * 0.01-0.99). A value equal to a run of breakpoints ranks at the middle of the
 * run, not its top: a red-zone success rate of 0.5 that fills breakpoints 55-65
 * is the 60th percentile, not the 65th. `pctl` is null when there is no value or
 * no ladder column for `key`; min/mid/max describe the ladder.
 */
export function boxScorePercentile(percentiles: SDVSeasonPercentile[], key: string, value: number | null): BoxScorePercentile {
    const column = BOX_PERCENTILE_KEYS[key];
    const ladder = column
        ? percentiles.map((p) => numberOrNull((p as any)[column])).filter((x): x is number => x !== null).sort((a, b) => a - b)
        : [];
    if (ladder.length == 0) return { pctl: null, min: null, mid: null, max: null };
    let pctl: number | null = null;
    if (value !== null) {
        const below = ladder.filter((x) => x < value - EPS).length;
        const tied = ladder.filter((x) => Math.abs(x - value) <= EPS).length;
        pctl = Math.round(below + tied / 2);
    }
    return { pctl, min: ladder[0], mid: ladder[Math.floor(ladder.length / 2)], max: ladder[ladder.length - 1] };
}

type Format = (x: number | null) => string;
const decimal: Format = (x) => roundNumber(x, 2, 2);
const percent: Format = (x) => `${roundNumber((x || 0) * 100, 2, 0)}%`;

/** One team's value for a box row, null when the payload has none, and how it prints. */
function boxValue(team: Record<string, any>, key: string): [number | null, Format] {
    // both sack-inclusive, the basis of the `yardsplay` / `yardsdropback` ladders
    if (key == "yards_per_play") return [offenseYardsPerPlay(team), decimal];
    if (key == "yards_per_pass") return [yardsPerDropback(team), decimal];
    if (BOX_SCORE_NON_RATE_DECIMAL_COLUMNS.includes(key)) return [numberOrNull(team?.[key]), decimal];
    // a rate: third-down and red-zone success carry it under their own key, the rest as `<key>_rate`
    return [numberOrNull(BOX_SCORE_NON_RATE_PERCENT_COLUMNS.includes(key) ? team?.[key] : team?.[`${key}_rate`]), percent];
}

/**
 * The cells of one Binion box row, one per team, as HTML. `item` is
 * `<section>.<key>` or a bare `team` key. A team without the value (no red-zone
 * snaps, say) gets a dash and no percentile; with no ladder (none published,
 * or a partial-game span) the values print without percentiles or colours.
 */
export function binionBoxCells(box: Record<string, any[]>, item: string, percentiles: SDVSeasonPercentile[]): string {
    const [section, key] = item.includes('.') ? item.split('.') : ['team', item];
    const teams = [...(box?.[section] ?? [])];
    // the run-stuff rate is the defense's: shown under the team that made the stops
    if (key.includes('rushing_stuff')) teams.reverse();
    return teams.map((team) => {
        const [value, format] = boxValue(team, key);
        if (value === null) return `<td class="numeral" style="text-align: center;">—</td>`;
        const pct = boxScorePercentile(percentiles, key, value);
        if (pct.pctl === null) return `<td class="numeral" style="text-align: center;">${format(value)}</td>`;
        const ramp = generateColorRampValue(pct.pctl, 100);
        return `<td class="numeral${ramp ? ` ${ramp}` : ''}" style="text-align: center;" title="Worst: ${format(pct.min)}\nMedian: ${format(pct.mid)}\nBest: ${format(pct.max)}">${format(value)} <small class="align-self-center" style="opacity: 50%">${getNumberWithOrdinal(pct.pctl)} %ile</small></td>`;
    }).join('');
}
