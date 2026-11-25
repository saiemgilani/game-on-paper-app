import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// #139 ('scoreboard-card-link'): the desktop card's Stats/Preview link is
// stretched over the card; the broadcast button stays above it.

function competitor(id: string, abbr: string, score: string) {
    return { id, score, team: { id, abbreviation: abbr, conferenceId: '8', location: `${abbr} State` }, curatedRank: { current: 99 }, records: [] };
}

function gameEvent(id: string, type: { name: string; completed: boolean; detail: string }) {
    const status = { period: 4, clock: 0, type: { id: '3', shortDetail: type.detail, ...type } };
    return {
        id, date: '2026-09-06T23:30Z', status,
        competitions: [{
            id, date: '2026-09-06T23:30Z', status, notes: [],
            competitors: [competitor('333', 'ALA', '24'), competitor('2', 'AUB', '17')],
            broadcasts: [{ media: { shortName: 'ESPN' } }],
        }],
    };
}

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function grid(locals: Record<string, unknown>) {
    const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
    const html = await container.renderToString(SchedulePage, {
        props: {
            season: 2026, week: 2, isScoreboard: true,
            games: [
                gameEvent('401', { name: 'STATUS_FINAL', completed: true, detail: 'Final' }),
                gameEvent('402', { name: 'STATUS_POSTPONED', completed: false, detail: 'Postponed' }),
            ],
        },
        request: new Request('https://gameonpaper.com/'),
        locals: locals as any, // Locals' cfContext is a Workers runtime field the render never reads
    });
    return html.slice(html.indexOf('class="row mb-3'));
}

// the card markup from its column div up to the next card's
const card = (html: string, id: string) => {
    const start = html.lastIndexOf('<div class="col-xl-3', html.indexOf(`/game/${id}"`));
    const next = html.indexOf('<div class="col-xl-3', start + 1);
    return html.slice(start, next < 0 ? undefined : next);
};

describe('scoreboard card link', () => {
    test('flag on: the Stats link stretches over a position-relative card, the broadcast button sits above it', async () => {
        const html = await grid({ preview: true });
        const final = card(html, '401');
        expect(final).toContain('<div class="col p-3 position-relative">');
        expect(final).toMatch(/<a class="btn btn-sm btn-outline-primary stretched-link" role="button" href="\/game\/401">Stats<\/a>/);
        expect(final).toMatch(/<div class="text-right game-thumb-over">\s*<a class="btn btn-sm btn-outline-secondary" role="button" target="_blank"/);
        // one link per card: the overlay is the Stats link's own ::after
        expect([...html.matchAll(/stretched-link/g)]).toHaveLength(2);
    });

    test('flag on: a postponed game keeps its link disabled, so its card is not clickable either', async () => {
        const html = await grid({ preview: true });
        // .disabled sets pointer-events: none, which the stretched ::after inherits
        expect(html).toMatch(/<a class="btn btn-sm btn-outline-primary disabled stretched-link" role="button" href="\/game\/402">/);
    });

    test('flag off: no stretched link, no positioned card, no raised broadcast slot', async () => {
        const html = await grid({});
        expect(html).not.toContain('stretched-link');
        expect(html).not.toContain('position-relative');
        expect(html).not.toContain('game-thumb-over');
        expect(html).toMatch(/<a class="btn btn-sm btn-outline-primary" role="button" href="\/game\/401">Stats<\/a>/);
    });
});
