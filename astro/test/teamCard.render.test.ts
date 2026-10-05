/**
 * TeamCard's season prefix and its "View full profile" link.
 *
 * The metric headers carry a year only when the numbers come from a DIFFERENT
 * season than the page (a week-1 pregame card showing last year's team). The
 * link always goes to the season the numbers are from. PreGamePage hands the
 * page season over as a number and SeasonTeamRoute as a string; a card whose
 * two seasons were equal threw on `.trim()` until #270's aaee25aa, and no test
 * rendered that case.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test } from 'vitest';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });

const summary = (season: number) => ({
    season, team_id: 333, pos_team: 'Alabama',
    net_adj_epa: 0.25, net_adj_epa_rank: 16, EPAplay_margin: 0.1, EPAplay_margin_rank: 20,
    yardsplay_margin: 0.8, yardsplay_margin_rank: 18, available_yards_pct_margin: 0.05, available_yards_pct_margin_rank: 22,
    success_margin: 0.03, success_margin_rank: 30,
});
const render = async (season: string | number, summarySeason: number, hideNavigation = false) => {
    const { default: TeamCard } = await import('../src/components/team/TeamCard.astro');
    return container.renderToString(TeamCard, {
        props: {
            team: { id: '333', displayName: 'Alabama Crimson Tide', location: 'Alabama', color: '9e1b32', logos: [] },
            season, teamSeason: { record: '4-1', confRecord: '2-0' }, summary: summary(summarySeason), hideNavigation,
        },
        locals: { league: 'cfb' } as any,
    });
};
const headers = (html: string) => [...html.matchAll(/<th class="text-center"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].trim());

describe('TeamCard', () => {
    for (const season of [2026, '2026']) {
        test(`same season (page season a ${typeof season}): no year on the headers, link to that season`, async () => {
            const html = await render(season, 2026);
            expect(headers(html)).toEqual(['2026 Record', 'Adj EPA/Play', 'EPA/Play', 'Yards/Play', 'AY%', 'Success %']);
            expect(html).toContain('href="/year/2026/team/333"');
        }, 60_000);
    }

    test('numbers from another season: the headers say which, and the link goes there', async () => {
        const html = await render(2026, 2025);
        expect(headers(html)).toEqual(['2026 Record', '2025 Adj EPA/Play', '2025 EPA/Play', '2025 Yards/Play', '2025 AY%', '2025 Success %']);
        expect(html).toContain('href="/year/2025/team/333"');
    }, 60_000);

    test('on the team page itself there is no link back to it', async () => {
        expect(await render('2026', 2026, true)).not.toContain('View full profile');
    }, 60_000);
});
