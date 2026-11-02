import type { PlayoffRound, PlayoffSeed } from "../resources/playoff";

export interface BracketSlot {
    seed: number
    teamId: string
    /** this team's chance, from today, of winning the game it is drawn in here */
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
 * The projected bracket: in each later round a slot holds the team likeliest to reach it from the
 * games that feed it, so the page reads like a filled-in bracket while every number on it stays an
 * unconditional chance from today.
 */
export function buildBracket(field: PlayoffSeed[]): { rounds: BracketRound[], champion: BracketSlot } {
    const bySeed = new Map(field.map((s) => [s.seed, s]));
    const slot = (seed: number, next: PlayoffRound): BracketSlot => {
        const s = bySeed.get(seed)!;
        return { seed, teamId: s.team_id, pct: s.reach[next] };
    };
    const likeliest = (pool: number[], round: PlayoffRound) =>
        pool.reduce((best, s) => (bySeed.get(s)!.reach[round] > bySeed.get(best)!.reach[round] ? s : best));

    const qfPools = BYES.map((bye, i) => [bye, ...FIRST_ROUND[i]]);
    const sfPools = [qfPools[0].concat(qfPools[1]), qfPools[2].concat(qfPools[3])];
    const rounds: BracketRound[] = [
        { name: 'First Round', games: FIRST_ROUND.map(([hi, lo]) => [slot(hi, 'quarterfinal'), slot(lo, 'quarterfinal')]) },
        { name: 'Quarterfinals', games: BYES.map((bye, i) => [slot(bye, 'semifinal'), slot(likeliest(FIRST_ROUND[i], 'quarterfinal'), 'semifinal')]) },
        { name: 'Semifinals', games: [[0, 1], [2, 3]].map(([a, b]) => [slot(likeliest(qfPools[a], 'semifinal'), 'final'), slot(likeliest(qfPools[b], 'semifinal'), 'final')]) },
        { name: 'National Championship', games: [[slot(likeliest(sfPools[0], 'final'), 'champion'), slot(likeliest(sfPools[1], 'final'), 'champion')]] },
    ];
    const all = field.map((s) => s.seed);
    return { rounds, champion: slot(likeliest(all, 'champion'), 'champion') };
}

/** A probability as the page prints it: whole percents, with the tails kept honest. */
export function pct(p: number): string {
    if (p >= 0.995 && p < 1) return '>99%';
    if (p > 0 && p < 0.005) return '<1%';
    return `${Math.round(p * 100)}%`;
}
