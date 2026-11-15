/**
 * Points over expected's pure steps (BB-G15): pick a game's two team rows, split a team-season into its team row and its
 * shooters, and the one model note every surface shows. Nothing here aggregates: each number is sdv-db's (BB-D9).
 */
import { BASKETBALL } from '../basketball/config';
import type { ShotQualityRow } from '../resources/shotQuality';
import type { BasketballLeague } from './league';

/** What xPTS is, and is not: sdv-db #195's cell, in page copy. */
export const XPTS_NOTE = "Expected points (xPTS) price each field goal at the league's make rate from that spot and shot value over the year before the game; shot type and the defender are not in the model. Field goals only, no free throws. ± is one standard error.";

/** The stats team id the NBA/WNBA shot tables use for an ESPN team; college tables use ESPN's id. */
function shotTeamId(league: BasketballLeague, espnId: number): number | null {
    if (BASKETBALL[league].currentMembers) return espnId;
    return BASKETBALL[league].teams.byEspnId(espnId)?.team_id ?? null;
}

/** A game's two team rows; both or neither (`{}`: the page shows nothing). */
export interface GameShotQuality { home?: ShotQualityRow; away?: ShotQualityRow }

/** A game's two team rows, or null unless both are there and from the same game (a day's read holds every game). */
export function gameTeams(rows: ShotQualityRow[], league: BasketballLeague, homeEspnId: number, awayEspnId: number): Required<GameShotQuality> | null {
    const [h, a] = [shotTeamId(league, homeEspnId), shotTeamId(league, awayEspnId)];
    const team = rows.filter((r) => r.level === 'team');
    const home = team.find((r) => r.team_id === h);
    const away = team.find((r) => r.team_id === a && r.game_id === home?.game_id);
    return home && away ? { home, away } : null;
}

/** A team-season's team row and its shooters, most points over expected first (a missing poe last). */
export function teamShooters(rows: ShotQualityRow[]): { team: ShotQualityRow | null; players: ShotQualityRow[] } {
    const team = rows.find((r) => r.level === 'team') ?? null;
    const players = rows.filter((r) => r.level === 'player' && r.person_id != null).sort((a, b) => (b.poe ?? -Infinity) - (a.poe ?? -Infinity) || a.person_id! - b.person_id!);
    return { team, players };
}

/** +12.3 / −4.0, one decimal, the minus sign fmtPts writes beside it (a value that rounds to zero is +0.0); a dash when absent. */
export function signed1(v: number | null | undefined): string {
    if (v == null) return '—';
    const r = Math.round(v * 10) / 10;
    return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}
