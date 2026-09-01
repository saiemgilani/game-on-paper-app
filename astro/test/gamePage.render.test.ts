import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
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
        // DUMP_HTML=/path/file.html npx vitest run test/gamePage.render.test.ts -- for eyeballing the render
        if (process.env.DUMP_HTML) writeFileSync(process.env.DUMP_HTML, html);
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

    test('play marks: one sprite, and every touchdown/penalty row carries its mark', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30);
        expect((html.match(/<symbol id="pi-td"/g) ?? []).length).toBe(1);
        expect(html).not.toContain('#pi-kickoff');
        // per row: the "All plays" table renders every play once, keyed by game_play_number
        const rowFor = (n: number) => html.split('<tr').find((r) => r.includes(`href="#play-all-${n}"`)) ?? '';
        // a family may render as a variant (td-xp, penalty-declined, ...), so match the id prefix
        const checks: Array<[string, RegExp]> = [['touchdown', /<use href="#pi-td(-xp|-2pt)?(-miss)?">/], ['penalty_flag', /<use href="#pi-penalty(-declined|-offset)?">/], ['sack', /class="pi-pill pi-sack"[^>]*>SACK</], ['int', /<use href="#pi-int">/], ['stuffed_run', /(class="pi-pill pi-(sack|tfl)"|<use href="#pi-stuffed">)/]];
        for (const [flag, re] of checks) {
            const plays = game.plays.filter((p: any) => p[flag] === true);
            expect(plays.length, flag).toBeGreaterThan(0);
            for (const p of plays) expect(rowFor(p.game_play_number), `${flag} play ${p.game_play_number}`).toMatch(re);
        }
        // defensive scores keep the touchdown glyph in the turnover colour
        const defTd = game.plays.filter((p: any) => p.touchdown === true && p.defense_score_play === true);
        expect(defTd.length).toBeGreaterThan(0);
        for (const p of defTd) expect(rowFor(p.game_play_number), `defensive td ${p.game_play_number}`).toMatch(/class="pi pi-td(-xp|-2pt)?(-miss)? pi-def"/);
        for (const p of game.plays.filter((p: any) => p.touchdown === true && p.defense_score_play !== true)) expect(rowFor(p.game_play_number)).not.toContain('pi-def');
        // the 53-yard kickoff return gets the bolt by yardage
        const bigRet = game.plays.find((p: any) => Number(p.yds_kickoff_return) >= 40);
        if (bigRet) expect(rowFor(bigRet.game_play_number)).toContain('<use href="#pi-explosive">');
        // every touchdown in this game had a good PAT -> the conversion rides on the mark
        expect((html.match(/<use href="#pi-td-xp">/g) ?? []).length).toBeGreaterThanOrEqual(game.plays.filter((p: any) => p.touchdown === true && p.xp_made === true).length);
        // routine kicks carry no mark at all; a kick returned for a score still carries the touchdown
        const { playIcons } = await import('../src/utils/playIcons');
        const kicks = game.plays.filter((p: any) => p.kickoff_play === true || p.punt === true);
        const plain = kicks.filter((p: any) => playIcons(p).length === 0);
        expect(plain.length).toBeGreaterThan(0);
        for (const p of plain) expect(rowFor(p.game_play_number), `plain kick ${p.game_play_number}`).not.toContain('class="play-marks"');
        const returnTd = kicks.find((p: any) => p.touchdown === true);
        if (returnTd) expect(rowFor(returnTd.game_play_number)).toMatch(/<use href="#pi-td(-xp|-2pt)?(-miss)?">/);
    });

    test('exactly one h1 and a SportsEvent that parses', () => {
        expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
        const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        const ev = ld.find((o) => o['@type'] === 'SportsEvent');
        expect(ev?.url).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(ev?.homeTeam?.name).toBeTruthy();
    });
});
