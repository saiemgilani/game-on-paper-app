// BB-G59: the playoff series card (basketball/seriesCard.ts, routes/basketball/seriesCard.ts) on the real 2025 NBA and
// WNBA Finals rows (fixtures/playoff-series-2025.json.gz). The body is strings from the producer's rows; the spoiler-free
// variant is the page's ?spoilers=off.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/playoff-series-2025.json.gz', import.meta.url))).toString());
const TABLE: Record<string, string> = { playoff_series_games: 'games', playoff_series_teams: 'teams', playoff_series_players: 'players' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const up = vi.hoisted(() => ({ card: vi.fn(), fail: false }));
vi.mock('../src/resources/sdv', () => ({
    retrieveRowsFrom: async (source: { schema: string }, table: string, q: Record<string, string>) => {
        if (up.fail) throw new Error('503');
        const rows: any[] = FIX[source.schema]?.[TABLE[table]] ?? [];
        return rows.filter((r) => String(r.season) === q.season && r.series_id === q.series_id).sort((x, y) => x.game_number - y.game_number);
    },
    retrieveRows: async () => { throw new Error('unexpected read'); },
}));
vi.mock('../src/resources/python', async (orig) => ({
    ...(await orig<typeof import('../src/resources/python')>()),
    retrieveBasketballSeriesCard: (...a: unknown[]) => up.card(...a),
}));

import { seriesCardBody, seriesShareImage } from '../src/basketball/seriesCard';
import { bballOnly } from './helpers/flags';

const FINALS = '2025-11-25';
const games = (lg: string, id: string) => FIX[lg].games.filter((g: any) => g.series_id === id).sort((x: any, y: any) => x.game_number - y.game_number);

describe('the card body', () => {
    test('the 2025 NBA Finals: the round, the matchup with home court first, the status and all seven games', () => {
        const body = seriesCardBody('nba', games('nba', FINALS));
        expect(body.stamp).toBe('2024-25 NBA Finals');
        expect([body.a.id, body.a.abbr, body.b.abbr]).toEqual([25, 'OKC', 'IND']);
        expect(body.status).toBe('OKC wins 4-3');
        expect(body.games.map((g) => g.label)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
        // each game's scores are the producer's, oriented to the two sides, and the winner is the producer's
        for (const [i, g] of games('nba', FINALS).entries()) {
            const aHome = g.home_team_id === 25;
            expect([body.games[i].a, body.games[i].b]).toEqual(aHome ? [g.home_score, g.away_score] : [g.away_score, g.home_score]);
            expect(body.games[i].winner).toBe(g.winner_team_id === 25 ? 'a' : 'b');
        }
        expect(body.games.filter((g) => g.winner === 'a')).toHaveLength(4);
        expect(body.a.logo).toMatch(/^https:\/\//);
    });
    test('the image URL: the full card carries the games played, the spoiler-free one nothing about the series', () => {
        const full = seriesShareImage('nba', FINALS, games('nba', FINALS), false);
        expect(full.url).toBe(`https://gameonpaper.com/nba/series/${FINALS}/card.png?variant=full&v=7`);
        expect(full.alt).toContain('OKC wins 4-3');
        const safe = seriesShareImage('nba', FINALS, games('nba', FINALS), true);
        expect(safe.url).toBe(`https://gameonpaper.com/nba/series/${FINALS}/card.png?variant=spoilerfree`);
        expect(safe.alt).toMatch(/series score hidden$/);
        expect(safe.alt).not.toMatch(/wins|leads|Tied/);
    });
});

describe('the card route', () => {
    beforeEach(() => { up.card.mockReset(); up.fail = false; });
    async function get(league: 'nba' | 'wnba', id: string, query = '') {
        const { basketballSeriesCardRoute } = await import('../src/routes/basketball/seriesCard');
        const set = vi.fn();
        const res = await basketballSeriesCardRoute(league)({ params: { id }, url: new URL(`https://gameonpaper.com/${league}/series/${id}/card.png${query}`), cache: { set } } as any);
        return { res, set };
    }
    test('draws the body of the series page rows, held a day once decided', async () => {
        up.card.mockResolvedValue(PNG.buffer);
        const { res, set } = await get('nba', FINALS, '?variant=spoilerfree');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/png');
        expect(set).toHaveBeenCalledWith({ maxAge: 86400, tags: ['nba', 'share-card'] });
        const [league, id, variant, body] = up.card.mock.calls[0];
        expect([league, id, variant]).toEqual(['nba', FINALS, 'spoilerfree']);
        // the spoiler-free card is sent no series score and no game
        expect(body).toEqual({ ...seriesCardBody('nba', games('nba', FINALS)), status: '', games: [] });
        await get('nba', FINALS, '?variant=full');
        expect(up.card.mock.calls[1][3]).toEqual(seriesCardBody('nba', games('nba', FINALS)));
    });
    test('a spoiler-free card of a series in progress is held a day; the full card ten minutes', async () => {
        const live = games('nba', FINALS).slice(0, 5).map((g) => ({ ...g, decided: false }));
        expect(live.length).toBe(5);
        const { seriesCardMaxAge } = await import('../src/routes/basketball/seriesCard');
        expect(seriesCardMaxAge('spoilerfree', live)).toBe(86400);
        expect(seriesCardMaxAge('full', live)).toBe(600);
    });
    test('the WNBA Finals sweep', async () => {
        up.card.mockResolvedValue(PNG.buffer);
        expect((await get('wnba', '2025-11-17')).res.status).toBe(200);
        expect(up.card.mock.calls[0][3].status).toBe('LV wins 4-0');
    });
    test('a bad id or variant is a 400, an unknown series a 404, a failed read or draw a 502', async () => {
        expect((await get('nba', '2025-25-11')).res.status).toBe(400);
        expect((await get('nba', FINALS, '?variant=blurred')).res.status).toBe(400);
        expect((await get('nba', '2025-1-2')).res.status).toBe(404);
        up.card.mockResolvedValue(null);
        expect((await get('nba', FINALS)).res.status).toBe(502);
        up.fail = true;
        expect((await get('nba', FINALS)).res.status).toBe(502);
    });
});

describe('the series page under bball-share-card', () => {
    let container: AstroContainer;
    beforeEach(() => { up.fail = false; });
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = async (query: string, share: boolean) => {
        const { default: Page } = await import('../src/pages/nba/series/[id].astro');
        const locals = { preview: true, flagOverrides: { ...bballOnly('bball-series', ...(share ? ['bball-share-card'] : [])) } };
        return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/nba/series/${FINALS}${query}`), params: { id: FINALS }, locals: locals as any });
    };
    test("the card is the og:image, the spoiler-free one with ?spoilers=off; off, the site's card", async () => {
        expect(await render('', true)).toContain(`<meta property="og:image" content="https://gameonpaper.com/nba/series/${FINALS}/card.png?variant=full&amp;v=7">`);
        expect(await render('?spoilers=off', true)).toContain(`<meta property="og:image" content="https://gameonpaper.com/nba/series/${FINALS}/card.png?variant=spoilerfree">`);
        expect(await render('', false)).toContain('<meta property="og:image" content="https://gameonpaper.com/assets/img/social-card.png">');
    });
});
