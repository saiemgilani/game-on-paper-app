import { describe, expect, test, vi } from 'vitest';
import { GAME_PERCENTILE_MIN_PLAYS, NO_COHORT } from '../src/utils/players';

// loadGameLadder fires its three cohort reads at once but must answer exactly as
// the old serial chain did: first non-empty in order wins, an empty read moves on,
// and a failure counts only when no earlier step had already answered.
const answers: Array<() => Promise<Record<string, number[]>>> = [];
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerGamePercentiles: () => answers.shift()!(),
}));
const { loadGameLadder } = await import('../src/routes/player');

const ladder = { plays: [1, 2, 3] };
const empty = async () => ({});
const ok = async () => ladder;
const boom = async (): Promise<Record<string, number[]>> => { throw new Error('upstream 500'); };

describe('loadGameLadder reads its fallback steps in order', () => {
    test('a later step failing does not discard an earlier answer', async () => {
        answers.push(ok, boom, boom);
        const r = await loadGameLadder(2025, 'cfb', 'QB');
        expect(r.breaks).toEqual(ladder);
        expect(r.cohort).toEqual({ group: 'QB', minPlays: GAME_PERCENTILE_MIN_PLAYS });
    });

    test('an empty step moves on to the next', async () => {
        answers.push(empty, ok, boom);
        const r = await loadGameLadder(2025, 'cfb', 'QB');
        expect(r.cohort).toEqual({ group: null, minPlays: GAME_PERCENTILE_MIN_PLAYS });
    });

    test('a failure before any answer still rejects, as the serial chain did', async () => {
        answers.push(boom, ok, ok);
        await expect(loadGameLadder(2025, 'cfb', 'QB')).rejects.toThrow('upstream 500');
    });

    test('no step answering is the no-cohort ladder', async () => {
        answers.push(empty, empty, empty);
        expect(await loadGameLadder(2025, 'cfb', 'QB')).toEqual({ breaks: {}, cohort: NO_COHORT });
    });
});
