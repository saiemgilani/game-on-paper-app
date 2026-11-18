import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { text } from '../helpers/tables';

const players = JSON.parse(readFileSync(new URL('../fixtures/nba/season_players.json', import.meta.url)).toString());
const rows = players.map((p: any) => ({
    season: 2026, person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
    attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, ra_attempts: 0, ra_makes: 0, mid_attempts: 0, mid_makes: 0,
    is_primary: true, n_teams: 1, has_stats: p.stats !== null, gp: p.stats?.gp ?? null, min_pg: p.stats?.min ?? null,
    fga_total: null, fg_pct: null, efg_pct: null, ts_pct: null, usg_pct: null, pie: null, pts_pg: null, fga_pg: null, min_total: null, headshot_href: null,
}));
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => rows,
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('/nba', () => {
    test('renders the Nets roster for the season, most attempts first, with the season picker', async () => {
        const { default: Page } = await import('../../src/pages/nba/index.astro');
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba?season=2026'), locals: { preview: true, flagOverrides: { 'bball-hub': false } } as App.Locals });
        const top = [...players].sort((a: any, b: any) => b.attempts - a.attempts)[0];
        expect(html).toContain(`/nba/players/${top.person_id}`);
        const body = text(html.split('id="nba-roster"')[1]);
        expect(body.indexOf(top.player_name)).toBeLessThan(body.indexOf(players.find((p: any) => p !== top).player_name));
        expect(html).toContain('id="nba-season"');
        expect(html).toContain('2025-26');
        expect(html.split('<h1').length - 1).toBe(1);
        expect(html).not.toContain('undefined');
    });
});

// Nov 17 (#458): the hub takes /nba behind 'bball-hub', so the Nets landing moves to /nba/roster, same read and template.
describe('/nba/roster behind bball-hub', () => {
    const pages = { '/nba': () => import('../../src/pages/nba/index.astro'), '/nba/roster': () => import('../../src/pages/nba/roster.astro') };
    const render = async (url: keyof typeof pages, hub: boolean) => {
        const { default: Page } = await pages[url]();
        return container.renderToResponse(Page, { request: new Request(`https://gameonpaper.com${url}?season=2026`), locals: { preview: true, flagOverrides: { 'bball-hub': hub } } as App.Locals });
    };
    test("on: the landing's roster, with its season picker and canonical on /nba/roster", async () => {
        const r = await render('/nba/roster', true);
        expect(r.status).toBe(200);
        const html = await r.text();
        const landing = await (await render('/nba', false)).text();
        const cards = (h: string) => h.slice(h.indexOf('id="nba-roster"'), h.indexOf('</main>'));
        expect(cards(html).length).toBeGreaterThan(100);
        expect(cards(html)).toBe(cards(landing));
        expect(html).toContain('value="/nba/roster');
        expect(html).not.toMatch(/value="\/nba(\?|")/);
        expect(html).toContain('<link rel="canonical" href="https://gameonpaper.com/nba/roster');
        expect(html.split('<h1').length - 1).toBe(1);
        expect(html).not.toContain('undefined');
    });
    test("off: the site's 404", async () => {
        const { default: NotFound } = await import('../../src/pages/404.astro');
        container.insertPageRoute('/404', NotFound);
        const r = await render('/nba/roster', false);
        expect(r.status).toBe(404);
        expect(await r.text()).toContain('This page could not be found.');
    });
    test('on: an old season link to the landing (/nba?season=) redirects to /nba/roster; off, it renders as today', async () => {
        const on = await render('/nba', true);
        expect(on.status).toBe(302);
        expect(on.headers.get('location')).toBe('/nba/roster?season=2026');
        expect((await render('/nba', false)).status).toBe(200);
    });
});
