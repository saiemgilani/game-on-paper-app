// BB-G18 with 'bball-pregame-projection' off: the pregame page and the bracketology bracket render byte for byte what the
// base branch (feat/basketball-game-flow 150dc978) rendered. The snapshots in __pregame_projection__/ were captured by this
// file on that commit, unchanged; never regenerate them from this branch. Every network read is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGameSummary: async () => null }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: async () => [] }));

import NbaPreGamePage from '../src/components/nba/game/NbaPreGamePage.astro';
import BracketologyRoute from '../src/components/routes/BracketologyRoute.astro';

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
/** the checkout root: island `component-url`s are absolute, so strip it to keep the snapshots host-independent */
const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
const snap = (name: string) => `./__pregame_projection__/${name}.html`;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T16:00:00Z'));
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => vi.useRealTimers());

describe("flag off: today's pages", () => {
    test('the pregame page (MARQ at MICH, a real scheduled capture)', async () => {
        const espnGame = gz('pregame-projection').pages['401909524'];
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame }, locals: { league: 'mbb' } as App.Locals });
        await expect(normalize(html)).toMatchFileSnapshot(snap('pregame-off-mbb'));
    });
    test("the bracketology bracket (the 2025-26 men's final snapshot)", async () => {
        const f = gz('bracketology-mbb-2026');
        const data = {
            league: 'mbb', seasons: [2025, 2026, 2027], current: 2027, view: 'bracket', conference: null,
            pick: { snapshot: f.snapshot, season: 2026, fallback: true }, data: { sims: f.sims, bracket: f.bracket, resume: f.resume },
        };
        const html = await container.renderToString(BracketologyRoute, { props: { data }, locals: { league: 'mbb', preview: true } as App.Locals });
        await expect(normalize(html)).toMatchFileSnapshot(snap('bracket-off-mbb'));
    });
});
