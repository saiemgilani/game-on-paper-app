/**
 * The pure steps of /<nba|wnba>/standings (BB-G23): which season is current, the conference tables with their seed
 * groups (playoff spots, the NBA's play-in, the lottery), the division tables, the projected first round and the
 * lottery odds grid. Nothing here computes a rank, a percentile or a probability: the official seeds and division ranks
 * are sdv-py nba_season_standings', the odds nba_season_sim's and nba_draft_lottery_odds' (resources/playoffPicture.ts).
 * The page reads, orders and formats. The snapshot pick is the college page's (utils/bracketology.ts pickSnapshot).
 */
import type { LotteryOddsRow, ProSimRow, ProStandingRow } from '../resources/playoffPicture';

export type ProLeague = 'nba' | 'wnba';

/** The first season sdv-db holds pro season snapshots for (BB-D18 shipped the 2025-26 NBA and 2026 WNBA backfills). */
export const PRO_SNAPSHOT_FIRST_SEASON = 2026;

/**
 * The pro season a day belongs to (END year). NBA: August on is next season (the college rule; the Finals end in June).
 * WNBA: its calendar year until the Finals are over, so from November the page is about next season, which has no
 * snapshot until opening night and falls back to the last one's final day.
 */
export function proSeasonOf(league: ProLeague, day: Date): number {
    const next = league === 'nba' ? day.getUTCMonth() >= 7 : day.getUTCMonth() >= 10;
    return day.getUTCFullYear() + (next ? 1 : 0);
}

/** Each league's postseason format, as the producer applies it (sdv-py nba_season_rules). */
export const PRO_FORMAT = {
    /** NBA: seeds 1-6 go straight in, 7-10 play in, 11-15 are the lottery; four picks are drawn */
    nba: { direct: 6, playIn: 10, drawn: 4 },
    /** WNBA: one league table, the top eight make it, no play-in; two picks are drawn */
    wnba: { direct: 8, playIn: 8, drawn: 2 },
} as const satisfies Record<ProLeague, { direct: number; playIn: number; drawn: number }>;

/** A team on the snapshot day: the sim's row and the official standings row (null when that day has no standings). */
export interface ProTeam { sim: ProSimRow; standing: ProStandingRow | null }

export interface ProTable { name: string; rows: ProTeam[] }

/** The sim rows joined to their standings rows by team_id (one stats.nba.com id space, both Int64 in the producer). */
export function joinTeams(sims: ProSimRow[], standings: ProStandingRow[]): ProTeam[] {
    const byId = new Map(standings.map((s) => [s.team_id, s]));
    return sims.map((sim) => ({ sim, standing: byId.get(sim.team_id) ?? null }));
}

/** Official seed first; a team with no standings row (a sim-only day) by its mean simulated seed, after the seeded ones. */
const bySeed = (a: ProTeam, b: ProTeam) =>
    (a.standing?.seed ?? Infinity) - (b.standing?.seed ?? Infinity) || (a.sim.mean_seed ?? Infinity) - (b.sim.mean_seed ?? Infinity);

/** One table per conference (the WNBA's single 'WNBA' table), East before West, each in seed order. */
export function conferenceTables(teams: ProTeam[]): ProTable[] {
    const names = [...new Set(teams.map((t) => t.sim.conference ?? ''))].sort();
    return names.map((name) => ({ name, rows: teams.filter((t) => (t.sim.conference ?? '') === name).sort(bySeed) }));
}

/** NBA divisions, East's three then West's, each by the official division rank (the WNBA has none: empty). */
export function divisionTables(league: ProLeague, teams: ProTeam[]): ProTable[] {
    if (league !== 'nba') return [];
    const key = (t: ProTeam) => `${t.sim.conference ?? ''}|${t.sim.division ?? ''}`;
    return [...new Set(teams.map(key))].sort().map((k) => ({
        name: k.split('|')[1],
        rows: teams.filter((t) => key(t) === k).sort((a, b) => (a.standing?.division_rank ?? Infinity) - (b.standing?.division_rank ?? Infinity) || bySeed(a, b)),
    }));
}

export interface SeedGroup { key: 'direct' | 'play_in' | 'out' | 'all'; label: string | null; rows: ProTeam[] }

/**
 * A conference table cut at the format's lines by official seed: the playoff spots, the NBA's play-in (7-10) and the
 * rest. A day without standings (any row unseeded) is one unlabelled group, in mean-seed order, since there is no
 * official line to cut at. A group with no team is left out.
 */
export function seedGroups(league: ProLeague, rows: ProTeam[]): SeedGroup[] {
    if (rows.some((r) => r.standing?.seed == null)) {
        // a partial day too: a seeded-first order would mix the two orders (Copilot on #395)
        return [{ key: 'all', label: null, rows: [...rows].sort((a, b) => (a.sim.mean_seed ?? Infinity) - (b.sim.mean_seed ?? Infinity)) }];
    }
    const { direct, playIn } = PRO_FORMAT[league];
    const seed = (r: ProTeam) => r.standing!.seed;
    return ([
        { key: 'direct', label: league === 'nba' ? 'Playoff spots (1-6)' : 'Playoff spots (1-8)', rows: rows.filter((r) => seed(r) <= direct) },
        { key: 'play_in', label: 'Play-in (7-10)', rows: rows.filter((r) => seed(r) > direct && seed(r) <= playIn) },
        { key: 'out', label: 'Outside the field', rows: rows.filter((r) => seed(r) > playIn) },
    ] satisfies SeedGroup[]).filter((g) => g.rows.length > 0);
}

/** A bracket line: a seeded team, or (NBA) a slot the play-in fills, labelled. */
export type BracketUnit<T> = { seed: number; team: T } | { seed: number; label: string };

export interface ProBracketRound<T> { name: string; games: [BracketUnit<T>, BracketUnit<T>][] }

/**
 * The first round if the season ended on the snapshot day, from the official seeds: top to bottom 1-8, 4-5, 3-6, 2-7,
 * so the two halves meet as the leagues' brackets do (never reseeded). NBA: seeds 7-10 play in first (7 v 8, 9 v 10),
 * and the 7 and 8 slots are the play-in's. null when the day's standings do not seat every seed the bracket needs once.
 */
export function projectedBracket(league: ProLeague, rows: ProTeam[]): ProBracketRound<ProTeam>[] | null {
    const { direct, playIn } = PRO_FORMAT[league];
    const at = new Map<number, ProTeam>();
    for (const r of rows) if (r.standing?.seed != null) at.set(r.standing.seed, r);
    const need = Math.max(playIn, 8);
    for (let s = 1; s <= need; s++) if (rows.filter((r) => r.standing?.seed === s).length !== 1) return null;
    const team = (s: number): BracketUnit<ProTeam> => (s <= direct ? { seed: s, team: at.get(s)! } : { seed: s, label: 'Play-in winner' });
    const first: ProBracketRound<ProTeam> = { name: 'First Round', games: [[team(1), team(8)], [team(4), team(5)], [team(3), team(6)], [team(2), team(7)]] };
    if (playIn === direct) return [first];
    const seat = (s: number): BracketUnit<ProTeam> => ({ seed: s, team: at.get(s)! });
    return [{ name: 'Play-In', games: [[seat(7), seat(8)], [seat(9), seat(10)]] }, first];
}

/** The teams with a lottery chance, best projected pick first (mean_pick; the WNBA's null picks by lottery chance, then fewest projected wins). */
export function lotteryTeams(teams: ProTeam[]): ProTeam[] {
    return teams
        .filter((t) => (t.sim.p_lottery ?? 0) > 0)
        .sort((a, b) => (a.sim.mean_pick ?? Infinity) - (b.sim.mean_pick ?? Infinity) || (b.sim.p_lottery ?? 0) - (a.sim.p_lottery ?? 0) || a.sim.proj_wins - b.sim.proj_wins);
}

export interface LotterySlot { slot: number; chances: number | null; byPick: (number | null)[] }

/** lottery_odds' (slot, pick) rows as one row per pre-lottery slot (1 = the worst record), a column per pick. */
export function lotteryGrid(rows: LotteryOddsRow[]): { picks: number[]; slots: LotterySlot[] } {
    const picks = [...new Set(rows.map((r) => r.pick))].sort((a, b) => a - b);
    const slots = [...new Set(rows.map((r) => r.lottery_slot))].sort((a, b) => a - b).map((slot) => {
        const own = rows.filter((r) => r.lottery_slot === slot);
        return { slot, chances: own[0]?.chances ?? null, byPick: picks.map((p) => own.find((r) => r.pick === p)?.probability ?? null) };
    });
    return { picks, slots };
}
