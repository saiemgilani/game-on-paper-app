import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { metricHelp, metricHelpButton, metricHelpPopovers } from '../src/utils/metricHelp';

const entry = (term: string) => [...generateGlossaryItems().values()].flat().find((t) => t.term === term)!;

describe('metricHelp', () => {
    test('success_off -> the Success Rate entry and its glossary anchor', () => {
        expect(metricHelp('success_off')).toEqual({
            slug: 'successful-play-success-rate',
            term: 'Successful play / Success Rate',
            definition: entry('Successful play / Success Rate').definition,
            href: '/glossary/#successful-play-success-rate',
        });
    });

    test('team and player keys map to their terms', () => {
        expect(metricHelp('EPAplay_margin')?.slug).toBe('epa-per-play-epa-play');
        expect(metricHelp('EPAplay')?.slug).toBe('epa-per-play-epa-play'); // player boards
        expect(metricHelp('success')?.slug).toBe('successful-play-success-rate');
        expect(metricHelp('adj_off_epa')?.slug).toBe('adjusted-epa-play');
        expect(metricHelp('net_adj_epa')?.slug).toBe('adjusted-epa-play');
        expect(metricHelp('havoc_def')?.slug).toBe('havoc-rate');
        expect(metricHelp('TEPA')?.slug).toBe('expected-points-added-epa');
    });

    test('a metric with no glossary entry has no help', () => {
        expect(metricHelp('yardsplay_off')).toBeNull();
        expect(metricHelp('dropbacks')).toBeNull();
    });

    test('one popover per distinct term', () => {
        const html = metricHelpPopovers(['success_off', 'success_off_pass', 'success_off_rush', 'yardsplay_off']);
        expect(html.match(/ popover /g)).toHaveLength(1);
    });

    test('the glossary in-page section links point back into the glossary', () => {
        const html = metricHelpPopovers(['adj_off_epa']);
        expect(html).toContain("href='/glossary/#glossary-section-");
        expect(html).not.toMatch(/href=['"]#/);
    });
});

describe('the phone tap target', () => {
    // design-conventions §4: tap-target CSS that applied at every width was walked back twice, so the
    // widened hit area must exist (the class is on the button) and must live only in the xs media block
    const css = readFileSync(new URL('../public/assets/css/base.css', import.meta.url), 'utf8').replace(/\/\*[^]*?\*\//g, '');
    const XS = '@media (max-width: 575.98px) {';
    const block = (at: number) => {
        let depth = 0;
        for (let i = css.indexOf('{', at); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}' && --depth === 0) return [at, i + 1] as const;
        }
        return [at, css.length] as const;
    };
    const xsBlocks = [...css.matchAll(/@media \(max-width: 575\.98px\) \{/g)].map((m) => block(m.index!));

    test('the button carries the class the rule targets', () => {
        expect(metricHelpButton('success_off')).toMatch(/class="[^"]*\bmetric-help-btn\b/);
    });

    test('the widened ::after exists only inside the xs media block', () => {
        expect(css).toContain(XS);
        const inXs = xsBlocks.map(([a, b]) => css.slice(a, b)).join('\n');
        expect(inXs).toMatch(/\.metric-help-btn::after\s*\{[^}]*inset:/);
        const outside = xsBlocks.reduceRight((rest, [a, b]) => rest.slice(0, a) + rest.slice(b), css);
        expect(outside).not.toContain('.metric-help-btn');
    });
});
