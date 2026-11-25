import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// #140 ('scoreboard-full-names'): the football card names its teams by location
// from md up; phones (and the flag-off page) keep the abbreviation.

function competitor(id: string, abbr: string, location: string, score: string) {
    return { id, score, team: { id, abbreviation: abbr, location, conferenceId: '8' }, curatedRank: { current: 99 }, records: [] };
}

function finalEvent(id: string, competitors: unknown[]) {
    const status = { period: 4, clock: 0, type: { id: '3', name: 'STATUS_FINAL', completed: true, detail: 'Final', shortDetail: 'Final' } };
    return { id, date: '2026-11-22T23:30Z', status, competitions: [{ id, date: '2026-11-22T23:30Z', status, notes: [], competitors }] };
}

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function grid(locals: Record<string, unknown>) {
    const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
    const html = await container.renderToString(SchedulePage, {
        props: {
            season: 2026, week: 13, isScoreboard: true,
            // competitors are [home, away]; 61 is on MEME_LIST, so cleanLocation lowercases it
            games: [finalEvent('401', [competitor('245', 'TA&M', 'Texas A&M', '17'), competitor('142', 'MIZ', 'Missouri', '24')]),
                finalEvent('402', [competitor('61', 'UGA', 'Georgia', '30'), competitor('0', 'TBD', '', '0')])],
        },
        request: new Request('https://gameonpaper.com/'),
        locals: locals as any, // Locals' cfContext is a Workers runtime field the render never reads
    });
    return html.slice(html.indexOf('class="row mb-3'));
}

describe('scoreboard full names', () => {
    test('flag on: the location from md up, the abbreviation below, both with the winner/loser styling', async () => {
        const html = await grid({ preview: true });
        expect(html).toContain('<span class="d-none d-md-inline"><strong>Missouri</strong></span><span class="d-md-none"><strong>MIZ</strong></span>');
        expect(html).toContain('<span class="d-none d-md-inline"><span style="opacity: 0.5;">Texas A&M</span></span><span class="d-md-none"><span style="opacity: 0.5;">TA&M</span></span>');
        // routed through cleanLocation, so the meme team keeps its lowercase
        expect(html).toContain('<strong>georgia</strong>');
    });

    test('flag on: a competitor with no location keeps its abbreviation alone', async () => {
        const html = await grid({ preview: true });
        expect(html).toContain('<span style="opacity: 0.5;">TBD</span>');
        expect([...html.matchAll(/class="d-none d-md-inline"/g)]).toHaveLength(3);
    });

    test('flag off: abbreviations only, no responsive name spans', async () => {
        const html = await grid({});
        expect(html).not.toContain('d-md-inline');
        expect(html).not.toContain('Missouri');
        expect(html).toContain('<strong>MIZ</strong>');
    });
});
