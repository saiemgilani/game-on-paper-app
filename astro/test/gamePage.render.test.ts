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

    test('stat lines carry the longest gain and the best single play', () => {
        // Extremes come off the plays, so they work on any game, old text or new.
        expect(html).toMatch(/\d+ LNG, -?\d+\.\d+ best EPA, -?\d+\.\d+% best WPA/);
    });

    test('the Latest strip leads the page, newest play first', () => {
        expect(html).toContain('id="latest"');
        // it must sit above the win probability chart, which was the old first panel
        expect(html.indexOf('id="latest"')).toBeLessThan(html.indexOf('id="wpChart"'));
        expect(html).toMatch(/Final\. Last drive: [^<]+, [^<]+\./);
    });

    test('the book rows render with their EPA beside them', () => {
        for (const label of ['Third down', 'Fourth down', 'Red zone scoring', 'Turnovers', 'Sacks taken', 'Time of possession']) {
            expect(html).toContain(`>${label}<`);
        }
        expect(html).toMatch(/\d+-\d+ \(\d+%\)/);
        expect(html).toMatch(/-?\d+\.\d\d EPA/);
        // the clock lives in the possession row itself, not just anywhere on the page
        expect(html).toMatch(/Time of possession<\/td>[\s\S]{0,600}?\d+:\d\d/);
    });

    test('a game whose text names no tacklers shows no defensive box', () => {
        // 401729745 predates ESPN's LiveStats tackler parentheticals; the section
        // has to disappear rather than render an empty table.
        expect(html).not.toContain('>Defense<');
    });

    test('All Plays offers a quarter filter, and the markup its script needs is there', () => {
        // The filter script finds rows by these hooks. If PlayRow or PlaysTable
        // stops emitting them the buttons silently do nothing, so pin the contract.
        expect(html).toContain('data-plays-body="all"');
        expect(html).toContain('data-play-filters="all"');
        expect(html).toMatch(/data-period-filter="all"/);
        for (const q of [1, 2, 3, 4]) expect(html).toContain(`data-period-filter="${q}"`);
        // no overtime in this game, so no overtime button
        expect(html).not.toContain('data-period-filter="5"');
        expect(html).toContain('data-order-toggle');

        // Every play row carries its period, and a detail row always follows its
        // summary -- that adjacency is what keeps the two moving together.
        const rows = [...html.matchAll(/<tr ([^>]*data-play-row[^>]*)>/g)].map((m) => m[1]);
        expect(rows.length).toBeGreaterThan(100);
        expect(rows.every((r) => /data-period="\d+"/.test(r))).toBe(true);
        const isDetail = rows.map((r) => r.includes('accordion-body'));
        // details never lead, and never follow another detail
        expect(isDetail[0]).toBe(false);
        for (let i = 1; i < isDetail.length; i++) if (isDetail[i]) expect(isDetail[i - 1]).toBe(false);
    });

    test('every nav link points at an anchor that exists', () => {
        // #wpChart, #epChart and #most-imp-plays were all dead: the nav offered
        // them and nothing on the page carried the id.
        const hrefs = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
        expect(hrefs.length).toBeGreaterThan(5);
        for (const anchor of new Set(hrefs)) {
            expect(html, `nav points at #${anchor} but no element has that id`).toContain(`id="${anchor}"`);
        }
    });

    test('exactly one h1 and a SportsEvent that parses', () => {
        expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
        const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        const ev = ld.find((o) => o['@type'] === 'SportsEvent');
        expect(ev?.url).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(ev?.homeTeam?.name).toBeTruthy();
    });
});

describe('PlayerBoxScore builds a defensive box from 2025 play text', () => {
    test('the tacklers ESPN names become rows', async () => {
        const play = (text: string, extra = {}) => ({ text, pos_team: 2, def_pos_team: 1, ...extra });
        const { default: PlayerBoxScore } = await import('../src/components/game/metrics/PlayerBoxScore.astro');
        const html = await container.renderToString(PlayerBoxScore, {
            props: {
                pass: [],
                rush: [{ rusher_player_name: 'J.Payne', Car: 2, Yds: 9, Rush_TD: 0, Fum: 0, Fum_Lost: 0, YPC: 4.5, EPA: 0.3, EPA_per_Play: 0.15, SR: 0.5, WPA: 0.004 }],
                receiver: [],
                teamId: 1,
                plays: [
                    play('#26 J.Payne rush middle for 11 yards gain to the FSU42 (#16 G.Peterson; #8 B.Vislisel)', { rusher_player_name: 'J.Payne', yds_rushed: 11, EPA: 0.8, wpa: 0.012 }),
                    play('#26 J.Payne rush left for 2 yards loss to the FSU40 (#16 G.Peterson)', { rusher_player_name: 'J.Payne', yds_rushed: -2, EPA: -0.5, wpa: -0.008 }),
                    play('#3 T.Hedden pass incomplete short right broken up by #13 D.Diggs'),
                ],
            },
        });
        expect(html).toContain('>Defense<');
        expect(html).toContain('G.Peterson');
        expect(html).toContain('2 tackles (1 solo, 1 ast), 1 TFL');
        expect(html).toContain('1 PBU');
        // the rusher's stat line picks up his longest carry and his best play
        expect(html).toContain('11 LNG, 0.80 best EPA, 1.2% best WPA');
    });
});
