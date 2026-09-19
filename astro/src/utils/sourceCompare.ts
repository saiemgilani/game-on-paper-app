/**
 * Admin tool: the selected processing source against ESPN, on the aggregates
 * the processor already computed.
 *
 * Nothing is recomputed from the plays here -- every number is read straight
 * out of the advanced box score both payloads carry, so a difference in this
 * table is a difference in the SOURCE, not in this file's arithmetic. The play
 * count and the first play id that disagrees say whether the two feeds even
 * describe the same game; a play-by-play diff view is deliberately not here.
 */
import type { ProcessedGame } from '../resources/python';

export interface CompareRow {
    label: string;
    /** decimals for roundNumber(value, power10, fixed) */
    fixed: number;
    /** rendered as a percentage */
    percent?: boolean;
    selected: number | null;
    espn: number | null;
    /** selected - espn, null when either side is missing the metric */
    delta: number | null;
}

export interface SourceComparison {
    /** one block per team, in the payload's own column order */
    teams: { id: string; rows: CompareRow[] }[];
    playsSelected: number;
    playsEspn: number;
    /** the first play id the two payloads disagree on, in order */
    firstDifferingPlayId: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// The box score stores rates as fractions and every team table renders them
// `100.0 * rate` with a % (TeamMetricsTable). Scale here so the delta column is
// in percentage points rather than thousandths.
const pct = (v: unknown): number | null => { const n = num(v); return n === null ? null : n * 100; };

const row = (label: string, fixed: number, selected: number | null, espn: number | null, percent = false): CompareRow => ({
    label, fixed, percent, selected, espn,
    delta: selected === null || espn === null ? null : selected - espn,
});

/** The team's row in each box-score section, matched on `pos_team`. */
function teamRows(game: ProcessedGame | null | undefined, teamId: string) {
    const box = game?.advBoxScore;
    const find = (rows: any[] | undefined) => (rows ?? []).find((r) => String(r?.pos_team ?? '') === teamId);
    return {
        team: find(box?.team as any[]),
        situational: find(box?.situational as any[]),
        turnover: find(box?.turnover as any[]),
        drives: find(box?.drives as any[]),
    };
}

export function compareSources(selected: ProcessedGame, espn: ProcessedGame | null): SourceComparison {
    // Column order comes from the payload being displayed, so the table lines
    // up with every other team table on the page (away, home).
    const teamIds = [selected.teamInfo?.away?.id, selected.teamInfo?.home?.id]
        .filter((id) => id != null).map(String);

    const teams = teamIds.map((id) => {
        const a = teamRows(selected, id);
        const b = teamRows(espn, id);
        return {
            id,
            rows: [
                row('Plays', 0, num(a.team?.EPA_plays), num(b.team?.EPA_plays)),
                row('EPA/Play', 2, num(a.team?.EPA_per_play), num(b.team?.EPA_per_play)),
                row('Success Rate', 1, pct(a.situational?.EPA_success_rate), pct(b.situational?.EPA_success_rate), true),
                row('Explosive Play Rate', 1, pct(a.team?.EPA_explosive_rate), pct(b.team?.EPA_explosive_rate), true),
                row('Turnovers', 0, num(a.turnover?.turnovers), num(b.turnover?.turnovers)),
                row('Drives', 0, num(a.drives?.drives), num(b.drives?.drives)),
            ],
        };
    });

    const selectedPlays = selected.plays ?? [];
    const espnPlays = espn?.plays ?? [];
    let firstDifferingPlayId: string | null = null;
    for (let i = 0; i < Math.max(selectedPlays.length, espnPlays.length); i++) {
        const a = selectedPlays[i]?.id, b = espnPlays[i]?.id;
        if (String(a ?? '') !== String(b ?? '')) { firstDifferingPlayId = String(a ?? b ?? ''); break; }
    }

    return {
        teams,
        playsSelected: selectedPlays.length,
        playsEspn: espnPlays.length,
        firstDifferingPlayId,
    };
}
