import type { PlayoffSeed } from "../resources/playoff";
import type { ESPNRankingsResponse } from "../resources/espn";

export interface BracketSlot {
    seed: number
    teamId: string
    /** this team's chance of beating the opponent drawn against it here; the champion's is its title chance, if the projected field holds */
    pct: number
}

export interface BracketRound {
    name: string
    games: [BracketSlot, BracketSlot][]
}

// Top to bottom so each later game sits between the two that feed it: the 1 and 4 quarterfinals
// meet in one semifinal, the 2 and 3 in the other (the CFP's fixed bracket, never reseeded).
const FIRST_ROUND: [number, number][] = [[8, 9], [5, 12], [7, 10], [6, 11]];
const BYES = [1, 4, 2, 3];

/**
 * The projected bracket, filled in: each game is the two teams drawn into it, each number is that
 * team's chance of beating the opponent shown (`beats`, the pregame model: the higher seed at home in
 * the first round, neutral after), and the favourite advances, so every team shown came out of the
 * game that feeds it. The champion's number is its title chance given this field
 * (python/playoff_projection.py _bracket_probs); the chance of making the field at all is the seeds table's.
 */
export function buildBracket(
    field: PlayoffSeed[],
    beats: (teamId: string, opponentId: string, home: boolean) => number,
): { rounds: BracketRound[], champion: BracketSlot } {
    const bySeed = new Map(field.map((s) => [s.seed, s]));
    const id = (seed: number) => bySeed.get(seed)!.team_id;
    const game = (a: number, b: number, home = false): [BracketSlot, BracketSlot] => {
        const p = beats(id(a), id(b), home);
        return [{ seed: a, teamId: id(a), pct: p }, { seed: b, teamId: id(b), pct: 1 - p }];
    };
    // the favourite in the matchup shown advances; a coin flip goes to the higher seed
    const winner = ([a, b]: [BracketSlot, BracketSlot]) => (b.pct > a.pct ? b.seed : a.seed);
    const pairs = <T>(xs: T[]): [T, T][] => xs.filter((_, i) => i % 2 === 0).map((x, i) => [x, xs[2 * i + 1]]);

    const first = FIRST_ROUND.map(([hi, lo]) => game(hi, lo, true));
    const quarters = BYES.map((bye, i) => game(bye, winner(first[i])));
    const semis = pairs(quarters).map(([a, b]) => game(winner(a), winner(b)));
    const final = pairs(semis).map(([a, b]) => game(winner(a), winner(b)));
    const rounds: BracketRound[] = [
        { name: 'First Round', games: first },
        { name: 'Quarterfinals', games: quarters },
        { name: 'Semifinals', games: semis },
        { name: 'National Championship', games: final },
    ];
    const champ = winner(final[0]);
    return { rounds, champion: { seed: champ, teamId: id(champ), pct: bySeed.get(champ)!.reach.champion } };
}

/** A probability as the page prints it: whole percents, with the tails kept honest. */
export function pct(p: number): string {
    if (p >= 0.995 && p < 1) return '>99%';
    if (p > 0 && p < 0.005) return '<1%';
    return `${Math.round(p * 100)}%`;
}

/**
 * The page's odds shading: green at 90% and up, fading to clear under 1% (the site's
 * `hulk-bg-level-6..9` greens; a probability has no "bad" end, so no purple). The cutoffs are
 * on what pct() prints, so every cell that reads "1%" is shaded and every "<1%" / "0%" is clear.
 */
export function oddsShade(p: number): string | null {
    if (p >= 0.895) return 'hulk-bg-level-9';
    if (p >= 0.495) return 'hulk-bg-level-8';
    if (p >= 0.095) return 'hulk-bg-level-7';
    if (p >= 0.005) return 'hulk-bg-level-6';
    return null;
}

export interface CommitteeRanking {
    date: string
    /** team ids, No. 1 first */
    ids: string[]
    /** each team's rank as the committee printed it (a skipped entry never shifts the rest) */
    ranks: Record<string, number>
}

/**
 * The playoff committee's ranking for `season` from ESPN's rankings feed. null before the
 * committee's first ranking (the feed then carries only the AP and coaches polls) and for a
 * poll from another season (the preseason feed can still carry last year's final ranking).
 */
export function committeeRanking(r: ESPNRankingsResponse | null, season: number): CommitteeRanking | null {
    const polls = Array.isArray(r?.rankings) ? r.rankings : [];
    const cfp = polls.find((x) => x?.type === 'cfp');
    // the poll's own season, else the feed's; a poll that names another season is never this one
    if (!cfp || (cfp.season?.year ?? r?.latestSeason?.year) !== season) return null;
    const ranked = (Array.isArray(cfp.ranks) ? cfp.ranks : [])
        .filter((x) => x?.team?.id && Number.isFinite(x.current))
        .sort((a, b) => a.current - b.current);
    if (!ranked.length) return null;
    return {
        date: cfp.date ?? '',
        ids: ranked.map((x) => String(x.team.id)),
        ranks: Object.fromEntries(ranked.map((x) => [String(x.team.id), x.current])),
    };
}
