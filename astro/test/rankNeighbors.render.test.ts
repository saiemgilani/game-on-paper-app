import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
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
        expect((html.match(/class="table-active"/g) ?? []).length).toBe(lists.length);
        expect(html).toMatch(/href="\/nfl\/year\/2025\/team\/\d+"/);
        expect(html).toContain('teamlogos/nfl/500/');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toContain('hulk-');
        expect(html).toContain('>Off EPA/Play<');
        // the identity column is the row's primary entity: bolded like TeamLeaderboardTable /
        // PlayerLeaderboardTable do, self row included.
        const selfRow = html.match(/<tr[^>]*class="table-active"[^>]*>[\s\S]*?<\/tr>/);
        expect(selfRow).toBeTruthy();
        expect(selfRow![0]).toMatch(/<strong>LA<\/strong>/);
    }, 60_000);
});
