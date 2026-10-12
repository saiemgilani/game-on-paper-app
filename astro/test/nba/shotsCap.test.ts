import { describe, expect, test, vi } from 'vitest';

const state = { n: 3 };
vi.mock('../../src/resources/sdv', () => ({
    retrieveRows: async () => Array.from({ length: state.n }, (_, i) => ({ season: 2026, i })),
}));

describe('nbaShots reads', () => {
    test('a read that reaches the 50,000-row cap throws instead of truncating', async () => {
        const { retrieveSeasonPlayerGameRows, retrieveSeasonPlayerRows } = await import('../../src/resources/nbaShots');
        state.n = 49_999;
        await expect(retrieveSeasonPlayerGameRows(2026)).resolves.toHaveLength(49_999);
        state.n = 50_000;
        await expect(retrieveSeasonPlayerGameRows(2026)).rejects.toThrow(/50000-row cap/);
        await expect(retrieveSeasonPlayerRows(2026)).rejects.toThrow(/cap/);
    });
});
