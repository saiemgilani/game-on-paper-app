/**
 * The pure steps of /<mbb|wbb>/bracketology (BB-G22): which snapshot day the page shows, the bubble groups, and the
 * projected field laid out as a bracket. Nothing here computes a rank, a percentile or a probability: those are the
 * producer's columns (resources/bracketology.ts). The page reads, orders and formats.
 */

/** One daily snapshot: the season (END year) and the producer's cut, a YYYY-MM-DD day (games strictly before it count). */
export interface Snapshot { season: number; as_of_date: string }

export interface SnapshotPick {
    /** null: no snapshot at all (an explicit season with none, or a Data API with none) */
    snapshot: Snapshot | null;
    /** the season the page is about: the requested one, else the snapshot's */
    season: number;
    /** true when the current season has no snapshot yet and the page shows the latest season that has one */
    fallback: boolean;
}

/**
 * The college season a day belongs to (END year): August on is next year's season. Opening night is in November and
 * the title game in early April, so the boundary only has to fall in the summer.
 */
export function collegeSeasonOf(day: Date): number {
    return day.getUTCMonth() >= 7 ? day.getUTCFullYear() + 1 : day.getUTCFullYear();
}

/**
 * The snapshot the page shows. An explicit `?season=` reads that season's latest day and never falls back (its empty
 * state names it). Otherwise the current season's latest day; and when the current season has none yet (the
 * producer skips a season whose first game is still ahead), the latest day of any season, flagged as a fallback.
 */
export async function pickSnapshot(
    requested: number | null,
    current: number,
    latest: (season?: number) => Promise<Snapshot | null>,
): Promise<SnapshotPick> {
    if (requested != null && requested !== current) {
        return { snapshot: await latest(requested), season: requested, fallback: false };
    }
    const own = await latest(current);
    if (own) return { snapshot: own, season: current, fallback: false };
    const any = await latest();
    return any ? { snapshot: any, season: any.season, fallback: any.season !== current } : { snapshot: null, season: current, fallback: false };
}

export const BUBBLE_GROUPS = [
    { key: 'last_four_byes', label: 'Last four byes' },
    { key: 'last_four_in', label: 'Last four in' },
    { key: 'first_four_out', label: 'First four out' },
    { key: 'next_four_out', label: 'Next four out' },
] as const;

/** The producer's bubble labels as four groups in bubble order, each best at-large rank first; a group with no team is left out. */
export function bubbleGroups<T extends { bubble: string | null; at_large_rank: number | null }>(rows: T[]) {
    return BUBBLE_GROUPS
        .map((g) => ({ ...g, rows: rows.filter((r) => r.bubble === g.key).sort((a, b) => (a.at_large_rank ?? Infinity) - (b.at_large_rank ?? Infinity)) }))
        .filter((g) => g.rows.length > 0);
}

export interface FieldRow {
    team_id: number;
    bid: boolean;
    auto_bid: boolean;
    projected_seed: number | null;
    resume_score: number;
    bubble: string | null;
}

/** One line of a region: a team, or a First Four pair whose winner takes the slot. */
export interface FieldUnit<T> { seed: number; teams: T[] }

export interface ProjectedField<T> {
    /** the four play-in games: the last four at-large teams and the four lowest auto-bids, each in pairs */
    firstFour: [T, T][];
    /** four regions, each its eight first-round games top to bottom (1-16, 8-9, 5-12, 4-13, 6-11, 3-14, 7-10, 2-15) */
    regions: [FieldUnit<T>, FieldUnit<T>][][];
}

const GAMES: [number, number][] = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];

/**
 * The producer's projected field (bid, projected_seed) as a 68-team bracket. The producer seeds on `resume_score`
 * (sdv-py `_seed_field`): the last four at-large teams and the four lowest auto-bids play the First Four in pairs
 * (1st-2nd, 3rd-4th of each group by score), and a pair holds one slot on its seed line. Each line's four slots go to
 * the regions on the S-curve, serpentine (line 1 best to region 1, line 2 best to region 4, ...). The committee's
 * bracketing rules (conference separation, geography) are not applied. null when the field does not fill sixteen
 * lines of four (the producer's fallback for a field it cannot split into a First Four).
 */
export function projectedField<T extends FieldRow>(rows: T[]): ProjectedField<T> | null {
    const field = rows.filter((r) => r.bid && r.projected_seed != null).sort((a, b) => b.resume_score - a.resume_score);
    const atLarge = field.filter((r) => !r.auto_bid);
    const auto = field.filter((r) => r.auto_bid);
    if (field.length !== 68 || atLarge.length < 4 || auto.length < 4) return null;
    const ffGroups = [atLarge.slice(-4), auto.slice(-4)];
    const firstFour = ffGroups.flatMap((g) => [[g[0], g[1]], [g[2], g[3]]] as [T, T][]);
    const inFirstFour = new Set(firstFour.flat());
    // ponytail: a pair is placed on its line by its mean score, as sdv-py places it; ordering only, nothing shown
    const units = [
        ...field.filter((r) => !inFirstFour.has(r)).map((r) => ({ score: r.resume_score, unit: { seed: r.projected_seed!, teams: [r] } })),
        ...firstFour.map(([a, b]) => ({ score: (a.resume_score + b.resume_score) / 2, unit: { seed: a.projected_seed!, teams: [a, b] } })),
    ];
    const lines = new Map<number, FieldUnit<T>[]>();
    for (const { unit } of units.sort((a, b) => b.score - a.score)) lines.set(unit.seed, [...(lines.get(unit.seed) ?? []), unit]);
    for (let s = 1; s <= 16; s++) if (lines.get(s)?.length !== 4) return null;
    const at = (seed: number, region: number) => lines.get(seed)![seed % 2 === 1 ? region : 3 - region];
    const regions = [0, 1, 2, 3].map((r) => GAMES.map(([a, b]) => [at(a, r), at(b, r)] as [FieldUnit<T>, FieldUnit<T>]));
    return { firstFour, regions };
}

/** A snapshot day as the page prints it: "November 3, 2026". */
export const snapshotDay = (isoDate: string): string =>
    new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** A W-L record as one cell. */
export const record = (w: number | null | undefined, l: number | null | undefined): string => (w == null || l == null ? '—' : `${w}-${l}`);
