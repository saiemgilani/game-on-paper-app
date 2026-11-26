/**
 * B2/B3, behind 'cfb-schedule-effect': the team-season page's "Schedule effect" panel, from the producer's per-game
 * decomposition of the season Adj EPA/Play (sdv-py `cfb_adjusted_epa_ledger`, served as `team_adjustment_ledger`).
 * The season value is the sum of each game's contribution, and each contribution is a raw part (the team's own net
 * EPA/play on the fit's plays) plus a schedule part (the opponent's fitted strengths), so the panel only adds rows up.
 */
import type { SDVGame } from '../resources/sdv';

/** One team-game row of the ledger (the columns the panel reads). */
export interface LedgerRow {
    game_id: string | number;
    week?: number | null;
    season_type?: number | null;
    team_id: string | number;
    opponent_id: string | number;
    site: 'home' | 'away' | 'neutral';
    off_plays: number;
    def_plays: number;
    raw_net_epa: number | null;
    schedule_adj: number | null;
    adj_net_epa: number | null;
    raw_contribution: number;
    schedule_contribution: number;
    contribution: number;
    net_adj_epa: number;
    game_influence?: number | null;
}

/** The columns `retrieveTeamAdjustmentLedger` asks for. */
export const LEDGER_COLUMNS = ['game_id', 'week', 'season_type', 'team_id', 'opponent_id', 'site', 'off_plays', 'def_plays',
    'raw_net_epa', 'schedule_adj', 'adj_net_epa', 'raw_contribution', 'schedule_contribution', 'contribution', 'net_adj_epa',
    'game_influence'];

export interface LedgerGame extends LedgerRow { opponent: string }

export interface ScheduleEffect {
    /** the team's own net EPA/play on the fit's plays, unadjusted (sum of the raw parts) */
    raw: number;
    /** what the opponents' strengths add (sum of the schedule parts): the schedule effect */
    schedule: number;
    /** the season Adj EPA/Play (raw + schedule) */
    adjusted: number;
    games: number;
    offPlays: number;
    defPlays: number;
    /** the three games whose schedule part moved the value most, largest first */
    drivers: LedgerGame[];
    /** every game, in schedule order */
    rows: LedgerGame[];
}

/** Rows that do not add up to their own season value (to 1e-6) are not shown: the panel would contradict the number. */
export const SUM_TOLERANCE = 1e-6;

const opponentName = (row: LedgerRow, byGame: Map<string, SDVGame>): string => {
    const g = byGame.get(String(row.game_id));
    if (!g) return String(row.opponent_id);
    return String(g.home_id) === String(row.opponent_id) ? (g.home_team ?? String(row.opponent_id)) : (g.away_team ?? String(row.opponent_id));
};

export function scheduleEffect(rows: readonly LedgerRow[] | null | undefined, events: readonly SDVGame[] = []): ScheduleEffect | null {
    if (!rows?.length) return null;
    const raw = rows.reduce((s, r) => s + r.raw_contribution, 0);
    const schedule = rows.reduce((s, r) => s + r.schedule_contribution, 0);
    const adjusted = rows[0].net_adj_epa;
    if (!Number.isFinite(adjusted) || Math.abs(raw + schedule - adjusted) > SUM_TOLERANCE) return null;
    const byGame = new Map(events.map((g) => [String(g.game_id), g]));
    const games: LedgerGame[] = rows
        .map((r) => ({ ...r, opponent: opponentName(r, byGame) }))
        .toSorted((a, b) => (a.season_type ?? 0) - (b.season_type ?? 0) || (a.week ?? 0) - (b.week ?? 0) || String(a.game_id).localeCompare(String(b.game_id)));
    return {
        raw,
        schedule,
        adjusted,
        games: rows.length,
        offPlays: rows.reduce((s, r) => s + r.off_plays, 0),
        defPlays: rows.reduce((s, r) => s + r.def_plays, 0),
        drivers: games.toSorted((a, b) => Math.abs(b.schedule_contribution) - Math.abs(a.schedule_contribution)).slice(0, 3),
        rows: games,
    };
}

const signed = (v: number, digits = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
export const fmtEpa = (v: number | null | undefined, digits = 3): string => (v == null || !Number.isFinite(v) ? '—' : signed(v, digits));

/** "LSU's schedule adds +0.123 EPA/play: raw +0.016, adjusted +0.139." */
export function effectSentence(team: string, e: ScheduleEffect): string {
    const verb = e.schedule >= 0 ? 'adds' : 'takes away';
    return `${team}'s schedule ${verb} ${fmtEpa(Math.abs(e.schedule))} EPA/play: raw ${fmtEpa(e.raw)}, adjusted ${fmtEpa(e.adjusted)}.`;
}

/** B3: the weights beside the number. */
export function weightsCaption(e: ScheduleEffect): string {
    return `Averaged over ${e.games} FBS games, each counting equally; ${e.offPlays} offensive and ${e.defPlays} defensive plays in the fit. No preseason prior.`;
}
