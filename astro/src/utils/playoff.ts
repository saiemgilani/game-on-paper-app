import type { PlayoffRound, PlayoffSeed } from "../resources/playoff";

export interface BracketSlot {
    seed: number
    teamId: string
    /** this team's chance of winning the game it is drawn in here, if the projected field holds */
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
 * The projected bracket, filled in: each later slot holds the likelier winner of the game drawn
 * before it, so every team shown came out of the game that feeds it. Each number is that team's
 * chance, from today, of winning its game here, given this field (python/playoff_projection.py
 * _bracket_probs); the chance of making the field at all is the seeds table's.
 */
export function buildBracket(field: PlayoffSeed[]): { rounds: BracketRound[], champion: BracketSlot } {
    const bySeed = new Map(field.map((s) => [s.seed, s]));
    const slot = (seed: number, next: PlayoffRound): BracketSlot => {
        const s = bySeed.get(seed)!;
        return { seed, teamId: s.team_id, pct: s.reach[next] };
    };
    // a game's winner is the slot with the larger number: its chance of winning that game
    const winner = ([a, b]: [BracketSlot, BracketSlot]) => (b.pct > a.pct ? b.seed : a.seed);
    const pairs = <T>(xs: T[]): [T, T][] => xs.filter((_, i) => i % 2 === 0).map((x, i) => [x, xs[2 * i + 1]]);

    const first = FIRST_ROUND.map(([hi, lo]): [BracketSlot, BracketSlot] => [slot(hi, 'quarterfinal'), slot(lo, 'quarterfinal')]);
    const quarters = BYES.map((bye, i): [BracketSlot, BracketSlot] => [slot(bye, 'semifinal'), slot(winner(first[i]), 'semifinal')]);
    const semis = pairs(quarters).map(([a, b]): [BracketSlot, BracketSlot] => [slot(winner(a), 'final'), slot(winner(b), 'final')]);
    const final = pairs(semis).map(([a, b]): [BracketSlot, BracketSlot] => [slot(winner(a), 'champion'), slot(winner(b), 'champion')]);
    const rounds: BracketRound[] = [
        { name: 'First Round', games: first },
        { name: 'Quarterfinals', games: quarters },
        { name: 'Semifinals', games: semis },
        { name: 'National Championship', games: final },
    ];
    return { rounds, champion: slot(winner(final[0]), 'champion') };
}

/** A probability as the page prints it: whole percents, with the tails kept honest. */
export function pct(p: number): string {
    if (p >= 0.995 && p < 1) return '>99%';
    if (p > 0 && p < 0.005) return '<1%';
    return `${Math.round(p * 100)}%`;
}
