import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// Mirror of gamePage.render.test.ts for the NFL: a REAL ProcessedGame from
// /nfl/401772944/process (LV @ DEN, 2025 REG week 10, final) through the
// shared component tree with locals.league = 'nfl'. Proves (a) the NFL record
// shape renders the CFB components, (b) every internal link carries the /nfl
// prefix, (c) no college-football ESPN URL leaks into an NFL page.
const GAME_ID = 401772944;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401772944-nfl.json.gz', import.meta.url))).toString();
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/nfl/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('GamePage renders a finished NFL game end to end', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30, null, 'nfl');
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game, league: 'nfl' },
            request: new Request(`https://gameonpaper.com/nfl/game/${GAME_ID}`),
            locals: { league: 'nfl' },
        });
        if (process.env.DUMP_HTML) writeFileSync(process.env.DUMP_HTML, html);
    }, 60_000);

    test('the whole document arrives, not an empty stream', () => {
        expect(html.length).toBeGreaterThan(100_000);
        expect(html).toContain('</html>');
    });

    test('both teams and the section anchors are present', () => {
        expect(html).toContain('Raiders');
        expect(html).toContain('Broncos');
        for (const anchor of ['#drives', '#all-plays']) expect(html).toContain(`href="${anchor}"`);
    });

    test('internal links carry the /nfl prefix and no cfb link leaks', () => {
        // the matchup preview reads the season tables (on the API since the
        // 2002-2025 rollout), so it is offered -- prefixed like everything else
        expect(html).toContain('href="/nfl/game/matchup?');
        expect(html).not.toMatch(/href="\/game\/matchup\?/);
        expect(html).toContain(`href="/nfl/game/${GAME_ID}"`);
        expect(html).not.toMatch(/href="\/game\/\d+/);
        expect(html).not.toMatch(/href="\/year\/\d{4}\/team\//);
        expect(html).toMatch(/href="\/nfl\/year\/\d{4}\/team\//);
    });

    test('ESPN URLs are the NFL ones', () => {
        expect(html).toContain(`https://www.espn.com/nfl/game/_/gameId/${GAME_ID}`);
        expect(html).toContain(`sports/football/nfl/events/${GAME_ID}.png`);
        // team logos: the shared components used to hard-code the NCAA path
        expect(html).toContain('teamlogos/nfl/500/7.png');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).toContain(`https://gameonpaper.com/nfl/game/${GAME_ID}`); // canonical
        // glossary rows may cite college-football writing (Football Study Hall,
        // The Athletic); what must not appear is an ESPN college-football URL
        expect(html).not.toMatch(/espn\.com\/college-football|football\/college-football\/events/);
    });

    test('the back-to-scoreboard links stay in the league', () => {
        expect(html).toContain('href="/nfl"');
        expect(html).not.toMatch(/href="\/"><i class="bi-arrow-left"/);
        expect(html).not.toContain('/teams/differential');
    });
});
