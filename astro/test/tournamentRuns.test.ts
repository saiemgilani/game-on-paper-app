// BB-G59 (college): /<league>/tournaments and /<league>/tournaments/<run_id>, behind 'bball-series'. Real data only
// (fixtures/README.md: tournament-runs-2025.json.gz, sdv-py BB-D43's tournament_run_games for the 2024-25 men's and
// women's seasons, with the _teams / _players rows of both NCAA champions' runs). Every number is a producer column.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const FIX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/tournament-runs-2025.json.gz', import.meta.url))).toString());
const TABLE: Record<string, string> = { tournament_run_games: 'games', tournament_run_teams: 'teams', tournament_run_players: 'players' };
const calls: [string, string, Record<string, string>][] = [];
const read = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/resources/sdv', () => ({
    retrieveRowsFrom: async (source: { schema: string }, table: string, q: Record<string, string>) => {
        calls.push([source.schema, table, q]);
        if (read.fail) throw new Error('503');
        const rows: any[] = FIX[source.schema]?.[TABLE[table]] ?? [];
        const kept = rows.filter((r) => String(r.season) === q.season && (!q.run_id || r.run_id === q.run_id));
        const [desc, col] = q.order?.startsWith('-') ? [true, q.order.slice(1)] : [false, q.order];
        return col ? [...kept].sort((x, y) => (desc ? y[col] - x[col] : x[col] - y[col])) : kept;
    },
    retrieveRows: async () => { throw new Error('unexpected read'); },
}));

import { parseRunId, prepareRun, prepareRunsIndex, tournaments } from '../src/routes/basketball/runs';
import { bballOnly } from './helpers/flags';

const on = () => ({ preview: true, flagOverrides: bballOnly('bball-series') });
const FLORIDA = '2025-22-57';
const UCONN = '2025-22-41';
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = async (league: 'mbb' | 'wbb', path: string, locals: Record<string, unknown> = on()) => {
    const page = path.startsWith('/tournaments/') ? '[id]' : 'index';
    const { default: Page } = await import(/* @vite-ignore */ `../src/pages/${league}/tournaments/${page}.astro`);
    const url = new URL(`https://gameonpaper.com/${league}${path}`);
    return container.renderToString(Page, { request: new Request(url), params: page === '[id]' ? { id: url.pathname.split('/').pop()! } : {}, locals: locals as unknown as App.Locals });
};
const astroFor = (url: string, locals: Record<string, unknown>, params: Record<string, string> = {}): any =>
    ({ locals, params, url: new URL(url), response: { headers: new Headers() }, cache: { set: vi.fn() } });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const after = (html: string, marker: string) => html.split(`${marker}>`)[1]?.split('</tr>')[0] ?? '';

describe('the id', () => {
    test("is the producer key: season, tournament key (ESPN's id or an event-name slug), ESPN team id", () => {
        expect(parseRunId(FLORIDA)).toEqual({ season: 2025, id: FLORIDA });
        expect(parseRunId('2016-cbi-2390')).toEqual({ season: 2016, id: '2016-cbi-2390' });
        expect(parseRunId('2025-22')).toBeNull();
        expect(parseRunId('2025-NIT-57')).toBeNull();
    });
});

describe("'bball-series' for college", () => {
    test('off, both routes are the 404 with no read; the header has no Tournaments link', async () => {
        calls.length = 0;
        expect(await prepareRun(astroFor(`https://gameonpaper.com/mbb/tournaments/${FLORIDA}`, { preview: false }, { id: FLORIDA }), 'mbb')).toEqual({ notFound: true });
        expect(await prepareRunsIndex(astroFor('https://gameonpaper.com/mbb/tournaments?season=2025', { preview: false }), 'mbb')).toEqual({ notFound: true });
        expect(calls).toEqual([]);
        const { default: Header } = await import('../src/components/Header.astro');
        expect(await container.renderToString(Header, { locals: { league: 'mbb', preview: false } as any })).not.toContain('href="/mbb/tournaments"');
        expect(await container.renderToString(Header, { locals: { league: 'mbb', ...on() } as any })).toContain('href="/mbb/tournaments"');
        expect(await container.renderToString(Header, { locals: { league: 'nba', ...on() } as any })).not.toContain('/tournaments"');
    });
    test('reads the three run tables from the ESPN game schema; a failed read is the 503, an unknown run the 404', async () => {
        calls.length = 0;
        const r = await prepareRun(astroFor(`https://gameonpaper.com/mbb/tournaments/${FLORIDA}`, on(), { id: FLORIDA }), 'mbb');
        expect('games' in r && r.games).toHaveLength(6);
        expect(calls.map(([s, t, q]) => [s, t, q.run_id]).sort()).toEqual([
            ['mbb', 'tournament_run_games', FLORIDA], ['mbb', 'tournament_run_players', FLORIDA], ['mbb', 'tournament_run_teams', FLORIDA],
        ]);
        expect(calls.find(([, t]) => t === 'tournament_run_players')?.[2].order).toBe('-pts');
        expect(await prepareRun(astroFor('https://gameonpaper.com/mbb/tournaments/2025-22-1', on(), { id: '2025-22-1' }), 'mbb')).toEqual({ notFound: true });
        read.fail = true;
        try { expect(await prepareRun(astroFor(`https://gameonpaper.com/mbb/tournaments/${FLORIDA}`, on(), { id: FLORIDA }), 'mbb')).toEqual({ unavailable: true }); } finally { read.fail = false; }
    });
});

describe('the pages', () => {
    test("Florida's 2025 NCAA run: the strip, the totals and the lines are the producer's columns", async () => {
        const html = await render('mbb', `/tournaments/${FLORIDA}`);
        const games = FIX.mbb.games.filter((g: any) => g.run_id === FLORIDA);
        expect(html.match(/data-run-game="/g)).toHaveLength(6);
        expect(html).toContain(`href="/mbb/game/${games[0].game_id}"`);
        expect(text(html.split('data-run-status>')[1].split('</p>')[0])).toBe('Champion, 6-0');
        expect(text(html.split('data-run-game="6"')[1].split('</a>')[0])).toContain('National Championship');
        const t = FIX.mbb.teams.find((x: any) => x.run_id === FLORIDA);
        expect(text(after(html, `data-run-team="${t.team_id}"`))).toBe([t.wins, t.losses, t.pts, t.opp_pts, t.fgm, t.fga, t.fg3m, t.fg3a, t.ftm, t.fta, t.reb, t.ast, t.stl, t.blk, t.tov].join(' '));
        const top = FIX.mbb.players.filter((p: any) => p.run_id === FLORIDA)[0];
        expect(text(after(html, `data-series-player="${top.athlete_id}"`)).startsWith(`${top.athlete_display_name} ${top.games} ${top.min_pg.toFixed(1)} ${top.pts_pg.toFixed(1)}`)).toBe(true);
        expect(html).toContain('per game in the run');
        expect(html).toContain(`data-series-shift-player="${top.athlete_id}"`);
    });
    test('?spoilers=off keeps the result out of the head, and the share URLs are the spoiler-free page', async () => {
        const safe = await render('mbb', `/tournaments/${FLORIDA}?spoilers=off`);
        const head = safe.split('</head>')[0];
        expect(head).not.toContain('Champion, 6-0');
        expect(safe.split('</head>')[0].replaceAll('Championship', '')).not.toContain('Champion');
        expect(head).toMatch(new RegExp(`<meta property="og:url" content="https://gameonpaper.com/mbb/tournaments/${FLORIDA}\\?spoilers=off"`));
        expect(safe).toContain('data-run-status>Champion, 6-0');
    });
    test("UConn's 2025 women's NCAA run", async () => {
        const html = await render('wbb', `/tournaments/${UCONN}`);
        expect(html.match(/data-run-game="/g)).toHaveLength(6);
        expect(text(html.split('data-run-status>')[1].split('</p>')[0])).toBe('Champion, 6-0');
    });
    test('the season index: the NCAA tournament first with its champion first, then the other postseason events, then the conference tournaments', async () => {
        const list = tournaments(FIX.mbb.games);
        expect(list[0].kind).toBe('ncaa');
        expect(list[0].runs).toHaveLength(68);
        expect(list[0].runs[0].run_id).toBe(FLORIDA);
        expect(list.slice(1, 4).map((t) => t.kind)).toEqual(['postseason', 'postseason', 'postseason']);
        expect(list.filter((t) => t.kind === 'conference')).toHaveLength(31);
        for (const t of list) expect(t.runs.filter((r) => r.run_result === 'champion')).toHaveLength(1);
        const html = await render('mbb', '/tournaments?season=2025');
        expect(html.match(/data-tournament="/g)).toHaveLength(list.length);
        expect(html).toContain(`href="/mbb/tournaments/${FLORIDA}"`);
        expect(html.indexOf('data-tournament="22"')).toBeLessThan(html.indexOf('data-tournament="21"'));
    });
    test('the bare index falls back one season while the current one has none (the fixture holds 2024-25 only)', async () => {
        calls.length = 0;
        const html = await render('wbb', '/tournaments');
        expect(calls.map(([, , q]) => q.season)).toEqual(['2027', '2026']);
        expect(html).toContain('id="runs-empty"');
        expect(html).toMatch(/<option value="2026" selected/);
    });
    test('?spoilers=off rides from the index to every run link', async () => {
        const html = await render('wbb', '/tournaments?season=2025&spoilers=off');
        expect(html).toContain(`href="/wbb/tournaments/${UCONN}?spoilers=off"`);
        expect(html).toContain('<input type="hidden" name="spoilers" value="off">');
    });
});
