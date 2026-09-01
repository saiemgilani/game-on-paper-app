import { describe, expect, test } from 'vitest';
import {
    LEADERBOARD_CATEGORIES,
    LEADERBOARD_COPY,
    PLAYER_LEADERBOARD_CATEGORIES,
    PLAYER_LEADERBOARD_COPY,
    breadcrumbListJsonLd,
    datasetJsonLd,
    definedTermSetJsonLd,
    jsonLdScript,
    websiteJsonLd,
    gameContext,
    gameDescription,
    gameTitle,
    sportsEventJsonLd,
} from '../src/utils/seo';

describe('leaderboard copy', () => {
    // The whole point: the page that should rank for "cfb epa per play" carried
    // none of those words in visible text. Lock them in per category.
    test('every category names the query terms in title, H1 and description', () => {
        for (const c of LEADERBOARD_CATEGORIES) {
            const k = LEADERBOARD_COPY[c];
            const blob = `${k.title(2025)} ${k.h1(2025)} ${k.description(2025)} ${k.intro}`.toLowerCase();
            expect(blob, c).toContain('epa per play');
            expect(blob, c).toContain('college football');
            expect(blob, c).toContain('success rate');
            expect(blob, c).toContain('2025');
        }
    });

    test('the three real slugs are the only categories', () => {
        expect([...LEADERBOARD_CATEGORIES].sort()).toEqual(['defensive', 'differential', 'offensive']);
    });

    test('titles stay under the ~70-char SERP truncation', () => {
        for (const c of LEADERBOARD_CATEGORIES) {
            // trailing " | Game on Paper" is brand; the descriptive part is what must survive
            const descriptive = LEADERBOARD_COPY[c].title(2025).replace(/ \| Game on Paper$/, '');
            expect(descriptive.length, c).toBeLessThanOrEqual(75);
        }
    });
});

describe('player leaderboard copy', () => {
    test('every category names the query terms in title, H1 and description', () => {
        for (const c of PLAYER_LEADERBOARD_CATEGORIES) {
            const k = PLAYER_LEADERBOARD_COPY[c];
            const blob = `${k.title(2025)} ${k.h1(2025)} ${k.description(2025)}`.toLowerCase();
            expect(blob, c).toContain('epa per play');
            expect(blob, c).toContain('college football');
            expect(blob, c).toContain('success rate');
            expect(k.title(2025).replace(/ \| Game on Paper$/, '').length, c).toBeLessThanOrEqual(75);
        }
    });

    test('the three real slugs are the only categories', () => {
        expect([...PLAYER_LEADERBOARD_CATEGORIES].sort()).toEqual(['passing', 'receiving', 'rushing']);
    });
});

describe('json-ld builders', () => {
    test('breadcrumbs drop url-less crumbs and use absolute items', () => {
        const ld = breadcrumbListJsonLd([
            { title: 'Seasons', active: false },
            { title: '2025', url: '/year/2025', active: false },
            { title: 'Net', url: '/year/2025/teams/differential', active: true },
        ]);
        expect(ld?.itemListElement).toHaveLength(2);
        expect(ld?.itemListElement[0].position).toBe(1);
        expect(ld?.itemListElement[1].item).toBe('https://gameonpaper.com/year/2025/teams/differential');
    });

    test('breadcrumbs with nothing linkable emit nothing', () => {
        expect(breadcrumbListJsonLd([{ title: 'x', active: false }])).toBeNull();
    });

    test('glossary becomes a DefinedTermSet whose terms point back at it', () => {
        const ld = definedTermSetJsonLd(
            [{ term: 'Expected points added (EPA)', definition: 'an estimate...' }],
            '/glossary/',
        );
        expect(ld['@type']).toBe('DefinedTermSet');
        expect(ld.url).toBe('https://gameonpaper.com/glossary/');
        expect(ld.hasDefinedTerm[0]['@type']).toBe('DefinedTerm');
        expect(ld.hasDefinedTerm[0].inDefinedTermSet).toBe(ld.url);
    });

    test('dataset carries season, variables and the search keywords', () => {
        const ld = datasetJsonLd({ name: 'n', description: 'd', url: '/year/2025/teams/offensive', season: 2025, variables: ['EPA per play'] });
        expect(ld.temporalCoverage).toBe('2025');
        expect(ld.variableMeasured[0].name).toBe('EPA per play');
        expect(ld.keywords).toContain('EPA per play');
        expect(ld.url).toBe('https://gameonpaper.com/year/2025/teams/offensive');
    });

    test('website ld names the site', () => {
        expect(websiteJsonLd().url).toBe('https://gameonpaper.com');
    });
});

describe('game copy + SportsEvent', () => {
    const final = { id: 401856766, hasScore: true, away: 'north carolina', home: 'tcu', awayName: 'North Carolina Tar Heels', homeName: 'TCU Horned Frogs', awayId: 153, homeId: 2628, awayScore: '15', homeScore: '10', date: '2025-09-02T00:00Z', season: 2025, week: 1 };
    const pre = { ...final, hasScore: false, awayScore: undefined, homeScore: undefined };

    test('final title carries score, week and the metric words; rendered names stay lowercase', () => {
        const t = gameTitle(final);
        expect(t).toBe('north carolina 15, tcu 10 | Week 1 2025 EPA & advanced box score | Game on Paper');
        expect(gameDescription(final)).toContain('EPA per play');
        expect(gameDescription(final)).toContain('win probability');
        expect(gameDescription(final)).toContain('Sep 1, 2025');
        expect(t).not.toContain('Tar Heels');
    });

    test('preview title says preview; bowl note replaces the week', () => {
        expect(gameTitle(pre)).toBe('north carolina vs tcu | Week 1 2025 preview: win probability & EPA matchup | Game on Paper');
        expect(gameContext({ season: 2024, week: 17, note: 'Peach Bowl' })).toBe('Peach Bowl 2024');
        expect(gameContext({ season: 2024 })).toBe('2024');
        expect(gameContext({ season: 2024, week: 17, note: '2024 CFP Semifinal' })).toBe('2024 CFP Semifinal');
    });

    test('SportsEvent uses real display names, team urls and the served game url', () => {
        const ld = sportsEventJsonLd(final);
        expect(ld['@type']).toBe('SportsEvent');
        expect(ld.url).toBe('https://gameonpaper.com/game/401856766');
        expect(ld.homeTeam.name).toBe('TCU Horned Frogs');
        expect(ld.awayTeam.url).toBe('https://gameonpaper.com/team/153');
        expect(ld.startDate).toBe('2025-09-02T00:00Z');
        expect(ld.subjectOf?.['@type']).toBe('Dataset');
        expect(sportsEventJsonLd(pre).subjectOf).toBeUndefined();
        expect(sportsEventJsonLd({ ...final, neutralSite: true }).location).toBeUndefined();
        // schema.org has no completed/in-progress status; only cancel/postpone differ
        expect(sportsEventJsonLd({ ...final, statusDescription: 'Final' }).eventStatus).toBe('https://schema.org/EventScheduled');
        expect(sportsEventJsonLd({ ...pre, statusDescription: 'Postponed' }).eventStatus).toBe('https://schema.org/EventPostponed');
        expect(sportsEventJsonLd({ ...pre, statusDescription: 'Canceled' }).eventStatus).toBe('https://schema.org/EventCancelled');
    });
});

describe('jsonLdScript', () => {
    test('one object serialises bare, many as an array, none as empty', () => {
        expect(jsonLdScript([{ a: 1 }])).toBe('{"a":1}');
        expect(jsonLdScript([{ a: 1 }, { b: 2 }])).toBe('[{"a":1},{"b":2}]');
        expect(jsonLdScript([null])).toBe('');
        expect(jsonLdScript([])).toBe('');
    });

    test('cannot be broken out of by a closing tag in a definition', () => {
        const out = jsonLdScript([{ description: 'x</script><script>alert(1)' }]);
        expect(out).not.toContain('</script>');
        expect(JSON.parse(out).description).toBe('x</script><script>alert(1)');
    });
});
