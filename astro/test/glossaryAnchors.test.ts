import { describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { definedTermSetJsonLd, glossaryHref, termSlug, termSlugs } from '../src/utils/seo';

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
        expect(glossaryHref('C#', terms)).toBe('/glossary/#c-2');
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
        expect(glossaryHref('Havoc Rate', [...generateGlossaryItems().values()].flat())).toBe('/glossary/#havoc-rate');
    });
    test('each DefinedTerm carries its own URL and @id', () => {
        const ld = definedTermSetJsonLd([{ term: 'Havoc Rate', definition: 'x' }], '/glossary/');
        expect(ld.hasDefinedTerm[0].url).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0]['@id']).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0].inDefinedTermSet).toBe('https://gameonpaper.com/glossary/');
    });
});
