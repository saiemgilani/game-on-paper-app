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
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba?season=2026'), locals: { preview: true } as App.Locals });
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
