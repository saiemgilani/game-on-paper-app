import { describe, expect, test } from 'vitest';
import { generateGlossaryItems } from '../src/resources/glossary';
import { metricHelp, metricHelpPopovers } from '../src/utils/metricHelp';

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
