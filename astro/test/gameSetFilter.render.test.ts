import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { applyGameSet, gameSetLine, seasonTeams } from '../src/utils/gameSet';
import { formatMetricValue } from '../src/utils/misc';

// The Team Stats game-set panel ('game-set-filter') on the season team page,
// rendered from the Data API's real 2025 bodies (fixtures/team-game-sets-*.json.gz).
const fixtureOf = (league: string) =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/team-game-sets-${league}-2025.json.gz`, import.meta.url))).toString());
const fixtures: Record<string, any> = { cfb: fixtureOf('cfb'), nfl: fixtureOf('nfl') };

// `fail`, when set, makes the season read fail (null)
const feed: { fail: boolean; calls: any[] } = { fail: false, calls: [] };

vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string, league = 'cfb') =>
        ({ id: String(id), location: league === 'nfl' ? 'Kansas City' : 'Alabama', color: '9e1b32', alternateColor: 'ffffff' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [], record: '0-0' }),
    retrievePlayerSummaries: async () => [],
    retrieveTeamOpponentSplits: async () => null,
    retrieveTeamTendencies: async () => [],
    // the season read (columns given) is the membership; the page's own read is the TeamCard's
    retrieveTeamSummaries: async ({ columns, league = 'cfb' }: any) => (columns ? fixtures[league].summaries.data : []),
    retrieveSeasonOpponentSplits: async (season: number, league = 'cfb') => {
        feed.calls.push({ season, league });
        return feed.fail ? null : fixtures[league].splits.data;
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => {
    feed.fail = false;
    feed.calls = [];
});

async function render(league: 'cfb' | 'nfl', id: string, preview: boolean, query = '') {
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/year/[year]/team/[id].astro' : '../src/pages/year/[year]/team/[id].astro');
    return container.renderToString(Page, {
        params: { year: '2025', id },
        request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/year/2025/team/${id}${query}`),
        locals: (preview ? { preview: true } : {}) as App.Locals,
    });
}

const title = (html: string) => html.match(/<div[^>]*id="game-set-panel"[\s\S]*?<h2 class="d-inline">\s*([^<]*?)\s*</)?.[1];
const cells = (html: string) => [...html.match(/<tr data-games="[^"]*">([\s\S]*?)<\/tr>/)![1].matchAll(/<td[^>]*>\s*([^<]*?)\s*(?:<span|<\/td>)/g)].map((m) => m[1]);

describe('flag off', () => {
    test('no panel, no season read, and ?games= is never read', async () => {
        const html = await render('cfb', '333', false, '?games=conf');
        expect(html).not.toContain('game-set-panel');
        expect(feed.calls).toEqual([]);
    });
});

describe('flag on', () => {
    const teams = seasonTeams(fixtures.cfb.summaries.data);
    const bama = fixtures.cfb.splits.data.filter((r: any) => r.team_id === 333);

    test('?games=conf: "Team Stats (Filtered)", the conference line, ranked among the 16 SEC teams', async () => {
        const html = await render('cfb', '333', true, '?games=conf');
        expect(title(html)).toBe('Team Stats (Filtered)');
        const line = gameSetLine(applyGameSet(bama, 'conf', teams));
        expect(cells(html)).toEqual([String(line.games), formatMetricValue(line.epa_per_play, 'num2'), formatMetricValue(line.success_rate, 'pct'),
            formatMetricValue(line.points_for, 'num1'), formatMetricValue(line.points_against, 'num1')]);
        expect(html).toContain('rank among the 16 SEC teams with a game in this set.');
        expect(html).toMatch(/<option value="\?games=conf" selected[^>]*>Conference Games<\/option>/);
        expect(feed.calls).toEqual([{ season: 2025, league: 'cfb' }]);
    });

    test('?games=all, or no parameter: no suffix, ranked among 136 FBS teams', async () => {
        for (const q of ['?games=all', '', '?games=bogus']) {
            const html = await render('cfb', '333', true, q);
            expect(title(html), q).toBe('Team Stats');
            expect(cells(html)[0], q).toBe('15');
            expect(html, q).toContain('rank among the 136 FBS teams');
        }
    });

    test('the same URL renders the same subset (shareable)', async () => {
        const a = await render('cfb', '333', true, '?games=last4');
        const b = await render('cfb', '333', true, '?games=last4');
        expect(cells(a)).toEqual(cells(b));
        expect(cells(a)[0]).toBe('4');
    });

    test('nfl: 32 NFL teams, no "vs FBS" option', async () => {
        const html = await render('nfl', '12', true);
        expect(html).toContain('rank among the 32 NFL teams');
        expect(html).not.toContain('?games=nofcs');
        expect(html).toContain('Data shown is from regular season games only.');
    });

    test('the select sits right of the title, as the team profile\'s season picker', async () => {
        const html = await render('cfb', '333', true);
        expect(html).toMatch(/<div class="panel-heading row">\s*<div class="panel-title col-lg-6 col-12">/);
        expect(html).toContain('<div class="ms-auto col-lg-3 col-12">');
    });

    test('a failed season read: no panel', async () => {
        feed.fail = true;
        const html = await render('cfb', '333', true);
        expect(html).not.toContain('game-set-panel');
    });
});

describe('flag on, no membership', () => {
    test('a failed team_summaries read: the line renders, with no ranks and no rank sentence', async () => {
        const sdv = await import('../src/resources/sdv');
        const spy = vi.spyOn(sdv, 'retrieveTeamSummaries').mockResolvedValue([]);
        const html = await render('cfb', '333', true);
        spy.mockRestore();
        expect(html).toContain('game-set-panel');
        expect(cells(html)[0]).toBe('15');
        expect(html).not.toContain('rank among');
        expect(html).not.toMatch(/#\d/);
    });
});

// The Container API has no cache provider or response headers, so the cache
// policy is pinned on the loader with a stub Astro (as chartBuilder.render.test.ts does).
describe('cache policy (flag on)', () => {
    async function load(membership = true) {
        const sdv = await import('../src/resources/sdv');
        const spy = membership ? null : vi.spyOn(sdv, 'retrieveTeamSummaries').mockResolvedValue([]);
        const set = vi.fn();
        const headers = new Headers();
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        await loadSeasonTeam({
            params: { year: '2025', id: '333' }, locals: { preview: true } as App.Locals,
            url: new URL('https://gameonpaper.com/year/2025/team/333'), cache: { set }, response: { headers },
        } as any, 'cfb');
        spy?.mockRestore();
        return { set, cacheControl: headers.get('Cache-Control') };
    }

    test('a good read leaves the cache policy alone', async () => {
        const { set, cacheControl } = await load();
        expect(set).not.toHaveBeenCalledWith(false);
        expect(cacheControl).toBeNull();
    });

    test('a failed season read is never cached: cache.set(false) and no-store', async () => {
        feed.fail = true;
        const { set, cacheControl } = await load();
        expect(set).toHaveBeenCalledWith(false);
        expect(cacheControl).toBe('no-store');
    });

    test('a failed membership read (no ranks) is never cached either', async () => {
        const { set, cacheControl } = await load(false);
        expect(set).toHaveBeenCalledWith(false);
        expect(cacheControl).toBe('no-store');
    });
});

describe("GenericPanel's panel-controls slot", () => {
    test('a panel without it renders the heading exactly as before (no row/col classes)', async () => {
        const html = await render('cfb', '333', true);
        // every other panel on the page: the pre-slot heading markup
        const headings = [...html.matchAll(/<div class="panel-heading[^"]*">\s*<div class="panel-title[^"]*">/g)].map((m) => m[0].replace(/\s+/g, ' '));
        expect(headings.length).toBeGreaterThan(1);
        expect(headings.filter((h) => h.includes('row'))).toHaveLength(1);
        expect(headings.filter((h) => !h.includes("row"))).toEqual(headings.filter((h) => !h.includes("row")).map(() => "<div class=\"panel-heading\"><div class=\"panel-title\">"));
    });
});
