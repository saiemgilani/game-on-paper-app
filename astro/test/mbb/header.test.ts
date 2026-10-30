import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../../src/components/Header.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('the MBB Header', () => {
    test('five pages, no featured-team entry, a switch that includes the other basketball leagues', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'mbb', preview: true } as App.Locals });
        const items = [...html.matchAll(/<a href="(\/mbb[^"]*)" class="nav-link px-2 link-secondary">([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
        expect(items).toEqual(['Scoreboard /mbb/scoreboard', 'Players /mbb/players', 'Teams /mbb/teams', 'Scatter /mbb/scatter', 'Leaders /mbb/leaders']);
        expect(html).not.toContain('>Nets<');
        expect(html).toContain('title="Switch league"');
        for (const href of ['href="/"', 'href="/nfl"', 'href="/nba"', 'href="/wnba"']) expect(html).toContain(href);
    });
    test("a football viewer's Header does not offer MBB while it is in preview", async () => {
        const html = await container.renderToString(Header, { locals: { league: 'cfb', preview: true } as App.Locals });
        expect(html).not.toContain('href="/mbb"');
    });
});
