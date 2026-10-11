// test/nba/players.render.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { parseTable, text } from '../helpers/tables';
import { apiSeasonPlayerRows } from './rows';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
}));

import { NETS_TEAM_ID } from '../../src/nba/data/teams';

const api = apiSeasonPlayerRows();
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
// the table tag carries the id, so the slice must start at its opening tag
// parseTable's rows include the header row, so body rows are rows.slice(1)
const tableFrom = (html: string) => html.slice(html.lastIndexOf('<table', html.indexOf('id="nba-players"')));
async function render(query: string) {
    const { default: Page } = await import('../../src/pages/nba/players.astro');
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/nba/players${query}`), locals: { preview: true } as App.Locals });
}

describe('/nba/players', () => {
    test("the season's Nets by attempts, one table, headers in body order, numbers in .numeral cells", async () => {
        const html = await render('?season=2026');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        const table = parseTable(tableFrom(html));
        expect(table.headers.slice(0, 2)).toEqual(['Player', 'Team']);
        expect(table.headers[2].startsWith('FGA')).toBe(true); // the sorted header carries the arrow
        expect(table.headers[3]).toBe('FG%');
        const nets = api.filter((r) => r.team_id === NETS_TEAM_ID).sort((a, b) => b.attempts - a.attempts);
        expect(table.rows.slice(1).length).toBe(nets.length);
        expect(text(table.rows.slice(1)[0][0])).toContain(nets[0].player_name);
        expect(html).toContain(`href="/nba/players/${nets[0].person_id}"`);
        expect(html).toContain('aria-sort="descending"');
        expect(html).toContain('href="/nba/players?dir=asc"'); // the default sort's other direction, defaults dropped
        expect(html.match(/aria-sort=/g)).toHaveLength(1); // the sorted header only
        expect(html).toContain('id="nba-season"');
        expect(html).toContain('id="nba-team"');
        expect(html).toMatch(/class="[^"]*numeral/); // class:list puts text-end first
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('?team=ALL lists every player and the team column; the sort link flips direction on the sorted column', async () => {
        const html = await render('?season=2026&team=ALL&sort=fgPct');
        const table = parseTable(tableFrom(html));
        expect(table.rows.slice(1).length).toBe(new Set(api.map((r) => r.person_id)).size);
        expect(html).toContain('href="/nba/players?team=ALL&amp;sort=fgPct&amp;dir=asc"');
        expect(html).toContain('href="/nba/players?team=ALL&amp;sort=efgPct"');
        expect(html).toContain('href="/nba/players?team=ALL"'); // the FGA header: the default order is the canonical URL
    });
    test('a traded player on one team carries the across-teams marker', async () => {
        const traded = api.find((r) => r.n_teams > 1 && r.has_stats)!;
        const html = await render(`?season=2026&team=${traded.team_tricode}`);
        const row = html.split('id="nba-players"')[1].split('<tbody>')[1].split('</tr>').find((tr) => tr.includes(`/nba/players/${traded.person_id}`))!;
        expect(row).toContain('season totals across teams');
    });
    test('a past season keeps ?season= on player links and the team options', async () => {
        const html = await render('?season=2010');
        expect(html).toContain('?season=2010"');
        expect(html).toContain('/nba/players?season=2010&amp;team=ALL');
    });
});
