import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { teamNeighborLists } from '../src/utils/neighbors';

// The nearby-rank lists rendered from real ranked rows (fixtures/neighbors-ranked-rows.json).
const fx = JSON.parse(readFileSync(new URL('./fixtures/neighbors-ranked-rows.json', import.meta.url)).toString());

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('NeighborRanks', () => {
    test('one table per list, the team marked once per table, league links and logos, no ramp classes', async () => {
        const { default: NeighborRanks } = await import('../src/components/leaderboards/NeighborRanks.astro');
        const lists = teamNeighborLists(fx.nfl_team_summaries_2025, 14, 'nfl', 2025);
        const html = await container.renderToString(NeighborRanks, { props: { lists, logos: true }, locals: { league: 'nfl' } });
        expect((html.match(/data-nb-metric=/g) ?? []).length).toBe(lists.length);
        expect((html.match(/class="table-secondary"/g) ?? []).length).toBe(lists.length);
        expect(html).toMatch(/href="\/nfl\/year\/2025\/team\/\d+"/);
        expect(html).toContain('teamlogos/nfl/500/');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toContain('hulk-');
        expect(html).toContain('>Off EPA/Play<');
        // the identity column is the row's primary entity: bolded like TeamLeaderboardTable /
        // PlayerLeaderboardTable do, self row included.
        const selfRow = html.match(/<tr[^>]*class="table-secondary"[^>]*>[\s\S]*?<\/tr>/);
        expect(selfRow).toBeTruthy();
        expect(selfRow![0]).toMatch(/<strong>LA<\/strong>/);
        // the mark isn't colour-only: aria-current names the own row too
        expect(selfRow![0]).toContain('aria-current="page"');
    }, 60_000);
});

const calls: any[] = [];
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async (req: any) => {
        calls.push(req);
        const rows = fx.nfl_team_summaries_2025;
        return req.team_id ? rows.filter((r: any) => String(r.team_id) === String(req.team_id)) : rows;
    },
    retrieveTeamSeasonInformation: async () => null,
    retrievePlayerSummaries: async () => [],
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id, location: 'Los Angeles', name: 'Rams', abbreviation: 'LAR', color: '003594', alternateColor: 'ffd100' }),
}));

const fakeAstro = (preview: boolean) => ({
    params: { year: '2025', id: '14' }, locals: { preview } as any,
    url: new URL('https://gameonpaper.com/nfl/year/2025/team/14'), cache: { set: () => {} },
}) as any;

describe('loadSeasonTeam', () => {
    test('reads the season-wide neighbour rows only for a viewer the flag admits', async () => {
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        calls.length = 0;
        const pub: any = await loadSeasonTeam(fakeAstro(false), 'nfl');
        expect(pub.neighborLists).toEqual([]);
        expect(calls.some((c) => c.columns?.includes('explosive_off'))).toBe(false);
        calls.length = 0;
        const prev: any = await loadSeasonTeam(fakeAstro(true), 'nfl');
        expect(calls.some((c) => c.columns?.includes('explosive_off') && !c.team_id)).toBe(true);
        expect(prev.neighborLists).toHaveLength(6);
        expect(prev.neighborLists.every((l: any) => l.rows.filter((r: any) => r.self).length === 1)).toBe(true);
    }, 60_000);
});
