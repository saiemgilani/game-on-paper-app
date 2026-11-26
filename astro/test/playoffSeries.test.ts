// BB-G59: /<league>/series and /<league>/series/<id>, behind 'bball-series'. Real data only (fixtures/README.md:
// playoff-series-2025.json.gz, sdv-py BB-D43's playoff_series_games for the 2024-25 NBA and 2025 WNBA postseasons, with the
// _teams / _players rows of both Finals). The pages read only those three tables, and every number is a producer column.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/playoff-series-2025.json.gz', import.meta.url))).toString());
const TABLE: Record<string, string> = { playoff_series_games: 'games', playoff_series_teams: 'teams', playoff_series_players: 'players' };
const calls: [string, string, Record<string, string>][] = [];
const read = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/resources/sdv', () => ({
    retrieveRowsFrom: async (source: { schema: string }, table: string, q: Record<string, string>) => {
        calls.push([source.schema, table, q]);
        if (read.fail) throw new Error('503');
        const rows: any[] = FIX[source.schema]?.[TABLE[table]] ?? [];
        return rows.filter((r) => String(r.season) === q.season && (!q.series_id || r.series_id === q.series_id))
            .sort((x, y) => (q.order === 'game_number' ? x.game_number - y.game_number : 0));
    },
    retrieveRows: async () => { throw new Error('unexpected read'); },
}));

import { parseSeriesId, prepareSeries, seriesIndex, seriesStatus, seriesSide } from '../src/routes/basketball/series';
import { FLAGS } from '../src/utils/features';
import { bballOnly } from './helpers/flags';

const on = () => ({ preview: true, flagOverrides: bballOnly('bball-series') });
const FINALS = '2025-11-25';
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = async (league: 'nba' | 'wnba', path: string, locals: Record<string, unknown> = on()) => {
    const page = path.startsWith('/series/') ? '[id]' : 'index';
    const { default: Page } = await import(/* @vite-ignore */ `../src/pages/${league}/series/${page}.astro`);
    const url = new URL(`https://gameonpaper.com/${league}${path}`);
    return container.renderToString(Page, { request: new Request(url), params: page === '[id]' ? { id: url.pathname.split('/').pop()! } : {}, locals: locals as unknown as App.Locals });
};
const prep = (league: 'nba' | 'wnba', id: string, locals: Record<string, unknown> = on(), query = '') => {
    const astro: any = { locals, params: { id }, url: new URL(`https://gameonpaper.com/${league}/series/${id}${query}`), response: { headers: new Headers() }, cache: { set: vi.fn() } };
    return prepareSeries(astro, league);
};
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const after = (html: string, marker: string) => html.split(`${marker}>`)[1]?.split('</tr>')[0] ?? '';

describe('the id', () => {
    test('is the producer key: season, then the lower and the higher ESPN team id', () => {
        expect(parseSeriesId(FINALS)).toEqual({ season: 2025, id: FINALS });
        expect(parseSeriesId('2025-25-11')).toBeNull(); // the higher id first is not a key
        expect(parseSeriesId('2025-11')).toBeNull();
        expect(parseSeriesId(undefined)).toBeNull();
    });
});

describe("'bball-series'", () => {
    test('is a preview flag; off, both routes are the 404 with no read', async () => {
        expect(FLAGS['bball-series']).toBe('preview');
        calls.length = 0;
        expect(await prep('nba', FINALS, { preview: false })).toEqual({ notFound: true });
        expect(calls).toEqual([]);
    });
    test('reads the three series tables from the ESPN game schema, nothing else', async () => {
        calls.length = 0;
        const r = await prep('nba', FINALS);
        expect('games' in r && r.games).toHaveLength(7);
        expect(calls.map(([s, t, q]) => [s, t, q.series_id]).sort()).toEqual([
            ['nba', 'playoff_series_games', FINALS], ['nba', 'playoff_series_players', FINALS], ['nba', 'playoff_series_teams', FINALS],
        ]);
    });
    test('an id with no rows is the 404; a failed read is the 503', async () => {
        expect(await prep('nba', '2025-1-2')).toEqual({ notFound: true });
        read.fail = true;
        try { expect(await prep('nba', FINALS)).toEqual({ unavailable: true }); } finally { read.fail = false; }
    });
});

describe('the series headline', () => {
    test("follows the producer's series score after the latest game", () => {
        const games = FIX.nba.games.filter((g: any) => g.series_id === FINALS).sort((x: any, y: any) => x.game_number - y.game_number);
        const [a, b] = [seriesSide(games, games[0].team_a_id), seriesSide(games, games[0].team_b_id)];
        expect([a.abbreviation, b.abbreviation]).toEqual(['OKC', 'IND']);
        expect(seriesStatus(games[6], a, b)).toBe('OKC wins 4-3');
        // the headline reads the series' latest row; mid-series (game 5 the latest) the producer has not decided it
        expect(seriesStatus({ ...games[4], decided: false, series_winner_team_id: null }, a, b)).toBe('OKC leads 3-2');
        expect(seriesStatus(games[1], a, b)).toBe('Tied 1-1');
    });
});

describe('the pages', () => {
    test('the series page: the strip is the producer rows, the totals and lines its columns', async () => {
        const html = await render('nba', `/series/${FINALS}`);
        const games = FIX.nba.games.filter((g: any) => g.series_id === FINALS);
        expect(html.match(/data-series-game="/g)).toHaveLength(7);
        expect(html).toContain('href="/nba/game/' + games[0].game_id + '"');
        expect(text(html.split('data-series-status>')[1].split('</p>')[0])).toBe('OKC wins 4-3');
        const okc = FIX.nba.teams.find((t: any) => t.team_id === 25);
        expect(text(after(html, 'data-series-team="25"'))).toBe(`OKC ${okc.wins} ${okc.pts} ${okc.opp_pts} ${okc.fgm} ${okc.fga} ${okc.fg3m} ${okc.fg3a} ${okc.ftm} ${okc.fta} ${okc.reb} ${okc.ast} ${okc.stl} ${okc.blk} ${okc.tov}`);
        const top = FIX.nba.players[0];
        const line = text(after(html, `data-series-player="${top.athlete_id}"`));
        expect(line).toBe(`${top.athlete_display_name} ${top.games} ${[top.min_pg, top.pts_pg, top.reb_pg, top.ast_pg, top.stl_pg, top.blk_pg, top.tov_pg, top.fg3m_pg].map((v: number) => v.toFixed(1)).join(' ')} ${(top.ts_pct * 100).toFixed(1)}%`);
        const shift = text(after(html, `data-series-shift-player="${top.athlete_id}"`));
        const sign = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
        expect(shift.startsWith(`${top.athlete_display_name} ${top.reg_games} ${top.reg_min_pg.toFixed(1)} ${sign(top.min_pg_diff)} ${top.reg_pts_pg.toFixed(1)} ${sign(top.pts_pg_diff)}`)).toBe(true);
        // every team's players, and only the series' (both Finals teams)
        expect(new Set([...html.matchAll(/data-series-players="(\d+)"/g)].map((m) => m[1]))).toEqual(new Set(['25', '11']));
    });
    test('?spoilers=off keeps the result out of the head, not the body', async () => {
        const full = await render('nba', `/series/${FINALS}`);
        const safe = await render('nba', `/series/${FINALS}?spoilers=off`);
        const head = (h: string) => h.split('</head>')[0];
        expect(head(full)).toContain('OKC wins 4-3');
        expect(head(safe)).not.toContain('wins 4-3');
        expect(head(safe)).toContain('NBA Finals');
        expect(safe).toContain('data-series-status>OKC wins 4-3');
    });
    test('the WNBA Finals sweep', async () => {
        const html = await render('wnba', '/series/2025-11-17');
        expect(html.match(/data-series-game="/g)).toHaveLength(4);
        expect(text(html.split('data-series-status>')[1].split('</p>')[0])).toBe('LV wins 4-0');
    });
    test('the season index: the latest round first, one link per series', async () => {
        const rounds = seriesIndex(FIX.nba.games);
        expect(rounds.map((r) => [r.round, r.series.length])).toEqual([[4, 1], [3, 2], [2, 4], [1, 8]]);
        const html = await render('nba', '/series?season=2025');
        expect(html.match(/data-series-link="/g)).toHaveLength(15);
        expect(html).toContain(`href="/nba/series/${FINALS}"`);
        expect(html.indexOf('data-series-round="4"')).toBeLessThan(html.indexOf('data-series-round="1"'));
    });
    test('the bare index falls back to the last season with series while the current one has none', async () => {
        calls.length = 0;
        const html = await render('wnba', '/series');
        expect(html.match(/data-series-link="/g)).toHaveLength(7);
        expect(calls.map(([, , q]) => q.season)).toEqual(['2026', '2025']);
    });
});
