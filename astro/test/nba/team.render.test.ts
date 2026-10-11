// test/nba/team.render.test.ts
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { parseTable, text } from '../helpers/tables';
import { apiSeasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const oracle = read('league_context');
const shots = read('shots') as any[];
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map((s) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result })),
}));

import { NETS_TEAM_ID } from '../../src/nba/data/teams';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
// the table tag carries the id, so the slice must start at its opening tag
const tableFrom = (html: string) => html.slice(html.lastIndexOf('<table', html.indexOf('id="nba-roster"')));
async function render(id: string, query = '') {
    const { default: Page } = await import('../../src/pages/nba/team/[id].astro');
    return container.renderToString(Page, { params: { id }, request: new Request(`https://gameonpaper.com/nba/team/${id}${query}`), locals: { preview: true } as App.Locals });
}

describe('/nba/team/[id]', () => {
    test('one h1, the header line from the shots, the six-chart dashboard, the roster table', async () => {
        const html = await render(String(NETS_TEAM_ID), '?season=2026');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
        expect(text(html.split('<h1')[1].split('</h1>')[0])).toContain('BKN');
        expect(html).toContain('Brooklyn Nets');
        const mine = shots.filter((s) => s.team_id === NETS_TEAM_ID);
        const makes = mine.filter((s) => s.shot_result === 'Made').length;
        expect(text(html.split('id="nba-line"')[1].split('</p>')[0])).toContain(`${makes}/${mine.length.toLocaleString('en-US')} FG`);
        expect(html).toContain('id="nba-hex-panel"');
        expect(html).toContain('Team'); // Dashboard subjectLabel
        const table = parseTable(tableFrom(html));
        // two header rows (column groups, then the columns), then one row per player
        expect(table.rows.slice(2).length).toBe(apiSeasonPlayerRows().filter((x) => x.team_id === NETS_TEAM_ID).length);
        expect(html).toContain('aria-sort="descending"');
        expect(html.match(/aria-sort=/g)).toHaveLength(1); // the sorted header only
        expect(html).toContain('/assets/css/sticky-table.css');
        expect(html).toContain('id="nba-season"');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('?mode=pergame relabels the volume columns and the toggle links carry the other mode', async () => {
        const html = await render(String(NETS_TEAM_ID), '?season=2026&mode=pergame');
        expect(html).toContain('MIN/g');
        expect(html).toContain('FGA/g');
        expect(html).toContain(`href="/nba/team/${NETS_TEAM_ID}"`); // Totals: the default
        expect(html).toContain('aria-current="true"');
    });
    test('a traded player on the roster carries the across-teams marker', async () => {
        // the shots fixture holds Nets shots only, and the Nets have traded players in the 2026 rows
        const traded = apiSeasonPlayerRows().find((r) => r.team_id === NETS_TEAM_ID && r.n_teams > 1 && r.has_stats)!;
        const html = await render(String(NETS_TEAM_ID), '?season=2026');
        const row = html.split('id="nba-roster"')[1].split('<tbody>')[1].split('</tr>').find((tr) => tr.includes(`/nba/players/${traded.person_id}`))!;
        expect(row).toContain('season totals across teams');
    });
});
