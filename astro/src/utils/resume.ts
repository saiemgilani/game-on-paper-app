import type { SDVGame } from '../resources/sdv';
import type { League } from './league';
import { numberOrNull } from './misc';

/**
 * The season team page's Record table: the team's record over the season's
 * schedule rows (`teamSeason.events`, already read for the TeamCard), split by
 * where the game was played and who it was against. Completed games only,
 * postseason included; a tie is its own column of the record, never a loss.
 */

/** One completed game from the team's side: everything a split row tests. */
interface TeamGame {
    home: boolean;
    neutral: boolean;
    conference: boolean;
    /** points for minus points against */
    margin: number;
    oppDivision: string | null;
    /** the opponent's rank at kickoff, 1-25; null when unranked */
    oppRank: number | null;
}

export interface ResumeRowDef {
    key: string;
    label: string;
    /** hover copy for a label that needs its definition */
    title?: string;
    /** the leagues the row applies to; every league when absent */
    leagues?: League[];
    test: (g: TeamGame) => boolean;
}

// Home / Away / Neutral partition Overall, which closes the table as its total,
// the way the player splits end on All plays.
export const RESUME_ROWS: ResumeRowDef[] = [
    { key: 'home', label: 'Home', test: (g) => g.home && !g.neutral },
    { key: 'away', label: 'Away', test: (g) => !g.home && !g.neutral },
    { key: 'neutral', label: 'Neutral site', test: (g) => g.neutral },
    { key: 'conference', label: 'Conference', leagues: ['cfb'], test: (g) => g.conference },
    // nfl.espn_schedule's conference_game is nflverse div_game, as the TeamCard's "Div" record says
    { key: 'division', label: 'Division', leagues: ['nfl'], test: (g) => g.conference },
    { key: 'one_score', label: 'One-score', title: 'Final margin of 8 points or fewer', test: (g) => Math.abs(g.margin) <= 8 },
    { key: 'fbs', label: 'vs FBS', leagues: ['cfb'], test: (g) => g.oppDivision === 'fbs' },
    { key: 'ranked', label: 'vs Ranked', title: 'Opponent ranked at kickoff', leagues: ['cfb'], test: (g) => g.oppRank !== null },
    { key: 'overall', label: 'Overall', test: () => true },
];

export interface ResumeRow {
    key: string;
    label: string;
    title?: string;
    wins: number;
    losses: number;
    ties: number;
    /** (W + T/2) / games; null for a row with no games */
    winPct: number | null;
    /** average of points for minus points against; null for a row with no games */
    avgMargin: number | null;
}

/** "11-4", or "10-6-1" when the row holds a tie. */
export function formatRecord(r: { wins: number; losses: number; ties: number }): string {
    return `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`;
}

export function resumeRows(events: SDVGame[], teamId: string | number, league: League): ResumeRow[] {
    // the vs Ranked row needs the schedule's rank fields; a table without them has no such row
    const hasRanks = events.some((g) => g.home_rank !== undefined || g.away_rank !== undefined);
    const games: TeamGame[] = [];
    for (const g of events) {
        const hp = numberOrNull(g.home_points);
        const ap = numberOrNull(g.away_points);
        if (!g.completed || hp === null || ap === null) continue;
        const home = String(g.home_id) === String(teamId);
        games.push({
            home,
            neutral: g.neutral_site === true,
            conference: g.conference_game === true,
            margin: home ? hp - ap : ap - hp,
            oppDivision: (home ? g.away_division : g.home_division) ?? null,
            oppRank: numberOrNull(home ? g.away_rank : g.home_rank),
        });
    }
    return RESUME_ROWS
        .filter((r) => (!r.leagues || r.leagues.includes(league)) && (r.key !== 'ranked' || hasRanks))
        .map(({ key, label, title, test }) => {
            const split = games.filter(test);
            const wins = split.filter((g) => g.margin > 0).length;
            const losses = split.filter((g) => g.margin < 0).length;
            const ties = split.length - wins - losses;
            const n = split.length;
            return {
                key, label, title, wins, losses, ties,
                winPct: n === 0 ? null : (wins + ties / 2) / n,
                avgMargin: n === 0 ? null : split.reduce((t, g) => t + g.margin, 0) / n,
            };
        });
}
