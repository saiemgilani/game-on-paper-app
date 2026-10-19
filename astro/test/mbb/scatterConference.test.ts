// astro/test/mbb/scatterConference.test.ts
// D42/D46 (R2): the college scatter filters by the season's reference conference (team_group_seasons.conference_id, keyed
// by its slug), defaults to the conference with the most players over the bar, and offers All D-I. The NBA/WNBA scatter has no filter.
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { describe, expect, test, vi } from 'vitest';
import { rankMins } from '../../src/basketball/config';
import { conferenceSlug, defaultScatterConference, filterByConference, scatterConferenceOptions } from '../../src/basketball/dashboards';
import { conferenceNames, conferences, coverage, seasonPlayers } from './dashboardFixtures';

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number) => seasonPlayers(s as 2019 | 2023 | 2026),
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => {
        if (state.conferencesDown) throw new Error('conferences read down');
        return { teams: conferences(s as 2019 | 2026), groups: conferenceNames(s as 2019 | 2026) };
    },
}));
const state = vi.hoisted(() => ({ conferencesDown: false }));
const fakeAstro = (path: string) => ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
const bar = rankMins('mbb', 2026).fga; // 40 (D44)
const over = seasonPlayers(2026).filter((r) => r.attempts >= bar);
const confOf = new Map(conferences(2026).map((r) => [Number(r.team_id), conferenceSlug(r.conference_id)]));

describe('the conference key (R2) and the default (D46)', () => {
    test('slugs are the reference ids without the league prefix; options are the season\'s conferences A to Z', () => {
        expect([conferenceSlug('mbb:sec'), conferenceSlug('wbb:big-12'), conferenceSlug('acc')]).toEqual(['sec', 'big-12', 'acc']);
        const o = scatterConferenceOptions(conferences(2026), conferenceNames(2026));
        expect(o.length).toBe(new Set(conferences(2026).map((r) => r.conference_id)).size);
        expect(o.map((x) => x.label)).toEqual([...o.map((x) => x.label)].sort((a, b) => a.localeCompare(b)));
        expect(o.find((x) => x.slug === 'sec')!.label).toBe('SEC');
    });
    test('the default is the conference with the most players over the 2026 bar (ties: slug A to Z)', () => {
        const count = new Map<string, number>();
        for (const r of over) { const c = confOf.get(r.team_id); if (c) count.set(c, (count.get(c) ?? 0) + 1); }
        const best = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        expect(defaultScatterConference(seasonPlayers(2026), conferences(2026), 2026, 'mbb')).toBe(best);
        console.log(`D46 default 2026: ${best} (${count.get(best)} players at ${bar}+ FGA)`); // record in the PR body
        // the tie rule on two real rows of one conference each, at the same count
        const [a, b] = [seasonPlayers(2026).find((r) => confOf.get(r.team_id) === 'acc')!, seasonPlayers(2026).find((r) => confOf.get(r.team_id) === 'sec')!];
        expect(defaultScatterConference([{ ...a, attempts: bar }, { ...b, attempts: bar }], conferences(2026), 2026, 'mbb')).toBe('acc');
        expect(defaultScatterConference(seasonPlayers(2026), [], 2026, 'mbb')).toBe('all');
    });
    test('filterByConference keeps one conference\'s teams; all keeps every row', () => {
        const sec = filterByConference(seasonPlayers(2026), conferences(2026), 'sec');
        expect(sec.length).toBeGreaterThan(0);
        expect(sec.every((r) => confOf.get(r.team_id) === 'sec')).toBe(true);
        expect(filterByConference(seasonPlayers(2026), conferences(2026), 'all')).toHaveLength(seasonPlayers(2026).length);
    });
});

describe('the scatter loader', () => {
    test('default, ?conference=all, ?conference=sec, an unknown slug; only the chosen points reach the island', async () => {
        const { prepareBasketballScatter } = await import('../../src/routes/basketball/scatter');
        const dflt: any = await prepareBasketballScatter(fakeAstro('/mbb/scatter'), 'mbb');
        const all: any = await prepareBasketballScatter(fakeAstro('/mbb/scatter?conference=all'), 'mbb');
        const sec: any = await prepareBasketballScatter(fakeAstro('/mbb/scatter?conference=sec'), 'mbb');
        const junk: any = await prepareBasketballScatter(fakeAstro('/mbb/scatter?conference=nope'), 'mbb');
        expect(dflt.conference.selected).toBe(defaultScatterConference(seasonPlayers(2026), conferences(2026), 2026, 'mbb'));
        expect([all.conference.selected, sec.conference.selected, junk.conference.selected]).toEqual(['all', 'sec', dflt.conference.selected]);
        expect(all.points.length).toBe(over.length);                                 // every player over the bar
        expect(sec.points.length).toBe(over.filter((r) => confOf.get(r.team_id) === 'sec').length);
        expect(sec.points.length).toBeLessThan(all.points.length / 5);               // the island stays light (D42)
    });
    test('the render: the selector inside the season form, All D-I first, the chosen option selected', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); // the scatter island is Svelte
        const { prepareBasketballScatter } = await import('../../src/routes/basketball/scatter');
        const { default: Route } = await import('../../src/components/routes/NbaScatterRoute.astro');
        const html = await container.renderToString(Route, { props: { data: await prepareBasketballScatter(fakeAstro('/mbb/scatter?conference=sec'), 'mbb') }, locals: { league: 'mbb', preview: true } as App.Locals });
        expect(html).toMatch(/<select[^>]*name="conference"/);
        expect(html).toMatch(/<option value="all"[^>]*>All D-I<\/option>\s*<option/);
        expect(html).toMatch(/<option value="sec" selected[^>]*>SEC<\/option>/);
    });
    test('a failed conference read: no selector, every player over the bar, the response uncacheable', async () => {
        const { prepareBasketballScatter } = await import('../../src/routes/basketball/scatter');
        const cache: unknown[] = [];
        const headers = new Headers();
        const astro = { params: {}, url: new URL('https://gameonpaper.com/mbb/scatter?conference=sec'), locals: {} as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any;
        state.conferencesDown = true;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const r: any = await prepareBasketballScatter(astro, 'mbb');
            expect('conference' in r).toBe(false);
            expect(r.points.length).toBe(over.length);
            expect(cache.at(-1)).toBe(false);
            expect(headers.get('Cache-Control')).toBe('no-store');
            const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
            const { default: Route } = await import('../../src/components/routes/NbaScatterRoute.astro');
            const html = await container.renderToString(Route, { props: { data: r }, locals: { league: 'mbb', preview: true } as App.Locals });
            expect(html).not.toMatch(/name="conference"/);
        } finally { state.conferencesDown = false; spy.mockRestore(); }
    });
    test('the island carries only the chosen conference\'s points (D42): the default big-ten, then All D-I', async () => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { prepareBasketballScatter } = await import('../../src/routes/basketball/scatter');
        const { default: Route } = await import('../../src/components/routes/NbaScatterRoute.astro');
        const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const islandPoints = async (path: string) => {
            const html = await container.renderToString(Route, { props: { data: await prepareBasketballScatter(fakeAstro(path), 'mbb') }, locals: { league: 'mbb', preview: true } as App.Locals });
            const tag = [...html.matchAll(/<astro-island\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('/ScatterExplorer.svelte"'))!;
            return JSON.parse(unescape(tag.match(/\sprops="([^"]*)"/)![1])).points[1].length as number; // Astro's [1, array] prop pair
        };
        const bigTen = over.filter((r) => confOf.get(r.team_id) === 'big-ten').length;
        expect(bigTen).toBe(170); // R-P8
        expect(await islandPoints('/mbb/scatter')).toBe(bigTen);
        expect(await islandPoints('/mbb/scatter?conference=all')).toBe(3509); // R-P8: All D-I
    });
});
