/**
 * The pure steps of /nba/cup (BB-G30): the six group tables in the Cup's tiebreak order, each conference's wild-card
 * race, the knockout bracket and the odds table. Nothing here computes a rank, a seed or a probability: the group
 * ranks, conference ranks and knockout seeds are sdv-py nba_cup_standings', the odds nba_cup_sim's
 * (resources/nbaCup.ts). The page reads, orders and formats. The snapshot pick is the college page's
 * (utils/bracketology.ts pickSnapshot).
 */
import type { CupSimRow, CupStandingRow } from '../resources/nbaCup';

/** The first season sdv-db holds Cup snapshots for: 2026-27 (the S3 schedule holds the live season only, so no history before it). */
export const CUP_FIRST_SEASON = 2027;

/** A team on the snapshot day: the sim's row and the standings row (null when that day has no standings for it). */
export interface CupTeam { sim: CupSimRow; standing: CupStandingRow | null }

export interface CupTable { name: string; rows: CupTeam[] }

/** The sim rows joined to their standings rows by team_id (one stats.nba.com id space, both Int64 in the producer). */
export function joinCup(sims: CupSimRow[], standings: CupStandingRow[]): CupTeam[] {
    const byId = new Map(standings.map((s) => [s.team_id, s]));
    return sims.map((sim) => ({ sim, standing: byId.get(sim.team_id) ?? null }));
}

/** The group rank under the Cup tiebreakers; a team with no standings row after the ranked ones, by mean simulated rank. */
const byGroupRank = (a: CupTeam, b: CupTeam) =>
    (a.standing?.group_rank ?? Infinity) - (b.standing?.group_rank ?? Infinity) || (a.sim.mean_group_rank ?? Infinity) - (b.sim.mean_group_rank ?? Infinity);

/** The six groups, East A-C then West A-C, each in group-rank order. */
export function groupTables(teams: CupTeam[]): CupTable[] {
    return [...new Set(teams.map((t) => t.sim.cup_group))].sort().map((name) => ({
        name, rows: teams.filter((t) => t.sim.cup_group === name).sort(byGroupRank),
    }));
}

/**
 * Each conference's wild-card race: every team not leading its group, by the producer's conference rank (the three
 * runners-up first, since the wild card is the best of them, then the rest). Teams without a standings row are left
 * out: there is no official order to place them in.
 */
export function wildCardRace(teams: CupTeam[]): CupTable[] {
    return [...new Set(teams.map((t) => t.sim.conference))].sort().map((name) => ({
        name,
        rows: teams
            .filter((t) => t.sim.conference === name && t.standing != null && !t.standing.leads_group)
            .sort((a, b) => a.standing!.conference_rank - b.standing!.conference_rank),
    }));
}

/** Every team by its title chance, then the chance to reach each earlier round. */
export function oddsOrder(teams: CupTeam[]): CupTeam[] {
    const keys = ['p_champion', 'p_final', 'p_semifinal', 'p_quarterfinal', 'p_win_group'] as const;
    return [...teams].sort((a, b) => {
        for (const k of keys) if (a.sim[k] !== b.sim[k]) return b.sim[k] - a.sim[k];
        return 0;
    });
}

/** How the tiebreak column names sdv-py's criteria (nba_cup GROUP_TIEBREAKERS, then the drawing). */
export const TIEBREAK_LABEL: Record<string, string> = {
    head_to_head: 'Head-to-head',
    point_diff: 'Point differential',
    points: 'Points scored',
    prior_record: "Last season's record",
    random: 'Drawing',
};

/** A bracket line: a seated team, or a slot a game still to be played fills, labelled (no seed). */
export type CupUnit = { seed: number; team: CupTeam } | { label: string };

/** A round's games, and the sim column each seated team's number is: its chance to reach the next round. */
export interface CupBracketRound { name: string; games: [CupUnit, CupUnit][]; next: 'p_semifinal' | 'p_final' | 'p_champion' }

/**
 * The Cup window, November and December (Group Play opens in early November; the final is mid-December), by the US
 * Eastern calendar day: when the Header lists the Cup page.
 */
export function isCupWindow(day: Date = new Date()): boolean {
    const m = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/New_York' }).format(day));
    return m === 11 || m === 12;
}

/**
 * The knockout on the current table: in each conference 1 v 4 and 2 v 3 (East's two, then West's, so each semifinal sits
 * between its quarterfinals), the conference semifinals, then East v West. A later slot seats a team once the sim says
 * it reached that round for certain (the producer plays the knockout's actual results), else it names the game that
 * fills it. `champion` is the team at p_champion 1 (the final day), else null. null when either conference's standings
 * do not seat knockout seeds 1-4 exactly once.
 */
export function cupBracket(teams: CupTeam[]): { rounds: CupBracketRound[]; champion: CupTeam | null } | null {
    const confs = ['East', 'West'];
    const seat = new Map<string, CupTeam>();
    for (const c of confs) {
        for (let s = 1; s <= 4; s++) {
            const at = teams.filter((t) => t.sim.conference === c && t.standing?.knockout_seed === s);
            if (at.length !== 1) return null;
            seat.set(`${c}${s}`, at[0]);
        }
    }
    const unit = (c: string, s: number): CupUnit => ({ seed: s, team: seat.get(`${c}${s}`)! });
    // the one team of `from` the sim has through to the round (p 1), else the label
    const through = (from: CupTeam[], key: 'p_semifinal' | 'p_final', label: string): CupUnit => {
        const won = from.find((t) => t.sim[key] === 1);
        return won ? { seed: won.standing!.knockout_seed!, team: won } : { label };
    };
    const pair = (c: string, a: number, b: number) => [seat.get(`${c}${a}`)!, seat.get(`${c}${b}`)!];
    const conf = (c: string) => [...pair(c, 1, 4), ...pair(c, 2, 3)];
    return {
        rounds: [
            { name: 'Quarterfinals', next: 'p_semifinal', games: confs.flatMap((c) => [[unit(c, 1), unit(c, 4)], [unit(c, 2), unit(c, 3)]] as [CupUnit, CupUnit][]) },
            { name: 'Semifinals', next: 'p_final', games: confs.map((c) => [through(pair(c, 1, 4), 'p_semifinal', `${c} 1-4 winner`), through(pair(c, 2, 3), 'p_semifinal', `${c} 2-3 winner`)]) },
            { name: 'Championship', next: 'p_champion', games: [[through(conf('East'), 'p_final', 'East winner'), through(conf('West'), 'p_final', 'West winner')]] },
        ],
        champion: teams.find((t) => t.sim.p_champion === 1 && t.standing?.knockout_seed != null) ?? null,
    };
}
