// astro/test/basketball/header.test.ts
// The Header's basketball entries come from BASKETBALL[league].headerMenu; no league lists its landing page there.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

import Header from '../../src/components/Header.astro';

let container: AstroContainer;
// the Header carries the site-search island (a Svelte component) for a preview viewer since #304
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = () => container.renderToString(Header, { locals: { league: 'nba', preview: true } as App.Locals });

describe('Header basketball menu from the config', () => {
    test('the nba menu: Scoreboard, Players, Teams, Scatter, Leaders (no Nets entry)', async () => {
        const html = await render();
        const items = [...html.matchAll(/<a href="(\/nba[^"]*)" class="nav-link px-2 link-secondary">([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
        expect(items).toEqual(['Scoreboard /nba/scoreboard', 'Players /nba/players', 'Teams /nba/teams', 'Scatter /nba/scatter', 'Leaders /nba/leaders']);
        expect(html).not.toContain('>Nets<');
    });
});
