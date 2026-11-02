import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bestSeasons, coachEras, conferenceSpans } from '../src/utils/teamHub';

// 'team-hub' (S12): the team profile's Best Seasons, Head Coaches and Conference History tables.
// Fixtures: real Data API rows (test/fixtures/README.md) -- Texas A&M (245, Big 12 -> SEC in 2012),
// Kansas State (2306, Bill Snyder leaves after 2005 and returns in 2009), Kansas City (12, two head
// coaches in 2011; net adj EPA rank 1 in both 2018 and 2022).
const CFB = JSON.parse(readFileSync(new URL('./fixtures/team-hub-cfb.json', import.meta.url)).toString());
const NFL = JSON.parse(readFileSync(new URL('./fixtures/team-hub-nfl.json', import.meta.url)).toString());
const fixtureFor = (league: string) => (league === 'nfl' ? NFL : CFB);
const METRICS = ['net_adj_epa', 'EPAplay_margin', 'adj_off_epa', 'EPAplay_off', 'adj_def_epa', 'EPAplay_def'];

const net = vi.hoisted(() => ({ seen: [] as string[], signals: [] as unknown[], timeout: false }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string, init?: RequestInit) => {
        net.seen.push(String(url));
        net.signals.push(init?.signal);
        if (net.timeout) throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
        const u = new URL(String(url));
        const league = u.pathname.split('/')[2];
        const rows = fixtureFor(league).coach_tendencies[u.searchParams.get('pos_team_id') ?? ''] ?? [];
        return new Response(JSON.stringify({ count: rows.length, data: rows }), { status: 200 });
    },
}));
// the route's other reads; retrieveTeamCoachSeasons stays real (served by wrappedFetch above)
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSeasonPercentiles: async () => [],
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async ({ team_id, league }: { team_id: number; league: string }) => structuredClone(fixtureFor(league).team_summaries[String(team_id)] ?? []),
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id, location: 'Team', name: 'Name', color: '500000', alternateColor: 'ffffff' }),
}));

beforeEach(() => { net.seen.length = 0; net.signals.length = 0; net.timeout = false; });

describe('bestSeasons', () => {
    test('the lowest-rank season per metric, ties to the most recent', () => {
        const best = bestSeasons(NFL.team_summaries['12'], METRICS);
        expect(best.map(b => b.metric)).toEqual(METRICS);
        // Kansas City: net adj EPA rank 1 in 2018 and in 2022
        expect(NFL.team_summaries['12'].filter((r: any) => r.net_adj_epa_rank === 1).map((r: any) => r.season)).toEqual([2018, 2022]);
        expect(best[0].row.season).toBe(2022);
        // every pick holds the minimum rank of its metric
        for (const { metric, row } of best) {
            expect((row as Record<string, unknown>)[`${metric}_rank`]).toBe(Math.min(...NFL.team_summaries['12'].map((r: any) => r[`${metric}_rank`])));
        }
        expect(bestSeasons(CFB.team_summaries['245'], ['net_adj_epa'])[0].row.season).toBe(2012);
    });

    test('a metric no row ranks is left out', () => {
        const rows = CFB.team_summaries['245'].map((r: any) => ({ ...r, EPAplay_off_rank: null }));
        expect(bestSeasons(rows, ['EPAplay_off', 'net_adj_epa']).map(b => b.metric)).toEqual(['net_adj_epa']);
        expect(bestSeasons([], METRICS)).toEqual([]);
    });
});

describe('coachEras', () => {
    const brief = (rows: any[]) => coachEras(rows).map(e => [e.coach, e.first_season, e.last_season, e.seasons]);

    test('a coach who returns after a gap gets two eras (Kansas State)', () => {
        expect(brief(CFB.coach_tendencies['2306'])).toEqual([
            ['Bill Snyder', 2004, 2005, 2], ['Ron Prince', 2006, 2008, 3], ['Bill Snyder', 2009, 2018, 10],
            ['Chris Klieman', 2019, 2025, 7], ['Collin Klein', 2026, 2026, 1],
        ]);
        expect(coachEras(CFB.coach_tendencies['2306'])[0].games).toBe(16);
    });

    test('a mid-season change keeps the season for both coaches (Kansas City 2011)', () => {
        expect(brief(NFL.coach_tendencies['12'])).toEqual([
            ['Dick Vermeil', 2002, 2005, 4], ['Herm Edwards', 2006, 2008, 3], ['Todd Haley', 2009, 2011, 3],
            ['Romeo Crennel', 2011, 2012, 2], ['Andy Reid', 2013, 2026, 14],
        ]);
    });

    test('a season the data lacks does not split an era (Texas A&M has no 2023 coach row)', () => {
        expect(CFB.coach_tendencies['245'].some((r: any) => r.season === 2023)).toBe(false);
        expect(brief(CFB.coach_tendencies['245']).slice(-2)).toEqual([['Jimbo Fisher', 2018, 2022, 5], ['Mike Elko', 2024, 2026, 3]]);
        // games are summed over the era
        const fisher = CFB.coach_tendencies['245'].filter((r: any) => r.coach === 'Jimbo Fisher');
        expect(coachEras(CFB.coach_tendencies['245']).find(e => e.coach === 'Jimbo Fisher')!.games).toBe(fisher.reduce((s: number, r: any) => s + r.games, 0));
    });
});

describe('conferenceSpans', () => {
    test('each realignment starts a span (Texas A&M: Big 12 -> SEC)', () => {
        expect(conferenceSpans(CFB.team_summaries['245'])).toEqual([
            { conference: 'Big 12', first_season: 2004, last_season: 2011, seasons: 8 },
            { conference: 'SEC', first_season: 2012, last_season: 2026, seasons: 15 },
        ]);
        expect(conferenceSpans(CFB.team_summaries['2306'])).toEqual([{ conference: 'Big 12', first_season: 2004, last_season: 2026, seasons: 23 }]);
    });
});

describe('team profile route', () => {
    async function render(league: 'cfb' | 'nfl', id: string, preview: boolean) {
        const locals = (preview ? { preview: true } : {}) as App.Locals;
        const { loadTeamProfile } = await import('../src/routes/teamProfile');
        const data = await loadTeamProfile({ params: { id }, locals, cache: { set: () => {} } } as any, league);
        if ('notFound' in data) throw new Error('not found');
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Route } = await import('../src/components/routes/TeamProfileRoute.astro');
        const html = await container.renderToString(Route, { props: { ...data }, request: new Request(`https://gameonpaper.com/team/${id}`), locals });
        return { data, html };
    }
    const coachReads = () => net.seen.filter(u => u.includes('/coach_tendencies'));
    const panel = (html: string, id: string) => html.match(new RegExp(`id="${id}-panel"[\\s\\S]*?</table>`))?.[0];

    test('flag on (cfb): three panels, one coach read for the team', async () => {
        const { html } = await render('cfb', '245', true);
        const [read] = coachReads();
        const q = new URL(read).searchParams;
        expect(new URL(read).pathname).toBe('/v1/cfb/coach_tendencies');
        expect([q.get('pos_team_id'), q.get('role'), q.get('limit')]).toEqual(['245', 'HC', '400']);
        expect(q.get('select')!.split(',').sort()).toEqual(['coach', 'drives', 'games', 'plays', 'pos_team', 'pos_team_id', 'role', 'season']);

        const best = panel(html, 'best-seasons')!;
        expect(best.match(/<tr>/g)).toHaveLength(1 + METRICS.length);
        expect(best).toContain('href="/year/2012/team/245"');
        const coaches = panel(html, 'head-coaches')!;
        expect(coaches).toContain('<strong>Kevin Sumlin</strong>');
        expect(coaches).toContain('2018–2022 (5)');
        const conf = panel(html, 'conference-history')!;
        expect(conf).toContain('2004–2011 (8)');
        expect(conf).toContain('2012–2026 (15)');
        // tables only: the panels add no sentence
        for (const p of [best, coaches, conf]) expect(p).toMatch(/<p class="text-small text-muted"><\/p>/);
    });

    test('flag on (nfl): Best Seasons and Head Coaches, no Conference History', async () => {
        const { html } = await render('nfl', '12', true);
        expect(new URL(coachReads()[0]).pathname).toBe('/v1/nfl/coach_tendencies');
        expect(panel(html, 'best-seasons')).toContain('href="/nfl/year/2022/team/12"');
        expect(panel(html, 'head-coaches')).toContain('2013–2026 (14)');
        expect(html).not.toContain('conference-history');
    });

    test('flag off: no coach read, no coachSeasons, no panels', async () => {
        for (const [league, id] of [['cfb', '245'], ['nfl', '12']] as const) {
            const { data, html } = await render(league, id, false);
            expect('coachSeasons' in data).toBe(false);
            for (const p of ['best-seasons', 'head-coaches', 'conference-history']) expect(html).not.toContain(`${p}-panel`);
        }
        expect(coachReads()).toEqual([]);
    });

    test('the coach read has a deadline; past it the page renders without Head Coaches', async () => {
        net.timeout = true;
        const { html } = await render('cfb', '2306', true);
        expect(coachReads()).toHaveLength(1);
        expect(net.signals[0]).toBeInstanceOf(AbortSignal);
        expect(html).not.toContain('head-coaches-panel');
        expect(html).toContain('best-seasons-panel');
        expect(html).toContain('conference-history-panel');
    });

    test('no coach rows, no Head Coaches panel', async () => {
        const { html } = await render('cfb', '99999', true);
        expect(html).not.toContain('head-coaches-panel');
        expect(html).not.toContain('best-seasons-panel');
    });
});
