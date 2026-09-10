import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// The season surfaces (team + player leaderboards) rendered for the NFL with
// real rows from the nfl-data producer's 2025 build (tests/fixtures/
// nfl-summaries-2025.json: top-4 teams by net adjusted EPA, top-4 qualified
// passers). The SDV client is mocked -- the NFL tables are not on the API yet
// -- so this pins the RENDER contract: league-prefixed links, NFL logo URLs,
// NFL copy, and the rbsdm-style extra category resolving to real columns.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-summaries-2025.json', import.meta.url)).toString());

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async () => fx.team_summaries,
    retrievePlayerSummaries: async () => fx.passing,
    retrievePercentiles: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function renderTeams(category: string) {
    const { default: Page } = await import('../src/components/leaderboards/TeamLeaderboardPage.astro');
    return container.renderToString(Page, {
        props: { season: 2025, category, metric: category === 'differential' ? 'net_adj_epa' : undefined },
        request: new Request(`https://gameonpaper.com/nfl/year/2025/teams/${category}`),
        locals: { league: 'nfl' },
    });
}

describe('NFL team leaderboard', () => {
    test('net statistics: NFL copy, prefixed links, NFL logos, real teams', async () => {
        const html = await renderTeams('differential');
        expect(html).toContain('2025 NFL Team Rankings by Net EPA per Play');
        expect(html).toContain('href="/nfl/year/2025/team/14"'); // Rams, rank 1 in the fixture
        expect(html).toContain('teamlogos/nfl/500/14.png');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toMatch(/href="\/year\/2025\/team\//);
        expect(html).not.toContain('FBS vs FBS');
        expect(html).toContain('Regular season games only');
    }, 60_000);

    test('the rbsdm "tendencies" category renders its columns for the NFL', async () => {
        const html = await renderTeams('tendencies');
        expect(html).toContain('Pass Rate Over Expected');
        expect(html).toContain('PROE');
        expect(html).toContain('Neutral Pass Rate');
        // canonical + JSON-LD dataset url carry the league prefix
        expect(html).toContain('gameonpaper.com/nfl/year/2025/teams/tendencies');
    }, 60_000);
});

describe('NFL passing leaderboard', () => {
    test('NFL copy, prefixed team links, real passers', async () => {
        const { default: Page } = await import('../src/components/leaderboards/PlayerLeaderboardPage.astro');
        const html = await container.renderToString(Page, {
            props: { season: 2025, category: 'passing', metric: 'EPAplay' },
            request: new Request('https://gameonpaper.com/nfl/year/2025/players/passing'),
            locals: { league: 'nfl' },
        });
        expect(html).toContain('2025 NFL Passing EPA per Play Leaders');
        expect(html).toContain('D.Maye');
        expect(html).toMatch(/href="\/nfl\/year\/2025\/team\/\d+"/);
        expect(html).not.toMatch(/href="\/year\/2025\/team\//);
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toContain('FBS');
    }, 60_000);
});

describe('team index + categories per league', () => {
    test('retrieveAllTeams knows 32 NFL teams by ESPN id', async () => {
        const { retrieveAllTeams } = await import('../src/utils/teams');
        const nfl = retrieveAllTeams('nfl');
        expect(nfl).toHaveLength(32);
        expect(nfl.find(t => t.team_id === 7)?.name).toBe('Denver Broncos');
        expect(retrieveAllTeams().length).toBeGreaterThan(100); // cfb unchanged
    });
    test('the nfl offers the rbsdm categories and the cfb does not', async () => {
        const { teamCategoriesFor } = await import('../src/utils/league');
        expect(teamCategoriesFor('cfb')).toEqual(['differential', 'offensive', 'defensive']);
        expect(teamCategoriesFor('nfl')).toEqual(['differential', 'offensive', 'defensive', 'tendencies', 'fourth-downs', 'luck']);
    });
});
