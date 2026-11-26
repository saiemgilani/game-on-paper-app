/**
 * G18 ('quarter-epa'): each team's expected points added by quarter, the EPA of every play it had the ball for
 * (offense, its kicks and its penalties: the plays the Team Stats "Expected Points" Total row sums).
 *
 * The sanity gate: EPA telescopes to the scoreboard margin, not to either team's points (one team's punts and turnovers
 * are scored as the other's field position), so the game's net EPA is checked against the final margin. A feed with
 * a scrimmage play missing its EPA, or whose net EPA strays from the margin by more than two touchdowns, gets no table.
 */

/** Two touchdowns. The real finals in test/fixtures land 0.2 to 8.9 points from their margins (kickoff and try EP). */
export const EPA_MARGIN_TOLERANCE = 14;
/** Four quarters and eight overtimes; the longest college game went to a ninth. */
const MAX_PERIODS = 12;

export interface QuarterEpaRow {
    teamId: string;
    /** one entry per period played, regulation then overtimes */
    byPeriod: number[];
    total: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Rows in `teamIds` order, or null when the gate fails. `margin` is the final score of the first team minus the second.
 */
export function quarterEpa(plays: readonly any[], teamIds: readonly [string | number, string | number], margin: number): QuarterEpaRow[] | null {
    if (!plays.length || !finite(margin)) return null;
    const periods = Math.max(0, ...plays.map((p) => Number(p.period)).filter((n) => Number.isInteger(n) && n > 0));
    // a period no game reaches is a corrupt feed, not a column
    if (periods > MAX_PERIODS) return null;
    const rows = teamIds.map((id) => ({ teamId: String(id), byPeriod: new Array(periods).fill(0), total: 0 }));
    for (const p of plays) {
        const epa = p.expectedPoints?.added;
        if (!finite(epa)) {
            if (p.scrimmage_play == true) return null;
            continue;
        }
        const row = rows.find((r) => r.teamId === String(p.pos_team));
        const q = Number(p.period);
        if (!row || !(q >= 1 && q <= periods)) continue;
        row.byPeriod[q - 1] += epa;
        row.total += epa;
    }
    return Math.abs(rows[0].total - rows[1].total - margin) <= EPA_MARGIN_TOLERANCE ? rows : null;
}
