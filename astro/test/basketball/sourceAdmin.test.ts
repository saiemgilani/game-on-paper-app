// BB-G21: the basketball half of the admin source switch. The processor request and its cache key (resources/nbaGames.ts)
// and the compare (utils/sourceCompare.ts). The live source is mocked (./liveSource.ts).
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mockLive, procJson } from './liveSource';

const calls: { url: string; init: any }[] = [];
vi.mock('../../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init: any) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ plays: [] }), { status: 200 });
    },
}));

beforeEach(() => { calls.length = 0; });

describe('retrieveNbaProcessedGame', () => {
    test.each(['nba', 'wnba', 'mbb', 'wbb'] as const)('%s: no source is today\'s request and key; a source reaches both', async (league) => {
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        await retrieveNbaProcessedGame('401766458', 30, league);
        await retrieveNbaProcessedGame('401766458', 30, league, 'live');
        const [plain, switched] = calls;
        expect(plain.url).toMatch(new RegExp(`/${league}/401766458/process$`));
        expect(plain.init.cf.cacheKey).toMatch(new RegExp(`/${league}/401766458/process\\?v=[^&]*$`));
        expect(switched.url).toMatch(new RegExp(`/${league}/401766458/process\\?source=live$`));
        // one key for two feeds would pin whichever landed first (a final caches a day)
        expect(switched.init.cf.cacheKey).toContain('&source=live');
        expect(switched.init.cf.cacheKey).not.toBe(plain.init.cf.cacheKey);
    });
    test('a source is url-encoded, never interpolated raw', async () => {
        const { retrieveNbaProcessedGame } = await import('../../src/resources/nbaGames');
        await retrieveNbaProcessedGame('401766458', 30, 'nba', 'a&v=x');
        expect(calls[0].url).toContain('source=a%26v%3Dx');
        expect(calls[0].init.cf.cacheKey).toContain('&source=a%26v%3Dx');
    });
});

describe('fromProcessor', () => {
    test('carries provenance only when the payload has it (the public payload has none)', async () => {
        const { fromProcessor } = await import('../../src/resources/nbaGame');
        expect('provenance' in fromProcessor(procJson(), 'nba')).toBe(false);
        expect(fromProcessor(mockLive(), 'nba').provenance).toMatchObject({ source: 'live', requested: 'live', fallback_used: false });
    });
});

describe('compareBasketballSources', () => {
    test('a mocked live feed against ESPN: score, box, rates and play count', async () => {
        const { fromProcessor } = await import('../../src/resources/nbaGame');
        const { compareBasketballSources } = await import('../../src/utils/sourceCompare');
        const c = compareBasketballSources(fromProcessor(mockLive(), 'nba'), fromProcessor(procJson(), 'nba'));
        expect(c.teams.map((t) => t.side)).toEqual(['away', 'home']);
        expect(c.playsSelected).toBe(490);
        expect(c.playsEspn).toBe(496);
        const home = Object.fromEntries(c.teams[1].rows.map((r) => [r.label, r]));
        expect(home.Score).toMatchObject({ selected: 118, espn: 120, delta: -2 });
        expect(home.FGM).toMatchObject({ selected: 43, espn: 44, delta: -1 });
        // a fraction is compared in percentage points, as the four-factors table shows it
        expect(home['eFG%'].percent).toBe(true);
        expect(home['eFG%'].selected).toBeCloseTo(53, 6);
        expect(home['eFG%'].delta).toBeCloseTo(53 - 54.3956, 3);
        expect(home['FT rate'].percent).toBe(false);
        // the away side was not moved: every delta is zero
        expect(c.teams[0].rows.every((r) => r.delta === 0)).toBe(true);
    });
    test('a failed ESPN side leaves its column and every delta empty, never a fake 0', async () => {
        const { fromProcessor } = await import('../../src/resources/nbaGame');
        const { compareBasketballSources } = await import('../../src/utils/sourceCompare');
        const c = compareBasketballSources(fromProcessor(mockLive(), 'nba'), null);
        expect(c.playsEspn).toBeNull();
        expect(c.teams.flatMap((t) => t.rows).every((r) => r.espn === null && r.delta === null)).toBe(true);
    });
});
