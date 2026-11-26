import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { FOOTBALL_LENS_LABELS, footballWpLenses } from '../src/utils/wpLenses';

// E2, 'cfb-wp-naive-lens': the college football WP chart's market-aware / score-only lenses, on a real processed game
// (fixtures/README.md: game-401729745.json.gz). The lenses are checked against the processed plays' own home-side columns,
// which the builder never reads for the market-aware lens (it flips the possession team's WP, as the chart does).
const GAME_ID = 401729745;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString();
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/cfb/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
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
    game = await retrieveProcessedGame(GAME_ID, 30);
});

async function render(locals: Record<string, unknown>) {
    const { default: Page } = await import('../src/components/game/GamePage.astro');
    return container.renderToString(Page, {
        props: { id: GAME_ID, game: structuredClone(game) },
        request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        locals: locals as any,
    });
}

const charted = () => game.plays.filter((p: any) => p.scrimmage_play == true);

describe('footballWpLenses on a real processed game', () => {
    test('market-aware is the home-side spread WP, score-only the home-side spread-free WP, play for play', () => {
        const plays = charted();
        const lenses = footballWpLenses(plays, game.header.competitions[0].competitors[0].team.id)!;
        expect(lenses.map((l) => [l.key, l.label])).toEqual([['model', FOOTBALL_LENS_LABELS.model], ['naive', FOOTBALL_LENS_LABELS.naive]]);
        expect(lenses[0].values).toHaveLength(plays.length);
        plays.forEach((p: any, i: number) => {
            expect(lenses[0].values[i]).toBeCloseTo(p.home_wp_before, 6); // home_wp_before is float32 on the payload
            expect(lenses[1].values[i]).toBe(p.home_wp_before_naive);
        });
        // the two lenses differ on this game (the spread is priced into one of them)
        expect(lenses[0].values.some((v, i) => Math.abs(v - lenses[1].values[i]) > 0.01)).toBe(true);
    });

    test('one charted play without a spread-free value means no lenses', () => {
        const plays = charted().map((p: any, i: number) => (i === 3 ? { ...p, home_wp_before_naive: null } : p));
        expect(footballWpLenses(plays, game.header.competitions[0].competitors[0].team.id)).toBeNull();
        expect(footballWpLenses([], 1)).toBeNull();
    });
});

describe('the game page behind cfb-wp-naive-lens', () => {
    test('on: the WP chart gets both lenses, aligned with its plays', async () => {
        const props = wpIsland(await render({ flagOverrides: { 'cfb-wp-naive-lens': true } }));
        expect(props.lenses.map((l: any) => l.key)).toEqual(['model', 'naive']);
        expect(props.lenses[1].values).toHaveLength(props.plays.length);
        expect(props.lenses[1].values).toEqual(charted().map((p: any) => p.home_wp_before_naive));
    });

    test('off: no lenses prop, and the chart props are the same as with the flag left at its default for the public', async () => {
        const off = wpIsland(await render({ flagOverrides: { 'cfb-wp-naive-lens': false } }));
        expect(off).not.toHaveProperty('lenses');
        const on = wpIsland(await render({ flagOverrides: { 'cfb-wp-naive-lens': true } }));
        const { lenses: _l, ...rest } = on;
        expect(rest).toEqual(off);
    });

    test('an NFL game page never gets the college lenses', async () => {
        const { default: Page } = await import('../src/components/game/GamePage.astro');
        const html = await container.renderToString(Page, {
            props: { id: GAME_ID, game: structuredClone(game), league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { flagOverrides: { 'cfb-wp-naive-lens': true } } as any,
        });
        expect(wpIsland(html)).not.toHaveProperty('lenses');
    });
});
