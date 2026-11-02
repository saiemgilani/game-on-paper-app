import { expect, test, vi } from 'vitest';

// Every section read answers at once except team summaries, which never settles: a shared
// helper with no signal of its own, hung on a stalled Data API.
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSeasons: async () => [],
    retrievePlayerGames: async () => [],
    retrievePlayerSplits: async () => [],
    retrieveNflEspnGameIds: async () => ({}),
    retrievePlayerGamePercentiles: async () => ({}),
    retrievePlayerSplitPercentiles: async () => ({}),
    retrieveRankedRows: async () => [],
    retrieveTeamSummaries: () => new Promise(() => {}),
}));

test('loadPlayerSections degrades instead of hanging when a section read never settles', async () => {
    vi.useFakeTimers();
    try {
        const { loadPlayerSections } = await import('../src/routes/player');
        const player = { espn_id: '4837248', position: 'QB', seasons: [2025] } as any;
        const done = loadPlayerSections(player, 2025, 'cfb');
        await vi.advanceTimersByTimeAsync(10_000);
        const { sections, degraded } = await done;
        expect(degraded).toBe(true);
        expect(sections.teamRows).toEqual([]); // the stuck read falls back to its empty value
        expect(sections.failed.seasons).toBe(false); // the reads that answered are untouched
    } finally {
        vi.useRealTimers();
    }
});
