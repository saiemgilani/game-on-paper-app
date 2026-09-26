import { describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { definedTermSetJsonLd, definitionText, glossaryHref, termSlug, termSlugs } from '../src/utils/seo';

describe('glossary term slugs', () => {
    test('readable, lowercase, hyphen-joined', () => {
        expect(termSlug('Successful play / Success Rate')).toBe('successful-play-success-rate');
        expect(termSlug('"Middle 8"')).toBe('middle-8');
        expect(termSlug('Win probability (WP%)')).toBe('win-probability-wp');
        expect(termSlug('Adjusted EPA/Play')).toBe('adjusted-epa-play');
        expect(termSlug('Élan vital')).toBe('elan-vital');
    });
    test('a list resolves collisions and empty slugs deterministically', () => {
        const terms = [{ term: 'C++', definition: 'x' }, { term: 'C#', definition: 'x' }, { term: '日本語', definition: 'x' }, { term: 'C', definition: 'x' }];
        const slugs = termSlugs(terms);
        expect([...slugs.values()]).toEqual(['c', 'c-2', 'term-3', 'c-3']);
        expect(new Set(slugs.values()).size).toBe(terms.length);
        expect(glossaryHref(terms[1], terms)).toBe('/glossary/#c-2');
        const ld = definedTermSetJsonLd(terms, '/glossary/');
        expect(ld.hasDefinedTerm.map((t) => t.url)).toEqual([...slugs.values()].map((s) => `https://gameonpaper.com/glossary/#${s}`));
    });
    test('every live term: unique, well-formed, never a letter-section id', () => {
        const live = [...generateGlossaryItems().values()].flat();
        const slugs = [...termSlugs(live).values()];
        expect(slugs).toEqual(live.map((e) => termSlug(e.term)));
        expect(slugs.length).toBeGreaterThanOrEqual(41);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) {
            expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(s.startsWith('glossary-section-')).toBe(false);
        }
    });
    test('glossaryHref deep-links the canonical page', () => {
        const live = [...generateGlossaryItems().values()].flat();
        expect(glossaryHref(live.find((t) => t.term === 'Havoc Rate')!, live)).toBe('/glossary/#havoc-rate');
    });
    test('two entries that share a name keep distinct slugs', () => {
        const terms = [{ term: 'Havoc Rate', definition: 'offense' }, { term: 'Havoc Rate', definition: 'defense' }];
        const slugs = termSlugs(terms);
        expect([...slugs.values()]).toEqual(['havoc-rate', 'havoc-rate-2']);
        expect(glossaryHref(terms[1], terms)).toBe('/glossary/#havoc-rate-2');
        expect(definedTermSetJsonLd(terms, '/glossary/').hasDefinedTerm.map((t) => t.url)).toEqual([
            'https://gameonpaper.com/glossary/#havoc-rate',
            'https://gameonpaper.com/glossary/#havoc-rate-2',
        ]);
    });
    test('each DefinedTerm carries its own URL and @id', () => {
        const ld = definedTermSetJsonLd([{ term: 'Havoc Rate', definition: 'x' }], '/glossary/');
        expect(ld.hasDefinedTerm[0].url).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0]['@id']).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0].inDefinedTermSet).toBe('https://gameonpaper.com/glossary/');
    });
    test('the description keeps words that inline tags split, and separates cells', () => {
        const live = [...generateGlossaryItems().values()].flat();
        const detmer = live.find((t) => t.term === 'DETMER')!;
        expect(definitionText(detmer.definition)).toMatch(/^Downfield Eventful Throwing Metric Encouraging Rippin' it\./);
        expect(definitionText('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('a b');
        expect(definitionText('<a href="/x">EPA</a>/play<br>next')).toBe('EPA/play next');
        const ld = definedTermSetJsonLd([detmer], '/glossary/');
        expect(ld.hasDefinedTerm[0].description.startsWith('Downfield Eventful')).toBe(true);
    });
});
