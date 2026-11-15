/**
 * BB-G32's team stats grid (behind 'bball-team-grid'): which side each four-factor row favours and by how much, and the
 * four-factor point accounting, each team's points added or cost against a league-average possession. The game's rates
 * and box are sdv-py's (game page frames); the league average is the season's (resources/teamGrid.ts). Pure, so the
 * page and the tests share it.
 */
import type { NbaSide } from '../resources/nbaGame';
import type { TeamGridSeason } from '../resources/teamGrid';

export type Better = 'high' | 'low' | 'none';

/** The side whose value is better, and the gap between them; null when either side has no value or the row has no better. */
export function edge(better: Better, away: number | null, home: number | null): { side: 'away' | 'home' | null; gap: number } | null {
    if (better === 'none' || away == null || home == null) return null;
    const gap = Math.abs(away - home);
    if (gap === 0) return { side: null, gap };
    return { side: (better === 'high' ? away > home : away < home) ? 'away' : 'home', gap };
}

/** One side's points from each factor against a league-average possession; a null factor (no count to price) nulls `total`. */
export interface Accounting { shooting: number | null; turnovers: number | null; rebounding: number | null; freeThrows: number | null; total: number | null }

/**
 * The accounting, a linear pricing of each factor's distance from the league average. A "chance" is a possession that did
 * not end in a turnover, worth V = lg points per possession / (1 - lg TOV%):
 * - shooting: (eFG% - lg eFG%) x 2 x FGA, the points the same shots were worth above an average shooter's
 * - turnovers: (lg TOV% x possessions - TOV), the turnovers saved, each a chance worth V
 * - rebounding: (OREB - lg ORB% x (OREB + opponent DREB)), the extra offensive rebounds, each a new chance worth V
 * - free throws: (FTA - lg FT rate x FGA), the extra free throws, each worth the side's own FT% in the game (no league FT%
 *   is published) less the 0.44 of a chance a free throw uses (the box possession weight)
 * `possessions` is the side's counted possessions when the processor has them, else the box estimate. The total is the four
 * summed: close to, not equal to, the points against a league-average offense on the same possessions (on the four real
 * captures in test/teamGrid.test.ts, within 4 points). ponytail: linear prices, no fitted weights; swap in a regression's
 * when one is published.
 */
export function accounting(side: NbaSide, opponent: NbaSide, possessions: number | null, lg: TeamGridSeason['league']): Accounting {
    const b = side.box, efg = side.rates?.efg_pct ?? null;
    const none: Accounting = { shooting: null, turnovers: null, rebounding: null, freeThrows: null, total: null };
    if (!b || !lg) return none;
    const fga = b.field_goals_attempted, fta = b.free_throws_attempted, ftm = b.free_throws_made, orb = b.offensive_rebounds;
    const tov = b.total_turnovers, oppDrb = opponent.box?.defensive_rebounds ?? null;
    const price = (f: () => number, ...need: (number | null)[]) => (need.every((v) => v != null) ? f() : null);
    const shooting = price(() => (efg! - lg.efg_pct!) * 2 * fga!, efg, lg.efg_pct, fga);
    const chance = lg.tov_pct == null ? null : lg.ppp / (1 - lg.tov_pct);
    const turnovers = price(() => (lg.tov_pct! * possessions! - tov!) * chance!, chance, possessions, tov);
    const rebounding = price(() => (orb! - lg.orb_pct! * (orb! + oppDrb!)) * chance!, lg.orb_pct, chance, orb, oppDrb);
    // no free throws: no FT% to price the missing ones at, so the row (and the total) is a dash
    const freeThrows = fta === 0 ? null : price(() => (fta! - lg.ft_rate! * fga!) * (ftm! / fta! - 0.44 * chance!), lg.ft_rate, chance, fga, fta, ftm);
    const parts = [shooting, turnovers, rebounding, freeThrows];
    return { shooting, turnovers, rebounding, freeThrows, total: parts.every((p) => p != null) ? parts.reduce((s, p) => s! + p!, 0) : null };
}
