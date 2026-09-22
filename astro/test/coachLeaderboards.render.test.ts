import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { numericValue, type CoachRow } from '../src/utils/coaches';
import { CURRENT_YEAR, METRIC_YEAR } from '../src/utils/constants';

// The head-coach boards rendered with the real 2024 builder rows
// (fixtures/nfl-coaches-2024.json). The SDV client is mocked -- the tables are
// not on the Data API yet -- so this pins the RENDER contract: copy per league,
// league-prefixed team links and logos, column-header sort links, the plays
// divider, and the empty state.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-coaches-2024.json', import.meta.url)).toString()) as {
    team_tendencies: CoachRow[]; coach_tendencies: CoachRow[]; coach_careers: CoachRow[];
};

// per-test control of what the mocked client returns
const feed = { season: fx.coach_tendencies as CoachRow[], careers: fx.coach_careers as CoachRow[], calls: [] as any[] };

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveCoachTendencies: async (req: any) => { feed.calls.push(['coach_tendencies', req]); return feed.season; },
    retrieveCoachCareers: async (req: any) => { feed.calls.push(['coach_careers', req]); return feed.careers; },
    retrieveTeamTendencies: async () => fx.team_tendencies,
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function renderBoard(league: 'cfb' | 'nfl', board: string, opts: { season?: number; metric?: string } = {}) {
    const { default: Page } = await import('../src/components/leaderboards/CoachLeaderboardPage.astro');
    const prefix = league === 'nfl' ? '/nfl' : '';
    const path = opts.season === undefined ? `${prefix}/coaches/${board}` : `${prefix}/year/${opts.season}/coaches/${board}`;
    return container.renderToString(Page, {
        props: { season: opts.season, board, metric: opts.metric ?? '' },
        request: new Request(`https://gameonpaper.com${path}`),
        // the boards are behind the 'coaches' flag, so the only viewer who reaches
        // one holds the preview cookie -- render as that viewer (header entry included)
        locals: { league, preview: true },
    });
}

const byTop = (rows: CoachRow[], key: string, lowerIsBetter = false) =>
    [...rows].sort((a, b) => ((numericValue(a, key) as number) - (numericValue(b, key) as number)) * (lowerIsBetter ? 1 : -1))[0];

describe('NFL season board', () => {
    test('fourth downs: NFL copy, prefixed team links, NFL logos, the go-rate leader ranked 1', async () => {
        feed.calls = [];
        const html = await renderBoard('nfl', 'fourth-downs', { season: 2024 });
        expect(html).toContain('2024 NFL Head Coach Fourth Down Decisions: Go Rate and Model Agreement');
        expect(html).toContain('<title>2024 NFL Head Coach Fourth Down Aggressiveness: Go Rate vs the Model | Game on Paper</title>');
        // the coach tables pool the playoffs (a 2024 row carries 18-21 games), unlike team_summaries
        expect(html).toContain('Regular season and playoffs');
        expect(html).not.toContain('Regular season games only');
        expect(html).not.toContain('FBS');
        // 32 head coaches, every one over the 300-play floor: no divider
        expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(32);
        expect(html).not.toContain('coach-partial-divider');
        // team links and logos carry the league
        expect(html).toContain('href="/nfl/year/2024/team/12"');
        expect(html).toContain('teamlogos/nfl/500/12.png');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).not.toMatch(/href="\/year\/2024\/team\//);
        // rank 1 is the coach who went for it most often; the row shows the coach and 1 decimal pct
        const top = byTop(fx.coach_tendencies, 'go_rate');
        const rows = html.split('<tr').slice(2); // header row first
        expect(rows[0]).toContain(`<strong>${top.coach}</strong>`);
        expect(rows[0]).toContain(`${((numericValue(top, 'go_rate') as number) * 100).toFixed(1)}%`);
        expect(rows[0]).toMatch(/<td class="text-right"[^>]*>1</);
        // the sorted column shows its arrow; the WP-left columns are points, not pct
        expect(html).toContain('data-sort="go_rate"');
        expect(html).toContain('href="?sort=fourth_wp_left_per_decision"');
        expect(html).not.toMatch(/\d{3,}\.\d%/); // a point-scaled column rendered as pct would read "2967.1%"
        // canonical + JSON-LD dataset url carry the league prefix
        expect(html).toContain('gameonpaper.com/nfl/year/2024/coaches/fourth-downs');
        expect(html).toContain('"@type":"Dataset"');
        expect(html).toContain('fourth-down agreement rate');
        // the resource was asked for exactly this board's columns
        expect(feed.calls[0][0]).toBe('coach_tendencies');
        expect(feed.calls[0][1]).toMatchObject({ season: 2024, league: 'nfl' });
        expect(feed.calls[0][1].columns).toContain('go_rate');
        expect(feed.calls[0][1].columns).not.toContain('sec_per_play');
    }, 60_000);

    test('pace: sorted ascending by seconds per play with a lowest-first rank, and ?sort switches the column', async () => {
        const html = await renderBoard('nfl', 'pace', { season: 2024 });
        const top = byTop(fx.coach_tendencies, 'sec_per_play', true);
        const rows = html.split('<tr').slice(2);
        expect(rows[0]).toContain(`<strong>${top.coach}</strong>`);
        expect(html).toContain('bi bi-arrow-up');
        expect(html).toContain('Seconds per Play');
        const sorted = await renderBoard('nfl', 'pace', { season: 2024, metric: 'plays_per_game' });
        expect(sorted).toContain('data-sort="plays_per_game"');
        const topPlays = byTop(fx.coach_tendencies, 'plays_per_game');
        expect(sorted.split('<tr').slice(2)[0]).toContain(`<strong>${topPlays.coach}</strong>`);
        // an unknown ?sort falls back to the default rather than an empty table
        const bogus = await renderBoard('nfl', 'pace', { season: 2024, metric: 'go_rate' });
        expect(bogus).toContain('data-sort="sec_per_play"');
    }, 60_000);

    test('navigation: every board, the careers link, the season select, and the header entry', async () => {
        const html = await renderBoard('nfl', 'tendencies', { season: 2024 });
        for (const b of ['pace', 'tendencies', 'efficiency', 'scoring', 'fourth-downs', 'defense']) {
            expect(html).toContain(`value="/nfl/year/2024/coaches/${b}"`);
        }
        expect(html).toContain('value="/nfl/coaches/tendencies"');
        expect(html).toContain('value="/nfl/year/2023/coaches/tendencies"');
        if (METRIC_YEAR != CURRENT_YEAR) {
            expect(html).not.toContain(`value="/nfl/year/${CURRENT_YEAR}/coaches/tendencies"`); // the current season redirects
        } else {
            expect(html).toContain(`value="/nfl/year/${CURRENT_YEAR}/coaches/tendencies"`); // the current season should not redirect
        }
        // the shared header offers the coach boards to every page
        expect(html).toContain('Head Coaches');
        expect(html).toContain(`href="/nfl/year/${METRIC_YEAR}/coaches/pace"`);
        expect(html).toContain('href="/nfl/coaches/pace"');
        // situation-neutral column with its hover
        expect(html).toContain('Neutral Pass Rate');
        expect(html).toContain('win probability between 20% and 80%');
    }, 60_000);
});

describe('careers board', () => {
    test('teams and season spans instead of a logo, interim stints under the divider, unranked', async () => {
        const html = await renderBoard('nfl', 'efficiency');
        expect(html).toContain('NFL Head Coach Career Offensive Efficiency: EPA per Play');
        expect(html).toContain('<th class="text-left text-nowrap" colspan="1">Teams</th>');
        expect(html).toContain('2023–2024 (2)');
        expect(html).not.toContain('teamlogos/');
        expect(html).toContain('coach-partial-divider');
        expect(html).toContain('Fewer than 1500 plays');
        const [above, below] = html.split('coach-partial-divider');
        expect(above).toContain('<strong>Andy Reid</strong>');
        expect(below).toContain('<strong>Giff Smith</strong>');
        expect(above).not.toContain('<strong>Giff Smith</strong>');
        // the partial rows carry a dash for a rank, never a number
        expect(below).toMatch(/<td class="text-right text-muted" colspan="1">—<\/td>/);
        // links back to the season boards
        expect(html).toContain('value="/nfl/year/2025/coaches/efficiency"');
        expect(html).toContain('gameonpaper.com/nfl/coaches/efficiency');
        // the Dataset's coverage is what the rows span, not the league's season range
        expect(html).toContain('"temporalCoverage":"2023/2024"');
        expect(html).not.toContain('2002/2025');
    }, 60_000);

    test('with no career rows the Dataset claims no coverage at all', async () => {
        const saved = feed.careers;
        feed.careers = [];
        try {
            const html = await renderBoard('cfb', 'pace');
            expect(html).toContain('No head coach data yet');
            expect(html).toContain('"@type":"Dataset"');
            expect(html).not.toContain('temporalCoverage');
        } finally {
            feed.careers = saved;
        }
    }, 60_000);
});

describe('college twin and the empty state', () => {
    test('/year/2024/coaches/defense stays college: unprefixed links, ncaa logos, FBS copy', async () => {
        const html = await renderBoard('cfb', 'defense', { season: 2024 });
        expect(html).toContain('2024 College Football Head Coach Defense: EPA per Play Allowed');
        expect(html).toContain('href="/year/2024/team/12"');
        expect(html).toContain('teamlogos/ncaa/500/12.png');
        expect(html).not.toContain('href="/nfl/');
        expect(html).toContain('FBS vs FBS games only');
        // a defense board ranks lowest-first
        expect(html).toContain('bi bi-arrow-up');
        const top = byTop(fx.coach_tendencies, 'def_epa_per_play', true);
        expect(html.split('<tr').slice(2)[0]).toContain(`<strong>${top.coach}</strong>`);
    }, 60_000);

    test('a season the tables lack renders the empty note, not an empty table', async () => {
        const saved = feed.season;
        feed.season = [];
        try {
            const html = await renderBoard('cfb', 'pace', { season: 2004 });
            expect(html).toContain('No head coach data for the 2004 season yet');
            expect(html).not.toContain('<table');
            expect(html).toContain('2004 College Football Head Coach Pace');
        } finally {
            feed.season = saved;
        }
    }, 60_000);

    test('a null pace value renders as a dash', async () => {
        const saved = feed.season;
        feed.season = fx.coach_tendencies.map((r, i) => (i === 0 ? { ...r, sec_per_play: null, pace_coverage: 0 } : r));
        try {
            const html = await renderBoard('nfl', 'pace', { season: 2024 });
            const rows = html.split('<tr').slice(2);
            // the null row sorts last among the ranked rows and shows the dash
            const nullRow = rows.find((r) => r.includes(`<strong>${fx.coach_tendencies[0].coach}</strong>`))!;
            expect(nullRow).toContain('>—</td>');
            expect(nullRow).toContain('0.0%');
            expect(rows.indexOf(nullRow)).toBe(31);
        } finally {
            feed.season = saved;
        }
    }, 60_000);
});

describe('nfl page files render the shared component as NFL', () => {
    test('/nfl/year/2024/coaches/fourth-downs', async () => {
        const { default: Page } = await import('../src/pages/nfl/year/[year]/coaches/[board].astro');
        const html = await container.renderToString(Page, {
            params: { year: '2024', board: 'fourth-downs' },
            request: new Request('https://gameonpaper.com/nfl/year/2024/coaches/fourth-downs'),
            locals: { preview: true },
        });
        expect(html).toContain('2024 NFL Head Coach Fourth Down Decisions');
        expect(html).toContain('href="/nfl/year/2024/team/12"');
        expect(html).not.toMatch(/href="\/year\/2024\/team\//);
    }, 60_000);

    test('/nfl/coaches/pace', async () => {
        const { default: Page } = await import('../src/pages/nfl/coaches/[board].astro');
        const html = await container.renderToString(Page, {
            params: { board: 'pace' },
            request: new Request('https://gameonpaper.com/nfl/coaches/pace'),
            locals: { preview: true },
        });
        expect(html).toContain('NFL Head Coach Career Pace: Seconds per Play');
        expect(html).toContain(`href="/nfl/year/${METRIC_YEAR}/coaches/pace"`);
    }, 60_000);

    test('/year/2024/coaches/pace stays college', async () => {
        const { default: Page } = await import('../src/pages/year/[year]/coaches/[board].astro');
        const html = await container.renderToString(Page, {
            params: { year: '2024', board: 'pace' },
            request: new Request('https://gameonpaper.com/year/2024/coaches/pace'),
            locals: { preview: true },
        });
        expect(html).toContain('2024 College Football Head Coach Pace');
        expect(html).toContain('href="/year/2024/team/12"');
        expect(html).not.toContain('href="/nfl/');
    }, 60_000);
});
