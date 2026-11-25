/**
 * G16 ('non-garbage-stats') on the real 401729745 game page (ACU 31 at NDSU 51, 2024).
 *
 * The Overall box's run rows read the payload as served: NDSU ran 2 power plays and converted both (100%), ACU ran
 * none (a dash); the stop rate is the defense's, so NDSU's column holds ACU's stopped runs (6 of 27, 22%) and ACU's
 * holds NDSU's (14 of 29, 48%), as Def Run Stuff Rate already reads.
 *
 * This game is never a 21-point game (the widest margin is 20, in the fourth), so the processor serves no
 * advBoxScoreNonGarbage for it (python/span_box.py non_garbage_box) and the page shows no toggle. The toggle's own
 * test hands the page a non-garbage box: a copy of the game's box, since only the plumbing is under test there (the
 * box itself is python/tests/test_non_garbage_box.py's).
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { decodeEntities, parseTable, tableWithHeading } from './helpers/tables';

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
let game: any;
const render = async (preview: boolean, g = game) => {
    const { default: GamePage } = await import('../src/components/game/GamePage.astro');
    return container.renderToString(GamePage, {
        props: { id: GAME_ID, game: structuredClone(g) },
        locals: { league: 'cfb', preview } as any,
        request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
    });
};
/** the SituationalSection island's serialized props */
const islandProps = (html: string) => decodeEntities(html.match(/<astro-island[^>]+SituationalSection[^>]*props="([^"]*)"/)![1]);
const overall = (html: string) => parseTable(tableWithHeading(html, 'Overall')!).rows.map((r) => r.join(' | '));

beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30);
}, 60_000);

describe('the Overall box', () => {
    test('preview: Power Success Rate under EPA/Rush and Def Run Stop Rate under the stuff rate', async () => {
        const html = await render(true);
        const head = parseTable(tableWithHeading(html, 'Overall')!).rowHtml[0];
        expect(head.indexOf('team-logo-2000')).toBeLessThan(head.indexOf('team-logo-2449')); // ACU, then NDSU
        const rows = overall(html);
        const at = (label: string) => rows.findIndex((r) => r.startsWith(`${label} |`));
        expect(rows[at('Power Success Rate')]).toBe('Power Success Rate | — | 100%');
        expect(rows[at('Def Run Stop Rate')]).toBe('Def Run Stop Rate | 48% | 22%');
        expect(at('Power Success Rate')).toBe(at('EPA/Rush') + 1);
        expect(at('Def Run Stop Rate')).toBe(at('Def Run Stuff Rate') + 1);
    });

    test('flag off: neither row, and the island gets no new props', async () => {
        const html = await render(false);
        const rows = overall(html);
        expect(rows.some((r) => r.startsWith('Power Success Rate'))).toBe(false);
        expect(rows.some((r) => r.startsWith('Def Run Stop Rate'))).toBe(false);
        expect(islandProps(html)).not.toMatch(/runRows|nonGarbage/);
    });
});

describe('the All / Non-garbage toggle', () => {
    test('a game with no garbage time has no toggle', async () => {
        expect(game.advBoxScoreNonGarbage).toBeUndefined();
        const html = await render(true);
        expect(html).not.toContain('>Non-garbage<');
        expect(islandProps(html)).toContain('"nonGarbage":[0,null]');
    });

    test('with a non-garbage box: the toggle beside Show only, All pressed, the box in the props without usage sections', async () => {
        const withBox = { ...game, advBoxScoreNonGarbage: structuredClone(game.advBoxScore) };
        const html = await render(true, withBox);
        const toggle = html.slice(html.indexOf('aria-label="Plays counted"'), html.indexOf('>Non-garbage<') + 20);
        expect(toggle).toMatch(/aria-pressed="true"[^>]*>All</);
        expect(toggle).toMatch(/aria-pressed="false"[^>]*>Non-garbage</);
        expect(html.indexOf('id="span-stats"')).toBeLessThan(html.indexOf('aria-label="Plays counted"'));
        const props = islandProps(html);
        expect(props).toContain('"nonGarbage":[0,{');
        expect(props.slice(props.indexOf('"nonGarbage"'))).not.toContain('"player_usage"');
    });

    test('flag off: a payload with the box still renders no toggle', async () => {
        const html = await render(false, { ...game, advBoxScoreNonGarbage: structuredClone(game.advBoxScore) });
        expect(html).not.toContain('>Non-garbage<');
    });
});
