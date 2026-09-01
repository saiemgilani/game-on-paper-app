import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// Why this exists: a TDZ ReferenceError in GamePage's frontmatter shipped in
// #181 and every finished-game page rendered as a 200 with an empty body.
// vitest + `astro build` both passed -- nothing rendered a game page before
// merge. This renders a REAL ProcessedGame (captured from the Flask app's
// /cfb/<id>/process against the ESPN summary in cfbfastR-cfb-raw) through the
// component tree, so a frontmatter throw fails here instead of in production.

// The API payload is fed through retrieveProcessedGame exactly as the route
// does it (scoringPlays are rebuilt from processed plays there; the raw list
// has no `start` and would throw in PlayRow), by answering the Python fetch
// with the fixture.
const GAME_ID = 401729745;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString();
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
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => null,
    retrieveMatchupHistory: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('GamePage renders a finished game end to end', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30);
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game },
            request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        });
    }, 60_000);

    test('the whole document arrives, not an empty stream', () => {
        expect(html.length).toBeGreaterThan(100_000);
        expect(html).toContain('</html>');
    });

    test('head says what the page is', () => {
        expect(html).toMatch(/<title>[^<]*EPA &(amp;)? advanced box score \| Game on Paper<\/title>/);
        expect(html).toMatch(/<meta name="description" content="[^"]*EPA per play/);
        expect(html).toContain(`<link rel="canonical" href="https://gameonpaper.com/game/${GAME_ID}">`);
    });

    test('exactly one h1 and a SportsEvent that parses', () => {
        expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
        const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        const ev = ld.find((o) => o['@type'] === 'SportsEvent');
        expect(ev?.url).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(ev?.homeTeam?.name).toBeTruthy();
    });
});
