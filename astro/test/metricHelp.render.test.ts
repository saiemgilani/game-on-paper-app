import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { modifyMetricForCategory } from '../src/utils/misc';
import { metricHelp } from '../src/utils/metricHelp';
import type { League } from '../src/utils/league';

// N6 metric help on the season leaderboards. The rows are the nfl-data 2025 fixture (as nflLeaderboards.render.test.ts)
// served as mock data; the help itself renders on the college boards only, since the glossary copy is the college one.
const fx = JSON.parse(readFileSync(new URL('./fixtures/nfl-summaries-2025.json', import.meta.url)).toString());

// No read reaches the network: anything the resource mocks below leave to the real module
// (meta, games, splits, percentiles, boards) answers an empty body, and is recorded.
const net = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => (net.calls.push(String(url)), new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } })),
}));
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

async function renderTeams(locals: Record<string, unknown>, league: League = 'cfb') {
    const { default: Page } = await import('../src/components/leaderboards/TeamLeaderboardPage.astro');
    return container.renderToString(Page, {
        props: { season: 2025, category: 'offensive', metric: modifyMetricForCategory('offensive', 'net_adj_epa') },
        request: new Request('https://gameonpaper.com/year/2025/teams/offensive'),
        locals: { league, ...locals } as any, // the container needs only these; Locals' cfContext is a Workers runtime field
    });
}

async function renderPassing(locals: Record<string, unknown>, league: League = 'cfb') {
    const { default: Page } = await import('../src/components/leaderboards/PlayerLeaderboardPage.astro');
    return container.renderToString(Page, {
        props: { season: 2025, category: 'passing', metric: 'EPAplay' },
        request: new Request('https://gameonpaper.com/year/2025/players/passing'),
        locals: { league, ...locals } as any, // the container needs only these; Locals' cfContext is a Workers runtime field
    });
}

const count = (html: string, s: string) => html.split(s).length - 1;

describe('metric help on the team leaderboard', () => {
    test('preview: the SR% header opens the Success Rate popover, one popover per term', async () => {
        const html = await renderTeams({ preview: true });
        const sr = html.match(/<th[^>]*>SR%[^]*?<\/th>/)![0];
        expect(sr).toContain('popovertarget="help-successful-play-success-rate"');
        expect(count(html, 'id="help-successful-play-success-rate" popover')).toBe(1);
        const pop = html.match(/<div id="help-successful-play-success-rate" popover[^]*?<\/div><\/div>/)![0];
        expect(pop).toContain(metricHelp('success_off')!.definition);
        expect(pop).toContain('href="/glossary/#successful-play-success-rate"');
        // SR%, Pass SR%, Rush SR% share one; EPA/Play, EPA/DB, EPA/Rush share one; Adj EPA; Havoc
        expect(count(html, 'popovertarget="help-successful-play-success-rate"')).toBe(3);
        expect(count(html, ' popover ')).toBe(4);
        // Yards/Play has no glossary entry, so no button
        expect(html.match(/<th[^>]*>Yards\/Play[^]*?<\/th>/)![0]).not.toContain('popovertarget');
        // the hover stays alongside the button
        expect(html).toContain('<abbr title="Adjusted for opponent strength, fit with a home-field term on non-garbage-time plays in FBS vs FBS games.">Adj EPA/Play</abbr> <button');
    }, 60_000);

    test('the NFL twin gets no help: the glossary copy is FBS-only', async () => {
        expect(await renderTeams({ preview: true }, 'nfl')).not.toContain('popover');
        expect(await renderPassing({ preview: true }, 'nfl')).not.toContain('popover');
    }, 60_000);

    test('public: no popover, the abbr hover unchanged', async () => {
        const html = await renderTeams({});
        expect(html).not.toContain('popover');
        expect(html).toContain('<abbr title="Adjusted for opponent strength, fit with a home-field term on non-garbage-time plays in FBS vs FBS games.">Adj EPA/Play</abbr> <i');
    }, 60_000);
});

describe('metric help on the player leaderboard', () => {
    test('preview: EPA/DB and Pass SR% get help, Dropbacks does not', async () => {
        const html = await renderPassing({ preview: true });
        expect(html.match(/<th[^>]*>EPA\/DB[^]*?<\/th>/)![0]).toContain('popovertarget="help-epa-per-play-epa-play"');
        expect(html.match(/<th[^>]*>Pass SR%[^]*?<\/th>/)![0]).toContain('popovertarget="help-successful-play-success-rate"');
        expect(html.match(/<th[^>]*>Dropbacks[^]*?<\/th>/)![0]).not.toContain('popovertarget');
        expect(count(html, 'id="help-epa-per-play-epa-play" popover')).toBe(1);
    }, 60_000);

    test('public: no popover', async () => {
        expect(await renderPassing({})).not.toContain('popover');
    }, 60_000);
});
