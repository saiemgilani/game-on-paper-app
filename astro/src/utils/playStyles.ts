/**
 * The play-style chips' pure step (BB-G17): pick the row and read its archetype columns as chips. Nothing here ranks or
 * relabels: each archetype, runner-up and margin is the producer's (sdv-py's play_style.assign_play_style).
 */
import type { PlayStyleRow } from '../resources/playStyles';
import { numberOrNull } from './misc';

/** off / def: an NBA player's or team's side; style: college's one box-based archetype. */
export type PlayStyleSide = 'off' | 'def' | 'style';

export interface PlayStyleChip {
    side: PlayStyleSide;
    archetype: string;
    /** the next-nearest archetype */
    second: string | null;
    /** how much nearer the archetype's center is than the runner-up's (season z-score units); small = a hybrid */
    margin: number | null;
}

/**
 * A player chip shows its runner-up inline (not only on hover) when the producer's margin is under this. The margin is
 * in the season's standard deviations, so the review's "under 10 points" reads as under 0.10 of one: close to a tie
 * (about 1 NBA defensive row in 10, fewer offensive ones, in the 2024-25 output).
 */
export const RUNNER_UP_INLINE = 0.1;

const PREFIX: Record<PlayStyleSide, string> = { off: 'off_', def: 'def_', style: '' };
const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

function chips(row: PlayStyleRow | undefined, sides: readonly PlayStyleSide[]): PlayStyleChip[] {
    if (!row) return [];
    return sides.flatMap((side) => {
        const p = PREFIX[side];
        const archetype = text(row[`${p}archetype`]);
        // a side the season predates (NBA defense before 2017-18) has no archetype: no chip
        return archetype ? [{ side, archetype, second: text(row[`${p}second_archetype`]), margin: numberOrNull(row[`${p}margin`]) }] : [];
    });
}

/** NBA: offense then defense from the season's row. College: the archetype of the team row with the most minutes. */
export function playerPlayStyles(rows: PlayStyleRow[], college: boolean): PlayStyleChip[] {
    if (!college) return chips(rows[0], ['off', 'def']);
    const row = [...rows].sort((a, b) => (numberOrNull(b.min) ?? 0) - (numberOrNull(a.min) ?? 0))[0];
    return chips(row, ['style']);
}

/** An NBA team's defensive chip (there is no team offense archetype). */
export const teamPlayStyles = (rows: PlayStyleRow[]): PlayStyleChip[] => chips(rows[0], ['def']);
