import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('/nba/scatter', () => {
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
