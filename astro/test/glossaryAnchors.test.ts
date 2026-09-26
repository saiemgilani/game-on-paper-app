import { describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { definedTermSetJsonLd, glossaryHref, termSlug } from '../src/utils/seo';

describe('glossary term slugs', () => {
    test('readable, lowercase, hyphen-joined', () => {
        expect(termSlug('Successful play / Success Rate')).toBe('successful-play-success-rate');
        expect(termSlug('"Middle 8"')).toBe('middle-8');
        expect(termSlug('Win probability (WP%)')).toBe('win-probability-wp');
        expect(termSlug('Adjusted EPA/Play')).toBe('adjusted-epa-play');
    });
    test('every live term: unique, well-formed, never a letter-section id', () => {
        const slugs = [...generateGlossaryItems().values()].flat().map((e) => termSlug(e.term));
        expect(slugs.length).toBeGreaterThanOrEqual(41);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) {
            expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(s.startsWith('glossary-section-')).toBe(false);
        }
    });
    test('glossaryHref deep-links the canonical page', () => {
        expect(glossaryHref('Havoc Rate')).toBe('/glossary/#havoc-rate');
    });
    test('each DefinedTerm carries its own URL and @id', () => {
        const ld = definedTermSetJsonLd([{ term: 'Havoc Rate', definition: 'x' }], '/glossary/');
        expect(ld.hasDefinedTerm[0].url).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0]['@id']).toBe('https://gameonpaper.com/glossary/#havoc-rate');
        expect(ld.hasDefinedTerm[0].inDefinedTermSet).toBe('https://gameonpaper.com/glossary/');
    });
});
