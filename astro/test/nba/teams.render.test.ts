// test/nba/teams.render.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { text } from '../helpers/tables';
import { apiSeasonPlayerRows } from './rows';

// the seasons each render reads, so a seasonless URL is checked to read the current season (the fixture rows are 2026's)
const reads = vi.hoisted(() => [] as number[]);
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (season: number) => (reads.push(season), apiSeasonPlayerRows()),
}));
import { LAST_KNOWN_SEASON } from '../../src/nba/seasonRange';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('/nba/teams', () => {
    test('one card per team in tricode order, each linking to its team page with the season', async () => {
        const { default: Page } = await import('../../src/pages/nba/teams.astro');
        reads.length = 0;
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/teams'), locals: { preview: true } as App.Locals });
        expect(reads.length).toBeGreaterThan(0);
        expect(new Set(reads)).toEqual(new Set([LAST_KNOWN_SEASON]));
        expect(html.split('<h1').length - 1).toBe(1);
        const grid = html.split('id="nba-teams"')[1];
        expect(grid.match(/href="\/nba\/team\/\d+"/g)?.length).toBe(30);
        const body = text(grid);
        expect(body.indexOf('ATL')).toBeLessThan(body.indexOf('BKN'));
        expect(body.indexOf('BKN')).toBeLessThan(body.indexOf('WAS'));
        expect(html).toContain('Brooklyn Nets');
        expect(body).toMatch(/\d[\d,]* FGA · \d+\.\d% FG · \d+\.\d% eFG/);
        expect(html).toContain('id="nba-season"');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('a past season keeps ?season= on the team links and the former name', async () => {
        const { default: Page } = await import('../../src/pages/nba/teams.astro');
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/teams?season=2010'), locals: { preview: true } as App.Locals });
        expect(html).toContain('href="/nba/team/1610612751?season=2010"');
        expect(html).toContain('New Jersey Nets');
    });
});
