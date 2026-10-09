import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Audit C3, 2026-10-08: the radar and every team-rank colour ramp scaled to a fixed
// 134 teams, but FBS has had 128 (2014), 136 (2025) and 138 (2026). Ranks 135-138
// went below zero and the worst 2014 team plotted at the 4th percentile.
const seen: string[] = [];
const SEASONS = [...Array(128).fill(2014), ...Array(136).fill(2025)].map((season) => ({ season }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        seen.push(String(url));
        const select = new URL(url).searchParams.get('select');
        const data = select === 'season' ? SEASONS : [{ team_id: 1, season: 2014 }, { team_id: 1, season: 2025 }, { team_id: 1, season: 2003 }];
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

beforeEach(() => { seen.length = 0; });

describe('a season row knows how many teams its ranks are out of', () => {
    test('retrieveTeamSummaries attaches each row\'s own season count', async () => {
        const { retrieveTeamSummaries } = await import('../src/resources/sdv');
        const rows = await retrieveTeamSummaries({ team_id: 1 });
        expect(rows.map((r) => [r.season, r.team_count])).toEqual([[2014, 128], [2025, 136], [2003, null]]);
        // one extra read, of one column, for every season
        const counts = seen.filter((u) => new URL(u).searchParams.get('select') === 'season');
        expect(counts).toHaveLength(1);
    });

    test('teamCountOf reads it, and falls back to the league default', async () => {
        const { teamCountOf } = await import('../src/utils/league');
        expect(teamCountOf({ team_count: 128 }, 'cfb')).toBe(128);
        expect(teamCountOf({ team_count: null }, 'cfb')).toBe(134);
        expect(teamCountOf(undefined, 'nfl')).toBe(32);
    });

    test('the radar scales each row to its own season', async () => {
        const { generateRadarPercentiles } = await import('../src/utils/radar');
        const worst2014 = { season: 2014, team_count: 128, EPAplay_off_rank: 128 };
        const epa = (row: any) => generateRadarPercentiles(row, 'Offensive', 'cfb')[0].percentile;
        expect(epa(worst2014)).toBe(0);                            // was 4.5 on a 134 scale
        expect(epa({ ...worst2014, team_count: 138, EPAplay_off_rank: 138 })).toBe(0);   // was negative
        expect(epa({ ...worst2014, team_count: undefined })).toBe(4); // unknown count: the default
    });
});

describe('the matchup view colours each side against its own season', () => {
    test('122nd of 2014\'s 128 is the bottom bucket; 122nd with no count reads the 134 default', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: MatchupView } = await import('../src/components/game/MatchupView.astro');
        const side = (season: number, team_count?: number) => ({ team_id: '1', season, team_count, net_adj_epa: 0.01, net_adj_epa_rank: 122 });
        const html = await container.renderToString(MatchupView, {
            props: {
                awayTeamSeason: null, homeTeamSeason: null, matchupHistory: [],
                awayTeamSummary: side(2014, 128), homeTeamSummary: side(2025),
            },
            request: new Request('https://gameonpaper.com/matchup'),
            locals: { league: 'cfb' } as App.Locals,
        });
        const ranks = [...html.matchAll(/<td class="([^"]*)"[^>]*>#122<\/td>/g)].map((m) => m[1]);
        expect(ranks).toHaveLength(2);
        expect(ranks[0]).toContain('hulk-bg-level-0');   // away: 2014, 128 teams
        expect(ranks[1]).toContain('hulk-bg-level-1');   // home: no count, 134
    }, 60_000);
});
