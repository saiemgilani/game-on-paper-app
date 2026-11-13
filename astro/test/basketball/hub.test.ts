// astro/test/basketball/hub.test.ts
// BB-G47's league hub behind 'bball-hub': the line copy, the page index and the /<league> render for all four leagues, on real
// ESPN scoreboard captures and the real game_lines rows of those games (fixtures/README.md). The Data API read is the
// resource's own call into a mocked retrieveRowsFrom, and fetch fails the file if anything reaches the network.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { UPSET_WP, hubIndex, hubLine, hubTags } from '../../src/basketball/hub';
import { MAX_LINE_READS } from '../../src/resources/gameLines';
import type { BasketballLeague } from '../../src/utils/league';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (u: unknown) => { fetched.push(String(u)); throw new Error(`network: ${String(u)}`); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const fix = (p: string) => readFileSync(new URL(`../fixtures/${p}`, import.meta.url));
const LINES = JSON.parse(fix('hub-game-lines.json').toString()) as Record<string, any[]>;
const BOARDS: Record<BasketballLeague, string> = {
    nba: 'nba/scoreboard-20250115.json', wnba: 'wnba/scoreboard-20250801.json', mbb: 'mbb/scoreboard-20250222-top25.json', wbb: 'wbb/scoreboard-20260207-top25.json',
};
const events = (lg: BasketballLeague) => JSON.parse(fix(BOARDS[lg]).toString()).content.sbData.events as any[];
const DAYS: Record<BasketballLeague, string> = { nba: '2025-01-15', wnba: '2025-08-01', mbb: '2025-02-22', wbb: '2026-02-07' };

const sb = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sb(...a) }));
const rows = vi.fn();
vi.mock('../../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../../src/resources/sdv')>()), retrieveRowsFrom: (...a: unknown[]) => rows(...a) }));
const linesFrom = (lg: string) => async (_src: unknown, table: string, q: Record<string, string>) => {
    if (table !== 'game_lines') throw new Error(`unexpected read ${table}`);
    return LINES[lg].filter((r) => String(r.game_id) === q.game_id);
};
// the flag-off landing (the teams index) is rendered by the leagues' own page tests; here it only has to be what is called
const teams = vi.fn(async () => ({ unavailable: true }));
vi.mock('../../src/routes/basketball/teams', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/teams')>()), prepareBasketballTeams: (...a: unknown[]) => teams(...a) }));
beforeEach(() => { sb.mockReset(); rows.mockReset(); teams.mockClear(); });

/** ESPN's home and away competitor of a fixture game. */
const sides = (e: any) => ({ home: e.competitions[0].competitors.find((c: any) => c.homeAway === 'home'), away: e.competitions[0].competitors.find((c: any) => c.homeAway === 'away') });

describe('hubLine: a game_lines row as card copy', () => {
    const [nyPhi] = events('nba'); // 401705127, NY at PHI: PHI +5.5 at home
    const row = LINES.nba.find((r) => r.game_id === 401705127)!;
    test('the favourite carries the spread; the home side is ESPN home; the market WP is the favourite\'s', () => {
        const { home, away } = sides(nyPhi);
        const l = hubLine(row, { home: home.team.abbreviation, away: away.team.abbreviation }, null)!;
        expect(row.spread_home_close).toBe(5.5);
        expect(l.spread).toBe(`${away.team.abbreviation} -5.5`);
        expect(l.total).toBe(219.5);
        expect(l.wp).toBe(`${away.team.abbreviation} ${Math.round((1 - row.market_home_wp_close) * 100)}%`);
        expect(l.cover).toBeNull(); // not final
        expect(l.upset).toBe(false);
    });
    test('a final: who covered, and an upset only when the winner had a pregame WP under 35%', () => {
        expect(UPSET_WP).toBe(0.35);
        for (const lg of ['nba', 'wnba', 'mbb', 'wbb'] as const) for (const e of events(lg)) {
            const r = LINES[lg].find((x) => String(x.game_id) === e.id)!;
            const { home, away } = sides(e);
            const hs = Number(home.score), as = Number(away.score);
            const l = hubLine(r, { home: 'H', away: 'A' }, hs > as ? 'home' : 'away')!;
            expect(l.upset, e.id).toBe((hs > as ? r.market_home_wp_close : 1 - r.market_home_wp_close) < UPSET_WP);
            expect(l.cover, e.id).toBe(r.ats_result == null ? null : r.ats_result === 'push' ? 'Push' : `${r.ats_result === 'home' ? 'H' : 'A'} covered`);
        }
    });
    test('the 35% cut on real finals: an underdog at 36-45% is no upset, 34.9% and below is', () => {
        const winnerWp = (lg: 'wnba' | 'mbb', id: string) => {
            const e = events(lg).find((x) => x.id === id)!;
            const { home, away } = sides(e);
            const r = LINES[lg].find((x) => String(x.game_id) === id)!;
            const won = Number(home.score) > Number(away.score) ? 'home' : 'away';
            return { up: hubLine(r, { home: 'H', away: 'A' }, won)!.upset, wp: won === 'home' ? r.market_home_wp_close : 1 - r.market_home_wp_close };
        };
        // market underdogs that won, so the old under-50% rule tagged all five
        for (const [lg, id, upset] of [['mbb', '401708409', false], ['wnba', '401736285', false], ['mbb', '401708411', false], ['wnba', '401736289', true], ['mbb', '401721447', true]] as const) {
            const { up, wp } = winnerWp(lg, id);
            expect(wp, id).toBeLessThan(0.5);
            expect(up, id).toBe(upset);
        }
    });
    test('no book closed: the opening line and WP stand in', () => {
        const [r] = LINES['nba-open-only'];
        expect(r.spread_home_close).toBeNull();
        expect(hubLine(r, { home: 'H', away: 'A' }, null)).toEqual({ spread: 'H -1.5', total: 221.5, wp: 'H 53%', cover: null, upset: false });
    });
    test('no row, or a row with nothing in it, is no line', () => {
        expect(hubLine(undefined, { home: 'H', away: 'A' }, null)).toBeNull();
        expect(hubLine({ game_id: 1, n_books: 0, spread_home_open: null, spread_home_close: null, total_open: null, total_close: null, market_home_wp_open: null, market_home_wp_close: null, ats_result: null }, { home: 'H', away: 'A' }, 'home')).toBeNull();
        expect(hubLine({ ...LINES['nba-open-only'][0], spread_home_open: 0 }, { home: 'H', away: 'A' }, null)!.spread).toBe('Pick');
    });
});

describe('hubTags and hubIndex', () => {
    test('neutral site and the TV names, deduplicated', () => {
        expect(hubTags({ neutralSite: true, broadcasts: [{ market: 'national', names: ['ESPN', 'ESPN+'] }, { market: 'home', names: ['ESPN'] }], broadcast: 'ESPN' })).toEqual(['Neutral site', 'TV: ESPN, ESPN+']);
        expect(hubTags({ neutralSite: false, broadcasts: [], broadcast: 'NBA TV' })).toEqual(['TV: NBA TV']);
        expect(hubTags({ neutralSite: false, broadcasts: [], broadcast: '' })).toEqual([]);
    });
    test("every league indexes its Header pages; the NBA's featured-team landing becomes a link to that team's page", () => {
        expect(hubIndex('nba').map((p) => p.path)).toEqual(['/scoreboard', '/players', '/teams', '/scatter', '/leaders', '/team/17']);
        expect(hubIndex('nba')[5].label).toBe('Nets');
        for (const lg of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
            const paths = hubIndex(lg).map((p) => p.path);
            if (lg !== 'nba') expect(paths, lg).toEqual(['/scoreboard', '/players', '/teams', '/scatter', '/leaders']);
            expect(hubIndex(lg).every((p) => p.blurb), lg).toBe(true);
        }
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
// BB-G48's 'bball-hub-tonight' is off here: its reads and sections are hubTonight.test.ts's
const render = async (lg: BasketballLeague, query = '', locals: Partial<App.Locals> = { preview: true, flagOverrides: { 'bball-hub-tonight': false } }) => {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/${lg}/index.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/${lg}${query}`), locals: locals as App.Locals });
};
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');

describe('/<league> behind bball-hub', () => {
    for (const lg of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
        test(`${lg}: today's games with their lines, then the page index`, async () => {
            const evs = events(lg);
            sb.mockResolvedValue({ day: DAYS[lg], events: evs, degraded: false });
            rows.mockImplementation(linesFrom(lg));
            const html = await render(lg);
            // one read per game, by its season and ESPN id, from the league's games schema
            const key = (x: unknown[]) => x.join(':');
            expect(rows.mock.calls.map((c) => key([c[0].schema, c[2].season, c[2].game_id, c[2].limit])).sort()).toEqual(evs.map((e) => key([lg, e.season.year, e.id, '1'])).sort());
            expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
            expect(html).toContain('id="hub-final"');
            for (const e of evs) expect(html, e.id).toContain(`data-hub-line="${e.id}"`);
            expect((html.match(/Market, pregame: /g) ?? []).length).toBe(evs.length);
            for (const p of ['/scoreboard', '/players', '/teams', '/scatter', '/leaders']) expect(html).toContain(`href="/${lg}${p}"`);
            expect(html.indexOf('id="hub-games"')).toBeLessThan(html.indexOf('id="hub-index"'));
            for (const bad of ['NaN', 'undefined', 'null']) expect(noScripts(html)).not.toContain(bad);
            expect(html).not.toContain('id="nba-roster"');
        });
    }
    test('live first, then upcoming, then final; an upcoming game prints no score', async () => {
        const [a, b, ...rest] = events('nba');
        const as = (e: any, state: string, name: string) => ({ ...e, competitions: [{ ...e.competitions[0], status: { ...e.competitions[0].status, type: { ...e.competitions[0].status.type, state, name, completed: false } } }] });
        sb.mockResolvedValue({ day: DAYS.nba, events: [...rest, as(b, 'pre', 'STATUS_SCHEDULED'), as(a, 'in', 'STATUS_IN_PROGRESS')], degraded: false });
        rows.mockImplementation(linesFrom('nba'));
        const html = await render('nba');
        const at = (k: string) => html.indexOf(`id="hub-${k}"`);
        expect(at('live')).toBeGreaterThan(-1);
        expect(at('live')).toBeLessThan(at('upcoming'));
        expect(at('upcoming')).toBeLessThan(at('final'));
        // the Nets landing the hub replaces is one click away in the page index
        expect(html.slice(html.indexOf('id="hub-index"'))).toContain('href="/nba/team/17"');
        // not final: no cover or upset words on those two cards
        const card = (id: string) => html.split(`data-hub-line="${id}"`)[1].split('</p>')[0];
        for (const id of [a.id, b.id]) expect(card(id)).not.toMatch(/covered|Upset|Push/);
    });
    test('the hub is always today: ?date= and ?group= never reach the scoreboard read', async () => {
        sb.mockResolvedValue({ day: DAYS.mbb, events: events('mbb'), degraded: false });
        rows.mockImplementation(linesFrom('mbb'));
        const html = await render('mbb', '?date=1990-01-01&group=bogus');
        expect(sb.mock.calls).toEqual([['mbb', null]]);
        expect(html).toContain('id="hub-index"');
    });
    test('a failed or empty lines read is cards without lines, never a broken hub', async () => {
        sb.mockResolvedValue({ day: DAYS.wnba, events: events('wnba'), degraded: false });
        rows.mockRejectedValue(new Error('503'));
        const html = await render('wnba');
        expect(html).not.toContain('Market, pregame');
        expect(html).toContain('id="hub-final"');
    });
    test('a degraded board says so and makes no lines read', async () => {
        sb.mockResolvedValue({ day: '2026-11-10', events: [], degraded: true });
        const html = await render('wbb');
        expect(html).toContain('scoreboard is unavailable');
        expect(rows).not.toHaveBeenCalled();
        expect(html).toContain('href="/wbb/scoreboard"');
    });
    test(`an all-D-I day reads lines for its first ${MAX_LINE_READS} games only`, async () => {
        const all = JSON.parse(gunzipSync(fix('mbb/scoreboard-20241104-all.json.gz')).toString()).content.sbData.events as any[];
        expect(all.length).toBeGreaterThan(MAX_LINE_READS);
        sb.mockResolvedValue({ day: '2024-11-04', events: all, degraded: false });
        rows.mockResolvedValue([]);
        await render('mbb');
        expect(rows).toHaveBeenCalledTimes(MAX_LINE_READS);
    });
    test("flag off: the landing is today's, and the hub makes no read", async () => {
        await render('wnba', '', { preview: true, flagOverrides: { 'bball-hub': false } });
        expect(teams).toHaveBeenCalledTimes(1);
        expect(sb).not.toHaveBeenCalled();
        expect(rows).not.toHaveBeenCalled();
    });
});
