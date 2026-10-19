// astro/test/basketball/islandProps.test.ts
// The NBA passes no new island prop (its serialized props stay byte-identical); the WNBA passes all three.
import { describe, expect, test } from 'vitest';
import { islandLeagueProps } from '../../src/basketball/config';

describe('islandLeagueProps', () => {
    test('the NBA: nothing, every season', () => {
        for (let s = 1998; s <= 2026; s++) expect(islandLeagueProps('nba', s), String(s)).toEqual({});
    });
    test('the WNBA: no highlight, its season bar, her, its leader bars (D31)', () => {
        expect(islandLeagueProps('wnba', 2026)).toEqual({ highlight: null, minFga: 54, pronoun: 'her', leaderBars: { fga: 4, fg3a: 2 } });
        expect(islandLeagueProps('wnba', 2003)).toEqual({ highlight: null, minFga: 41, pronoun: 'her', leaderBars: { fga: 4, fg3a: 2 } });
    });
});
