import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const state = { empty: false };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => (state.empty ? [] : apiSeasonPlayerRows()),
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('/nba/scatter', () => {
    test('a season with no rows says so instead of mounting the island', async () => {
        state.empty = true;
        try {
            const { default: Page } = await import('../../src/pages/nba/scatter.astro');
            const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/scatter?season=2026'), locals: { preview: true } as App.Locals });
            expect(html).toContain('No regular-season shots');
            expect(html).not.toContain('<desc>');
            expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        } finally { state.empty = false; }
    });
    test('one h1, the season picker, the island with its description and axis pickers', async () => {
        const { default: Page } = await import('../../src/pages/nba/scatter.astro');
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/scatter?season=2026'), locals: { preview: true } as App.Locals });
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        expect(html).toContain('League scatter, 2025-26');
        expect(html).toContain('id="nba-season"');
        expect(html).toContain('<desc>');
        expect(html).toContain('name="y"');
        expect(html).toContain('eFG%');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
});
