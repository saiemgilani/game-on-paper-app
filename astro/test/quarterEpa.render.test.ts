/**
 * G18 ('quarter-epa'): the EPA linescore on the real 401729745 game page (ACU 31 at NDSU 51, 2024).
 *
 * Its totals are the Team Stats "Expected Points" Total row (advBoxScore.team EPA_overall_total: NDSU 11.82, ACU
 * -17.03), split by quarter. The game's net EPA, 28.9, is 8.9 points from the 20-point margin, inside the gate.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { tableWithHeading, parseTable } from './helpers/tables';
import { EPA_MARGIN_TOLERANCE, quarterEpa } from '../src/utils/quarterEpa';

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
const MARGIN = 31 - 51; // away minus home
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

beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    const { retrieveProcessedGame } = await import('../src/resources/python');
    game = await retrieveProcessedGame(GAME_ID, 30);
}, 60_000);

describe('quarterEpa', () => {
    test('totals are the Team Stats Expected Points Total row, split by quarter', () => {
        const rows = quarterEpa(game.plays, [ACU, NDSU], MARGIN)!;
        const box = (id: string) => game.advBoxScore.team.find((t: any) => String(t.pos_team) === id).EPA_overall_total;
        expect(rows.map((r) => r.teamId)).toEqual([ACU, NDSU]);
        expect(rows[0].total).toBeCloseTo(box(ACU), 2);
        expect(rows[1].total).toBeCloseTo(box(NDSU), 2);
        for (const r of rows) expect(r.byPeriod.reduce((a, b) => a + b, 0)).toBeCloseTo(r.total, 9);
    });

    test('the gate: a margin more than two touchdowns from the net EPA, or a snap without EPA, gets no rows', () => {
        const net = 28.85; // NDSU 11.82 - ACU -17.03, home minus away
        expect(quarterEpa(game.plays, [ACU, NDSU], -net + EPA_MARGIN_TOLERANCE - 0.1)).not.toBeNull();
        expect(quarterEpa(game.plays, [ACU, NDSU], -net + EPA_MARGIN_TOLERANCE + 0.1)).toBeNull();
        const i = game.plays.findIndex((p: any) => p.scrimmage_play == true);
        const holed = game.plays.map((p: any, j: number) => (j === i ? { ...p, expectedPoints: { ...p.expectedPoints, added: null } } : p));
        expect(quarterEpa(holed, [ACU, NDSU], MARGIN)).toBeNull();
        expect(quarterEpa([], [ACU, NDSU], MARGIN)).toBeNull();
    });
});

describe('the Scoring Plays panel', () => {
    test('preview: the EPA linescore under the linescore, away first, one number per cell', async () => {
        const html = await render(true);
        const table = tableWithHeading(html, 'EPA');
        expect(table).not.toBeNull();
        const t = parseTable(table!);
        expect(t.headers).toEqual(['EPA', '1', '2', '3', '4', 'T']);
        expect(t.rows.slice(1)).toEqual([
            ['ACU', '12.8', '-13.1', '-2.7', '-14.1', '-17.0'],
            ['NDSU', '0.9', '4.5', '11.1', '-4.7', '11.8'],
        ]);
        const panel = html.slice(html.indexOf('id="scoring-plays-panel"'));
        expect(panel.indexOf('>Linescore<')).toBeLessThan(panel.indexOf('>EPA<'));
    });

    test('flag off, or a live game: no table', async () => {
        expect(tableWithHeading(await render(false), 'EPA')).toBeNull();
        const live = structuredClone(game);
        live.header.competitions[0].status.type.completed = false;
        expect(tableWithHeading(await render(true, live), 'EPA')).toBeNull();
    });
});
