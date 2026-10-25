import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import Header from '../../src/components/Header.astro';

let container: AstroContainer;
// a preview header carries the search island, so the Svelte renderer is loaded
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('the NBA header menu', () => {
    test('lists Scoreboard first, before Nets', async () => {
        const html = await container.renderToString(Header, { locals: { league: 'nba', preview: true } as App.Locals });
        const sb = html.indexOf('href="/nba/scoreboard"'), nets = html.indexOf('>Nets<');
        expect(sb).toBeGreaterThan(-1);
        expect(sb).toBeLessThan(nets);
    });
});
