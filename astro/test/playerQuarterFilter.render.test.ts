/**
 * G9: with 'player-quarter-filter' on, each team's player section on the v2
 * game page carries the Team Stats "Show only" select, and every window is
 * pre-rendered from that window's advBoxScoreSpans box. Off, the section is
 * what it was. Real `usage-*` fixtures through the route's own
 * retrieveProcessedGame, both leagues.
 */
import { gzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { parseSpan } from '../src/utils/span';
import { loadGzJson } from './helpers/tables';

const FIXTURES = {
    cfb: { file: 'usage-cfb-400869270.json.gz', id: 400869270 },
    nfl: { file: 'usage-nfl-401872922.json.gz', id: 401872922 },
} as const;
type Lg = keyof typeof FIXTURES;

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const m = String(url).match(/\/(cfb|nfl)\/(\d+)\/process/);
        if (!m) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(JSON.stringify(loadGzJson(FIXTURES[m[1] as Lg].file)), { status: 200, headers: { 'content-type': 'application/json' } });
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

async function render(league: Lg, flag: 'on' | 'off') {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const game: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
    const { default: GamePage } = await import('../src/components/game/GamePage.astro');
    const html = await container.renderToString(GamePage, {
        props: { id: FIXTURES[league].id, game, league },
        request: new Request(`https://gameonpaper.com/game/${FIXTURES[league].id}`),
        locals: { league, flagOverrides: { 'player-quarter-filter': flag === 'on' } } as any,
    });
    return { game, html };
}

/** The markup of one team panel, up to the next panel. */
const panel = (html: string, id: string) => {
    const at = html.indexOf(`id="${id}"`);
    expect(at, id).toBeGreaterThan(0);
    const next = id === 'away-stats-panel' ? 'id="home-stats-panel"' : 'id="big-plays';
    return html.slice(at, html.indexOf(next, at));
};

describe('player sections: quarter filter', () => {
    for (const league of Object.keys(FIXTURES) as Lg[]) {
        test(`[${league}] each player section gets the Team Stats select and one window per span`, async () => {
            const { game, html } = await render(league, 'on');
            const keys = ['all', ...Object.keys(game.advBoxScoreSpans).map(parseSpan).filter((s) => !!s).map((s) => s!.key)];
            expect(keys.length, 'the fixture has quarter windows').toBeGreaterThan(4);
            for (const [panelId, team] of [['away-stats-panel', game.teamInfo.away], ['home-stats-panel', game.teamInfo.home]] as const) {
                const body = panel(html, panelId);
                // the select is the Team Stats one: label, classes, Game first, same order
                expect(body).toContain(`<label class="text-small text-muted" for="span-players-${team.id}">Show only</label>`);
                expect(body).toMatch(/<select[^>]*class="form-select form-select-sm"/);
                const options = [...body.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
                expect(options).toEqual(keys);
                const windows = [...body.matchAll(/<div class="row" data-player-span="([^"]+)"( hidden)?>/g)];
                expect(windows.map((m) => m[1])).toEqual(keys);
                expect(windows.filter((m) => !m[2]).map((m) => m[1]), 'only Game is visible').toEqual(['all']);
            }
            expect(html).toMatch(/<script[^>]*PlayerSpanSelect\.astro/);
        }, 60_000);

        test(`[${league}] a quarter window shows that quarter's box, not the game's`, async () => {
            const { game, html } = await render(league, 'on');
            const home = String(game.teamInfo.home.id);
            const body = panel(html, 'home-stats-panel');
            const win = (key: string) => {
                const at = body.indexOf(`data-player-span="${key}"`);
                const next = body.indexOf('data-player-span="', at + 20);
                return body.slice(at, next < 0 ? undefined : next);
            };
            // a rusher whose Q1 carries differ from his game total
            const q1 = game.advBoxScoreSpans.q1.rush.filter((r: any) => String(r.pos_team) === home && r.rusher_player_name);
            const full = game.advBoxScore.rush.filter((r: any) => String(r.pos_team) === home);
            const pick = q1.find((r: any) => full.find((f: any) => f.rusher_player_name === r.rusher_player_name)?.Car !== r.Car);
            expect(pick, 'the fixture has a rusher whose Q1 differs').toBeTruthy();
            const total = full.find((f: any) => f.rusher_player_name === pick.rusher_player_name);
            // every rushing row of his in the window: the name row, then its "N car" stat line
            const carries = (w: string) => [...w.matchAll(new RegExp(
                `${pick.rusher_player_name}(?:</a>)?</td>(?:<td class="numeral"[^>]*>[^<]*</td>){5}</tr><tr class="stat-line-row"><td colspan="6" class="text-muted">(\\d+) car`, 'g'))].map((m) => m[1]);
            // exactly one row each: the quarter's line, and no game-total row beside it
            expect(carries(win('q1'))).toEqual([String(pick.Car)]);
            expect(carries(win('all'))).toEqual([String(total.Car)]);
        }, 60_000);

        test(`[${league}] flag off: no select, one unmarked section per team`, async () => {
            const { html } = await render(league, 'off');
            expect(html).not.toContain('data-player-span');
            // nor the select's script: a component's <script> ships wherever the component renders
            expect(html).not.toMatch(/<script[^>]*(TeamPlayerStats|PlayerSpanSelect)\.astro/);
            for (const id of ['away-stats-panel', 'home-stats-panel']) {
                expect(panel(html, id)).toMatch(/<div class="panel-body">\s*<div class="row">/);
            }
        }, 60_000);
    }

    test('page weight: the gzip delta of the pre-rendered windows', async () => {
        for (const league of Object.keys(FIXTURES) as Lg[]) {
            const on = gzipSync((await render(league, 'on')).html).length;
            const off = gzipSync((await render(league, 'off')).html).length;
            console.log(`[${league}] gzip HTML: off ${off} B, on ${on} B, delta +${on - off} B`);
            expect(on - off).toBeLessThan(60_000);
        }
    }, 120_000);
});
