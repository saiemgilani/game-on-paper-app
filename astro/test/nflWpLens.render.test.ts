import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { FOOTBALL_LENS_LABELS, footballWpLenses } from '../src/utils/wpLenses';

// N3, 'nfl-wp-naive-lens': the NFL WP chart's market-aware / score-only lenses on a real processed game
// (fixtures/README.md: game-401671789-nfl.json.gz, BAL at KC, 2024 week 1). Market-aware is the processed play's spread
// WP (home_wp_before), score-only its spread-free WP (home_wp_before_naive): each lens is checked against that column.
const GAME_ID = 401671789;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401671789-nfl.json.gz', import.meta.url))).toString();
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/nfl/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
}));

// Astro serialises each island prop as a [type, value] pair: 0 = value/object, 1 = array.
const decode = (v: any): any => {
    if (!Array.isArray(v)) return v;
    const [t, x] = v;
    if (t === 1) return x.map(decode);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, w]) => [k, decode(w)]));
    return x;
};
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const wpIsland = (html: string) => [...html.matchAll(/<astro-island\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('/WinProbabilityChart.svelte"'))
    .map((tag) => decode([0, JSON.parse(unescape(tag.match(/\sprops="([^"]*)"/)![1]))]))[0];

let container: AstroContainer;
let game: any;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30, 'nfl');
});

async function render(flagOverrides: Record<string, boolean> | undefined, league = 'nfl') {
    const { default: Page } = await import('../src/components/game/GamePage.astro');
    return container.renderToString(Page, {
        props: { id: GAME_ID, game: structuredClone(game), league },
        request: new Request(`https://gameonpaper.com/${league === 'nfl' ? 'nfl/' : ''}game/${GAME_ID}`),
        locals: { league, ...(flagOverrides ? { flagOverrides } : {}) } as any,
    });
}

const charted = () => game.plays.filter((p: any) => p.scrimmage_play == true);
const homeId = () => game.header.competitions[0].competitors.find((c: any) => c.homeAway === 'home').team.id;

describe('footballWpLenses on a real processed NFL game', () => {
    test('market-aware is the home-side spread WP, score-only the home-side spread-free WP, play for play', () => {
        const plays = charted();
        expect(plays.length).toBeGreaterThan(100);
        const lenses = footballWpLenses(plays, homeId())!;
        expect(lenses.map((l) => [l.key, l.label])).toEqual([['model', FOOTBALL_LENS_LABELS.model], ['naive', FOOTBALL_LENS_LABELS.naive]]);
        plays.forEach((p: any, i: number) => {
            expect(lenses[0].values[i]).toBeCloseTo(p.home_wp_before, 6); // float32 on the payload
            expect(lenses[1].values[i]).toBe(p.home_wp_before_naive);
        });
        // KC was a 2.5-point home favourite: the spread moves the opening WP, so the lenses differ
        expect(lenses[0].values.some((v, i) => Math.abs(v - lenses[1].values[i]) > 0.01)).toBe(true);
    });
});

describe('the NFL game page behind nfl-wp-naive-lens', () => {
    test('on: the WP chart gets both lenses, aligned with its plays', async () => {
        const props = wpIsland(await render({ 'nfl-wp-naive-lens': true }));
        expect(props.lenses.map((l: any) => l.key)).toEqual(['model', 'naive']);
        expect(props.lenses[1].values).toEqual(charted().map((p: any) => p.home_wp_before_naive));
        const home = String(props.homeComp.team.id);
        expect(props.lenses[0].values).toEqual(props.plays.map((p: any) => (String(p.pos_team) === home ? p.winProbability.before : 1 - p.winProbability.before)));
    });

    test('off, public, or only the college flag: no lenses, and the chart props are the flag-on props minus the lenses', async () => {
        const off = wpIsland(await render({ 'nfl-wp-naive-lens': false }));
        expect(off).not.toHaveProperty('lenses');
        expect(wpIsland(await render(undefined))).toEqual(off);
        expect(wpIsland(await render({ 'cfb-wp-naive-lens': true }))).toEqual(off);
        const { lenses: _l, ...rest } = wpIsland(await render({ 'nfl-wp-naive-lens': true }));
        expect(rest).toEqual(off);
    });
});
