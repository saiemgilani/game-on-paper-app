/**
 * G17 ('decision-summary'): the Fourth Down Decisions panel on the real 401729745 game page (ACU at NDSU, 2024).
 *
 * The expected rows were read off the fixture's play rows by hand, one Fourth Down Bot card at a time:
 *   NDSU: 8 graded fourth downs with a readable choice (a ninth, a penalty-only row, has none), 4 agreed; went
 *         for it on none of the 4 the bot wanted to go on -- two punts (45.1% vs 43.7%, 26.8% vs 24.5%) and two
 *         field goals (66.75% vs 66.75%, 99.06% vs 98.57%) -- 4.3 points of WP.
 *   ACU:  7 graded, 4 agreed; a punt where the bot said go (70.6% vs 69.3%), a run where it said punt (39.2% vs
 *         35.5%) and a late pass where it said punt (0.088% vs 0.085%) -- 5.0 points.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { parseTable } from './helpers/tables';
import { fourthDownSummary } from '../src/utils/fourthDown';

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

const NDSU = '2449', ACU = '2000';
let container: AstroContainer;
let game: any;
const render = async (preview: boolean) => {
    const { default: GamePage } = await import('../src/components/game/GamePage.astro');
    return container.renderToString(GamePage, {
        props: { id: GAME_ID, game: structuredClone(game) },
        locals: { league: 'cfb', preview } as any,
        request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
    });
};

beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30);
}, 60_000);

describe('fourthDownSummary', () => {
    test('sums the bot cards per offense, in the order asked', () => {
        const [acu, ndsu] = fourthDownSummary(game.plays, [ACU, NDSU]);
        expect([acu.teamId, acu.decisions, acu.agreed]).toEqual([ACU, 7, 4]);
        expect([ndsu.teamId, ndsu.decisions, ndsu.agreed]).toEqual([NDSU, 8, 4]);
        expect(acu.wpLost).toBeCloseTo(0.0501, 3);
        expect(ndsu.wpLost).toBeCloseTo(0.0428, 3);
    });

    test('a team with no graded fourth down is a zero row, and an unknown team is no row', () => {
        expect(fourthDownSummary([], [ACU])).toEqual([{ teamId: ACU, decisions: 0, agreed: 0, wpLost: 0 }]);
        const other = game.plays.map((p: any) => ({ ...p, start: { ...p.start, pos_team: { id: 1 } } }));
        expect(fourthDownSummary(other, [ACU, NDSU]).every((r) => r.decisions === 0)).toBe(true);
    });
});

describe('the game page panel', () => {
    test('preview: one row per team, away first, one number per cell', async () => {
        const html = await render(true);
        const panel = html.slice(html.indexOf('id="decision-summary-panel"'));
        expect(panel.length).toBeLessThan(html.length);
        const t = parseTable(panel);
        expect(t.headers).toEqual(['Team', 'Decisions', 'Agreed', 'WP Lost']);
        const body = t.rows.slice(1);
        expect(body).toEqual([['ACU', '7', '4', '5.0%'], ['NDSU', '8', '4', '4.3%']]);
        expect(t.rowHtml[1]).toContain(`team-logo-${ACU}`);
        expect(html).toContain('href="#decision-summary-panel"');
    });

    test('flag off: no panel and no nav entry', async () => {
        const html = await render(false);
        expect(html).not.toContain('decision-summary-panel');
        expect(html).not.toContain('Fourth Down Decisions');
    });
});
