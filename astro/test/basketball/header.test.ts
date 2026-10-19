// astro/test/basketball/header.test.ts
// The Header's basketball entries come from BASKETBALL[league].headerMenu; the featured-team entry exists only with a featured team.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const state = { noFeatured: false };
vi.mock('../../src/basketball/config', async (orig) => {
    const real = await orig<typeof import('../../src/basketball/config')>();
    const nba = real.BASKETBALL.nba;
    const BASKETBALL = { get nba() { return state.noFeatured ? { ...nba, featuredTeam: null, headerMenu: nba.headerMenu.filter((m) => m.path !== '/') } : nba; } };
    return { ...real, BASKETBALL, basketball: () => BASKETBALL.nba };
});

import Header from '../../src/components/Header.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = () => container.renderToString(Header, { locals: { league: 'nba', preview: true } as App.Locals });

describe('Header basketball menu from the config', () => {
    test('the nba menu: Scoreboard, Nets, Players, Teams, Scatter, Leaders', async () => {
        const html = await render();
        const items = [...html.matchAll(/<a href="(\/nba[^"]*)" class="nav-link px-2 link-secondary">([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
        expect(items).toEqual(['Scoreboard /nba/scoreboard', 'Nets /nba', 'Players /nba/players', 'Teams /nba/teams', 'Scatter /nba/scatter', 'Leaders /nba/leaders']);
    });
    test('no featured team: no featured entry, the rest unchanged', async () => {
        state.noFeatured = true;
        try {
            const html = await render();
            expect(html).not.toContain('>Nets<');
            expect(html).toContain('href="/nba/scoreboard"');
        } finally { state.noFeatured = false; }
    });
});
