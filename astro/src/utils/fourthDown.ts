/**
 * The fourth-down decisions the game page grades, play by play (`DecisionCard` in the expanded play row) and summed per
 * team ('decision-summary'). Both read the processor's per-play model columns: nothing here re-runs the model.
 */

export type FourthDownChoice = 'go' | 'field_goal' | 'punt';

/** What the offense actually did, read off the play flags; null when ambiguous (a penalty-only row, say). */
export function fourthDownActual(play: any): FourthDownChoice | null {
    if (play.punt) return 'punt';
    if (play.fg_attempt) return 'field_goal';
    if (play.pass || play.rush || play.sack_vec) return 'go';
    return null;
}

/**
 * What the per-team summary counts: only the snap that stands, read off the processor's flags. A kneel is no decision.
 * A penalty on a punt or field goal (`punt_play` / `fg_attempt` read the play text) is skipped, and so is a no-play
 * (a false start, delay of game, or a snap wiped out and replayed). A run or pass the defense's foul turned into a
 * first down (`first_down_penalty`) is a "go". The per-play card keeps fourthDownActual.
 */
export function fourthDownDecision(play: any): FourthDownChoice | null {
    if (play.kneel_down === true) return null;
    if (play.penalty_flag === true) {
        if (play.punt || play.punt_play || play.fg_attempt) return null;
        if (play.first_down_penalty === true) return 'go';
        if (play.penalty_no_play === true) return null;
    }
    return fourthDownActual(play);
}

/** A play the card grades: a fourth down with a model recommendation. */
export const isGradedFourthDown = (play: any) => play?.start?.down == 4 && !!play.fourth_down_recommendation;

const WP_KEY: Record<FourthDownChoice, string> = { go: 'go_wp', field_goal: 'fg_wp', punt: 'punt_wp' };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface FourthDownTeamSummary {
    teamId: string;
    /** graded fourth downs where the choice can be read off the play */
    decisions: number;
    /** of those, how many matched the model's recommendation */
    agreed: number;
    /** win probability (0-1) given up on the disagreements: the recommended option's WP minus the chosen one's, summed */
    wpLost: number;
}

/**
 * One row per team, in `teamIds` order: its graded fourth downs, how many agreed with the model and the win probability
 * lost where they did not. A disagreement whose WPs the play does not carry still counts as a decision, adding no WP.
 */
export function fourthDownSummary(plays: readonly any[], teamIds: readonly (string | number)[]): FourthDownTeamSummary[] {
    const rows = new Map(teamIds.map((id) => [String(id), { teamId: String(id), decisions: 0, agreed: 0, wpLost: 0 }]));
    for (const p of plays) {
        if (!isGradedFourthDown(p)) continue;
        const actual = fourthDownDecision(p);
        const row = rows.get(String(p.start?.pos_team?.id));
        if (!actual || !row) continue;
        row.decisions += 1;
        const rec = p.fourth_down_recommendation as FourthDownChoice;
        if (rec === actual) {
            row.agreed += 1;
            continue;
        }
        const best = p[WP_KEY[rec]], chosen = p[WP_KEY[actual]];
        if (finite(best) && finite(chosen)) row.wpLost += Math.max(0, best - chosen);
    }
    return [...rows.values()];
}
