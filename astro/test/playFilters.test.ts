import { describe, expect, test } from 'vitest';
import { pairRows } from '../src/utils/playFilters';

// The rows a PlaysTable emits: a summary, optionally followed by its detail.
const S = (id: number) => ({ id, detail: false });
const D = (id: number) => ({ id, detail: true });
const pair = (rows: { id: number; detail: boolean }[]) => pairRows(rows, (r) => r.detail).map((p) => p.map((r) => r.id));

describe('pairRows', () => {
    test('a detail row belongs to the summary before it', () => {
        expect(pair([S(1), D(1), S(2), D(2)])).toEqual([[1, 1], [2, 2]]);
    });

    test('a non-expandable table is all singletons', () => {
        expect(pair([S(1), S(2), S(3)])).toEqual([[1], [2], [3]]);
    });

    test('mixed expandable and not, in one table', () => {
        expect(pair([S(1), D(1), S(2), S(3), D(3)])).toEqual([[1, 1], [2], [3, 3]]);
    });

    test('a leading detail row starts its own group rather than vanishing', () => {
        // Never expected, but silently dropping it would mis-pair every row after.
        expect(pair([D(9), S(1), D(1)])).toEqual([[9], [1, 1]]);
    });

    test('reversing pairs keeps every detail behind its own summary', () => {
        const pairs = pairRows([S(1), D(1), S(2), D(2), S(3), D(3)], (r) => r.detail).reverse();
        expect(pairs.flat().map((r) => `${r.id}${r.detail ? 'd' : 's'}`)).toEqual(['3s', '3d', '2s', '2d', '1s', '1d']);
    });

    test('no rows, no pairs', () => {
        expect(pair([])).toEqual([]);
    });
});
