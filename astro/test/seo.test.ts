import { describe, expect, test } from 'vitest';
import {
    LEADERBOARD_CATEGORIES,
    LEADERBOARD_COPY,
    breadcrumbListJsonLd,
    datasetJsonLd,
    definedTermSetJsonLd,
    jsonLdScript,
    websiteJsonLd,
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

describe('json-ld builders', () => {
    test('breadcrumbs drop url-less crumbs and use absolute items', () => {
        const ld = breadcrumbListJsonLd([
            { title: 'Seasons' },
            { title: '2025', url: '/year/2025' },
            { title: 'Net', url: '/year/2025/teams/differential' },
        ]);
        expect(ld?.itemListElement).toHaveLength(2);
        expect(ld?.itemListElement[0].position).toBe(1);
        expect(ld?.itemListElement[1].item).toBe('https://gameonpaper.com/year/2025/teams/differential');
    });

    test('breadcrumbs with nothing linkable emit nothing', () => {
        expect(breadcrumbListJsonLd([{ title: 'x' }])).toBeNull();
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
