import { describe, expect, test } from 'vitest';
import { cardLines, cardSeason, compareCategories, compareHref, MAX_COMPARE, parseCompareIds } from '../src/utils/compare';
import type { SeasonRow } from '../src/utils/players';

describe('parseCompareIds', () => {
    test('dedupes, trims and keeps at most four ESPN ids', () => {
        expect(parseCompareIds(' 1, 2,2,3,4,5')).toEqual(['1', '2', '3', '4']);
        expect(MAX_COMPARE).toBe(4);
    });
    test('drops anything that is not an ESPN athlete id', () => {
        expect(parseCompareIds('4433971,00-0031381,abc,,<script>,16800')).toEqual(['4433971', '16800']);
        expect(parseCompareIds(null)).toEqual([]);
    });
});

describe('compareHref', () => {
    test('keeps the commas readable and the season optional', () => {
        expect(compareHref('cfb', ['1', '2'], 2024)).toBe('/players/compare?ids=1,2&season=2024');
        expect(compareHref('nfl', ['16800'])).toBe('/nfl/players/compare?ids=16800');
        expect(compareHref('cfb', [])).toBe('/players/compare');
    });
});

const row = (season: number, category: string, plays: number, team_id = 1): SeasonRow => ({ season, category, plays, team_id });

describe('card lines', () => {
    test('no ?season= is the player\'s latest season', () => {
        expect(cardSeason([row(2023, 'passing', 1), row(2024, 'rushing', 1)], null)).toBe(2024);
        expect(cardSeason([row(2023, 'passing', 1)], 2021)).toBe(2021);
        expect(cardSeason([], null)).toBeNull();
    });
    test('a traded player\'s line is his busiest team-season row', () => {
        const lines = cardLines([row(2024, 'receiving', 27, 13), row(2024, 'receiving', 114, 20), row(2023, 'receiving', 175, 13)], 2024);
        expect(lines.receiving?.team_id).toBe(20);
        expect(lines.passing).toBeUndefined();
    });
    test('categories are those any card has, in page order', () => {
        expect(compareCategories([{ receiving: row(1, 'receiving', 1) }, { passing: row(1, 'passing', 1) }]))
            .toEqual(['passing', 'receiving']);
    });
});
