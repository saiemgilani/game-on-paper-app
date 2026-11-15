import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { METHOD_NOTES, seasonNote } from '../src/utils/methodNotes';

// IF-3: method notes on the advanced panels, behind 'method-notes'. The game page is the real finished
// game gamePage.render.test.ts renders (401729745), fed through the route's own retrieveProcessedGame.
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
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [], record: '0-0' }),
    retrieveMatchupHistory: async () => [],
    retrievePlayerSummaries: async () => [],
    retrieveTeamTendencies: async () => [],
    retrieveTeamOpponentSplits: async () => null,
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id: String(id), location: 'Alabama', color: '000000', alternateColor: 'ffffff' }),
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

const subtitle = (html: string) => html.match(/<p class="text-small text-muted"[^>]*>([^]*?)<\/p>/)![1].trim();

describe('GenericPanel hint', () => {
    const render = async (props: Record<string, unknown>) => {
        const { default: Panel } = await import('../src/layouts/panel/GenericPanel.astro');
        return container.renderToString(Panel, { props: { id: 'x', title: 'Team Stats', show: true, ...props } });
    };
    test('no hint: the title is plain text, exactly as without the prop', async () => {
        const html = await render({});
        expect(await render({ hint: undefined })).toBe(html);
        expect(html).not.toContain('<abbr');
        expect(html).toMatch(/<h2 class="d-inline">\s*Team Stats\s*<span/);
    });
    test('a hint wraps the title in an abbr', async () => {
        expect(await render({ hint: METHOD_NOTES.game })).toContain(`<abbr title="${METHOD_NOTES.game}">Team Stats</abbr>`);
    });
});

describe('season-team player tables', () => {
    const render = async (locals: Record<string, unknown>) => {
        const { default: Table } = await import('../src/components/team/tables/TeamPassingTable.astro');
        return container.renderToString(Table, { props: { players: [] }, locals: locals as any });
    };
    for (const league of ['cfb', 'nfl'] as const) {
        test(`[${league}] preview: the passing subtitle is the season note`, async () => {
            expect(subtitle(await render({ league, preview: true }))).toBe(seasonNote(league));
        }, 60_000);
    }
    test('public: the hand-typed pool sentence, unchanged', async () => {
        expect(subtitle(await render({ league: 'cfb' }))).toBe('Data shown is from FBS vs FBS games only.');
        expect(subtitle(await render({ league: 'nfl' }))).toBe('Data shown is from regular season games only.');
    }, 60_000);
});

describe('season team page Profile panel', () => {
    const credit = `(<a href="https://www.sbnation.com/college-football/2018/7/16/17532360/georgia-tech-football-2018-preview-schedule-roster">example</a>).`;
    const profile = async (league: 'cfb' | 'nfl', preview: boolean) => {
        const { default: Page } = await import(
            league === 'nfl' ? '../src/pages/nfl/year/[year]/team/[id].astro' : '../src/pages/year/[year]/team/[id].astro');
        const html = await container.renderToString(Page, {
            params: { year: '2025', id: '333' },
            request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/year/2025/team/333`),
            locals: (preview ? { preview: true } : {}) as App.Locals,
        });
        return html.split('id="radar-panel"')[1].match(/<p class="text-muted text-small m-0"[^>]*>([^]*?)<\/p>/)![1];
    };
    for (const league of ['cfb', 'nfl'] as const) {
        test(`[${league}] public: the credit sentence ends the subtitle, unchanged`, async () => {
            expect((await profile(league, false)).endsWith(credit)).toBe(true);
        }, 60_000);
        test(`[${league}] preview: the season note follows the credit sentence`, async () => {
            expect((await profile(league, true)).endsWith(`${credit} ${seasonNote(league)}`)).toBe(true);
        }, 60_000);
    }
});

describe('game page Team Stats', () => {
    let game: any;
    const render = async (locals: Record<string, unknown>) => {
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        return container.renderToString(GamePage, {
            props: { id: GAME_ID, game }, locals: locals as any,
            request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        });
    };
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        game = await retrieveProcessedGame(GAME_ID, 30);
    }, 60_000);

    test('preview: the title carries the game note as a hover', async () => {
        expect(await render({ preview: true })).toContain(
            '<abbr title="Every play, garbage time included. Not adjusted for opponent.">Team Stats</abbr>');
    }, 60_000);
    test('public: no note', async () => {
        const html = await render({});
        expect(html).not.toContain(METHOD_NOTES.game);
        expect(html).toMatch(/<h2 class="d-inline">\s*Team Stats\s*<span/);
    }, 60_000);
});
