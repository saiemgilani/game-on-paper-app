// BB-G33: the game page's possession factors behind 'bball-situational-box'. The fixtures are real (fixtures/README.md):
// BB-G32's team-grid-*.json.gz, the offline processor body of one game per league with sdv-py's BB-D31 team split rows and
// its BB-D40 expected rows (priced against the Data API's shot cells of 2026-11-10), and game-team-expected.json, the Data
// API's game_team_expected rows of three of those finals. fetch is stubbed and must never be called; the Data API read
// is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'game_team_expected') return api.rows;
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { TEAM_EXPECTED_KEYS, TEAM_SPLIT_KEYS, fromProcessor, type NbaGame, type NbaProcessorPayload, type NbaTeamExpected } from '../src/resources/nbaGame';
import { gameExpected, retrieveGameExpected } from '../src/resources/gameExpected';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import type { BasketballLeague } from '../src/utils/league';

const gz = (name: string): { payload: NbaProcessorPayload } => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const P: Record<BasketballLeague, NbaProcessorPayload> = {
    nba: gz('team-grid-nba-401585607').payload, // TOR 96 at ORL 111, 2023-24
    wnba: gz('team-grid-wnba-401736325').payload, // SEA 80 at ATL 78, 2025
    mbb: gz('team-grid-mbb-401820775').payload, // NC State 90 at Notre Dame 96 (OT), 2025-26
    wbb: gz('team-grid-wbb-401805076').payload, // UTEP 87 at Louisiana Tech 91 (OT), 2025-26
};
/** The Data API's game_team_expected rows of the same wnba / mbb / wbb finals (each scored as of its own game date). */
const API: Record<'wnba' | 'mbb' | 'wbb', Record<string, any>[]> = JSON.parse(readFileSync(new URL('./fixtures/game-team-expected.json', import.meta.url)).toString());
const LEAGUES = Object.keys(P) as BasketballLeague[];
const game = (lg: BasketballLeague): NbaGame => fromProcessor(structuredClone(P[lg]), lg);
const SIDES = ['home', 'away'] as const;
const ZONES = ['rim', 'short_mid', 'midrange', 'corner3', 'above_break3'] as const;
/** the payload without the league's shot cells (the processor could not read them): counts kept, expected columns null */
const unpriced = (g: NbaGame) => { for (const s of SIDES) g[s].expected = Object.fromEntries(Object.entries(g[s].expected!).map(([k, v]) => [k, /^x|_poe$|_xppp$|^poe$/.test(k) ? null : v])) as NbaTeamExpected; return g; };
/** a Data API final: no splits, the expected rows the route reads */
const dataApiFinal = (lg: 'wnba' | 'mbb' | 'wbb') => {
    const g = game(lg); delete g.home.splits; delete g.away.splits;
    const e = gameExpected(API[lg], Number(g.home.team.id), Number(g.away.team.id));
    g.home.expected = e.home; g.away.expected = e.away;
    return g;
};
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

beforeEach(() => { api.calls.length = 0; api.rows = []; api.fail = false; sched.mockReset(); rows.mockReset(); });

describe('the processor payload', () => {
    test.each(LEAGUES)('%s: each side carries every split and expected column the panel reads, as the producer wrote it', (lg) => {
        const g = game(lg);
        for (const s of SIDES) {
            const row = P[lg].splits![s].team!, xrow = P[lg].expected![s]!;
            for (const k of TEAM_SPLIT_KEYS) { expect(row).toHaveProperty(k); expect(g[s].splits![k]).toBe(row[k] ?? null); }
            for (const k of TEAM_EXPECTED_KEYS) { expect(xrow).toHaveProperty(k); expect(g[s].expected![k]).toBe(xrow[k] ?? null); }
            // the families the tables split the possessions and shots into add up (sdv-py's own gate, re-read here)
            const t = g[s].splits!, e = g[s].expected!;
            expect(t.transition_poss! + t.half_court_poss!).toBe(t.possessions);
            expect(t.second_chance_poss! + t.first_chance_poss!).toBe(t.possessions);
            expect(t.rim_fga! + t.mid_fga! + t.fg2_unlocated_fga! + t.fg3_fga!).toBe(t.fga);
            expect(t.corner3_fga! + t.above_break3_fga! + t.fg3_unlocated_fga!).toBe(t.fg3_fga);
            expect(t.live_tov! + t.dead_tov!).toBe(t.tov);
            // the two rows count the same possessions: what the half-court and first-chance POE (a difference) rests on
            expect([e.possessions, e.fga, e.fast_break_poss, e.second_chance_poss]).toEqual([t.possessions, t.fga, t.transition_poss, t.second_chance_poss]);
            expect(ZONES.reduce((n, z) => n + e[`${z}_fga`]!, e.unlocated_fga!)).toBe(e.fga);
            expect(ZONES.reduce((n, z) => n + e[`${z}_poe`]!, 0)).toBeCloseTo(e.poe!, 9);
        }
    });
    test('a payload cached before BB-D40 has no expected key, and the sides carry none', () => {
        const p = structuredClone(P.wnba); delete p.expected;
        const g = fromProcessor(p, 'wnba');
        expect(g.home).not.toHaveProperty('expected'); expect(g.away).not.toHaveProperty('expected');
    });
});

describe('the page', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = (lg: BasketballLeague, g: NbaGame, flag = true) =>
        container.renderToString(NbaGamePage, { props: { game: g }, request: new Request(`https://gameonpaper.com/${lg}/game/${g.id}`), locals: { league: lg, preview: true, flagOverrides: { 'bball-situational-box': flag, 'bball-team-grid': false } } as unknown as App.Locals });
    const plain = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    const row = (html: string, label: string) => html.match(new RegExp(`<tr[^>]*>\\s*<th[^>]*>${label}</th>[\\s\\S]*?</tr>`))![0];
    const hasRow = (html: string, label: string) => new RegExp(`<th[^>]*>${label}</th>`).test(html);
    const clean = (text: string) => { for (const bad of ['NaN', 'undefined', 'null', 'n/a']) expect(text).not.toContain(bad); };

    test.each(LEAGUES)('%s: priced, the expected columns on all three tables, every number the producer\'s', async (lg) => {
        const g = game(lg), a = g.away.splits!, h = g.home.splits!, ea = g.away.expected!, eh = g.home.expected!;
        const html = await render(lg, g);
        expect(html).toContain('id="situations"'); expect(html).toContain('href="#situations"');
        for (const t of ['Situations', 'Shot zones', 'Ball and flow']) expect(html).toContain(`aria-label="${t}"`);
        clean(plain(html));
        // situations: the splits' counts and PPP, the expected row's POE; half-court and first chance are the differences
        const tr = row(html, 'Transition');
        for (const [s, e] of [[a, ea], [h, eh]] as const) {
            expect(tr).toContain(`>${s.transition_poss}<`); expect(tr).toContain(`>${s.transition_ppp!.toFixed(2)}<`);
            expect(tr).toContain(`>${signed(e.fast_break_poe!)}<`);
            expect(row(html, 'All possessions')).toContain(`>${signed(e.poe!)}<`);
            expect(row(html, 'Half-court')).toContain(`>${signed(e.poe! - e.fast_break_poe!)}<`);
            expect(row(html, 'First chance')).toContain(`>${signed(e.poe! - e.second_chance_poe!)}<`);
            const to = row(html, 'Off a turnover');
            expect(to).toContain(`>${e.off_turnover_poss}<`); expect(to).toContain(`>${e.off_turnover_ppp!.toFixed(2)}<`); expect(to).toContain(`>${signed(e.off_turnover_poe!)}<`);
            expect(row(html, 'Paint touch')).toContain(`>${e.paint_pts}<`);
        }
        expect(tr.match(/table-success/g)?.length ?? 0).toBe(a.transition_ppp === h.transition_ppp ? 0 : 1);
        // zones: the expected row's five, so made-attempted, eFG%, xPPP and POE are one set of attempts
        for (const [label, z] of [['Rim \\(under 4 ft\\)', 'rim'], ['Short mid-range', 'short_mid'], ['Long mid-range', 'midrange'], ['Corner three', 'corner3'], ['Above-the-break three', 'above_break3']] as const) {
            const r = row(html, label);
            for (const e of [ea, eh]) {
                expect(r).toContain(`>${e[`${z}_fgm`]}-${e[`${z}_fga`]}<`);
                if (e[`${z}_fga`]) { expect(r).toContain(`>${(100 * e[`${z}_efg_pct`]!).toFixed(1)}%<`); expect(r).toContain(`>${e[`${z}_xppp`]!.toFixed(2)}<`); expect(r).toContain(`>${signed(e[`${z}_poe`]!)}<`); }
            }
        }
        expect(row(html, 'Layups and dunks')).toContain(`>${h.layup_dunk_fgm}-${h.layup_dunk_fga}<`);
        expect(plain(html)).not.toContain('No location'); // no unlocated shot in these captures
        // ball and flow: the splits' rows, then the expected ones; the lower expected DRtg is the better
        const xd = row(html, 'Expected DRtg \\(opponent shot quality\\)');
        expect(xd).toContain(`>${ea.xdrtg!.toFixed(1)}<`); expect(xd).toContain(`>${eh.xdrtg!.toFixed(1)}<`);
        expect(xd).toMatch(new RegExp(`table-success fw-bold[^>]*>${Math.min(ea.xdrtg!, eh.xdrtg!).toFixed(1)}<`));
        expect(ea.xdrtg).toBeCloseTo(100 * (eh.points! - eh.poe!) / eh.possessions!, 9); // the opponent's expected rating
        expect(row(html, 'Expected TS%')).toContain(`>${(100 * eh.xts_pct!).toFixed(1)}%<`);
        const live = row(html, 'Live-ball turnovers \\(steals\\)');
        expect(live).toContain(`>${a.live_tov}<`); expect(live).toContain(`>${h.live_tov}<`);
        expect(row(html, '3PA rate')).not.toContain('table-success');
        const text = plain(html);
        expect(text).toContain(`within ${lg === 'nba' || lg === 'wnba' ? 8 : 10} seconds`);
        expect(text).toContain(lg === 'mbb' || lg === 'wbb' ? 'a two from 4 to 15 feet' : 'in the paint outside the restricted area');
        expect(text).not.toContain('expected points (points over expected');
    });

    test.each(LEAGUES)('%s: unpriced (no shot cells), today\'s tables and a note', async (lg) => {
        const g = unpriced(game(lg)), a = g.away.splits!, h = g.home.splits!;
        const html = await render(lg, g), text = plain(html);
        clean(text);
        expect(html).not.toContain('>POE<'); expect(html).not.toContain('xPPP'); expect(text).not.toContain('Expected DRtg');
        expect(text).toContain('expected points (points over expected, expected points per shot, expected TS% and DRtg) are not available');
        // the zones are the splits' (a three's make counts 1.5 in eFG%)
        const corner = row(html, 'Corner three');
        for (const s of [a, h]) {
            expect(corner).toContain(`>${s.corner3_fgm}-${s.corner3_fga}<`);
            if (s.corner3_fga) expect(corner).toContain(`>${(150 * s.corner3_fgm! / s.corner3_fga).toFixed(1)}%<`);
        }
        expect(row(html, 'Rim \\(under 4 ft\\)')).toContain(`>${h.rim_fgm}-${h.rim_fga}<`);
        expect(row(html, 'Mid-range')).toContain(`>${a.mid_fgm}-${a.mid_fga}<`);
        // the expected row's own situations keep their counts without the cells, with no POE
        expect(row(html, 'Off a turnover')).toContain(`>${g.home.expected!.off_turnover_poss}<`);
        expect(row(html, 'Biggest run')).toContain(`>${Math.abs(a.max_run! - h.max_run!)}<`);
    });

    test.each(['wnba', 'mbb', 'wbb'] as const)('%s: a Data API final (no splits, the read\'s expected rows): the expected row\'s situations and zones', async (lg) => {
        const g = dataApiFinal(lg), ea = g.away.expected!, eh = g.home.expected!;
        const html = await render(lg, g), text = plain(html);
        clean(text);
        expect(text).not.toContain('not available for this game yet');
        // no splits: no half-court / first-chance split and no splits-only ball-and-flow rows
        for (const r of ['Half-court', 'First chance', 'Live-ball turnovers \\(steals\\)', 'Layups and dunks']) expect(hasRow(html, r)).toBe(false);
        expect(hasRow(html, 'Off a turnover')).toBe(true); expect(hasRow(html, 'Expected DRtg \\(opponent shot quality\\)')).toBe(true);
        const all = row(html, 'All possessions');
        for (const e of [ea, eh]) { expect(all).toContain(`>${e.possessions}<`); expect(all).toContain(`>${(e.points! / e.possessions!).toFixed(2)}<`); expect(all).toContain(`>${signed(e.poe!)}<`); }
        const tr = row(html, 'Transition');
        expect(tr).toContain(`>${eh.fast_break_poss}<`); expect(tr).toContain(`>${(100 * eh.fast_break_rate!).toFixed(1)}%<`);
        expect(row(html, 'Corner three')).toContain(`>${ea.corner3_fgm}-${ea.corner3_fga}<`);
        expect(row(html, 'Expected TS%')).toContain(`>${(100 * ea.xts_pct!).toFixed(1)}%<`);
    });

    test('an unlocated shot shows its row, and only then', async () => {
        const g = unpriced(game('mbb')); g.home.splits = { ...g.home.splits!, fg2_unlocated_fga: 2, fg2_unlocated_fgm: 1 };
        const text = plain(await render('mbb', g));
        expect(text).toContain('Two, no location'); expect(text).not.toContain('Three, no location');
        const p = game('wbb'); p.away.expected = { ...p.away.expected!, unlocated_fga: 1, unlocated_fgm: 0 };
        expect(plain(await render('wbb', p))).toContain('No location');
    });
    test('a zero-attempt zone is a dash, never NaN', async () => {
        const g = game('wnba'); // SEA and ATL: the home side took no corner three
        expect(g.home.expected!.corner3_fga).toBe(0);
        const corner = row(await render('wnba', g), 'Corner three');
        expect(corner).toContain('>0-0<'); expect(corner).toContain('>–<'); expect(corner).not.toContain('NaN');
    });
    test('neither row (before the tip, or a season not built): the panel says so, with no tables', async () => {
        const g = game('nba'); for (const s of SIDES) { delete g[s].splits; delete g[s].expected; }
        const html = await render('nba', g);
        expect(html).toContain('id="situations"');
        expect(plain(html)).toContain('not available for this game yet'); expect(html).not.toContain('aria-label="Situations"');
    });
    test('flag off: no panel and no nav entry', async () => {
        const html = await render('wbb', game('wbb'), false);
        expect(html).not.toContain('id="situations"'); expect(html).not.toContain('href="#situations"'); expect(html).not.toContain('Possession factors');
    });
});

describe('the Data API read', () => {
    test.each(['wnba', 'mbb', 'wbb'] as const)('%s: one season- and game-filtered capped read of the games schema, each row on its side', async (lg) => {
        const g = game(lg);
        api.rows = API[lg];
        const r = await retrieveGameExpected(lg, API[lg][0].season, g.id, Number(g.home.team.id), Number(g.away.team.id));
        expect(api.calls).toHaveLength(1);
        const [c] = api.calls;
        expect([c.schema, c.table, c.query.season, c.query.game_id, c.query.limit]).toEqual([lg, 'game_team_expected', String(API[lg][0].season), g.id, '4']);
        expect(c.query.select.split(',')).toEqual(['team_id', ...TEAM_EXPECTED_KEYS]);
        for (const s of SIDES) expect(r[s]!.xfg_pts).toBe(API[lg].find((x) => x.team_id === Number(g[s].team.id))!.xfg_pts);
    });
    test('a season not built: no rows, no sides; more than two rows fails loud', () => {
        expect(gameExpected([], 1, 2)).toEqual({});
        expect(() => gameExpected([...API.mbb, ...API.wbb], 1, 2)).toThrow(/4 rows/);
    });
});

describe('prepareBasketballGame', () => {
    const gameApi = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_api.json', import.meta.url)).toString());
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    const fakeAstro = (flags: Record<string, boolean>) => {
        const cache: unknown[] = []; const headers = new Headers();
        const others = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false, 'bball-team-grid': false };
        return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { preview: true, flagOverrides: { ...others, ...flags } } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
    };
    test('a Data API final reads game_team_expected once, and a season not built is held for the season window', async () => {
        ingested();
        const { astro, cache } = fakeAstro({});
        const r: any = await prepareBasketballGame(astro, 'nba');
        const s = gameApi().schedule[0];
        expect(api.calls.map((c) => [c.schema, c.table, c.query.season, c.query.game_id])).toEqual([['nba', 'game_team_expected', String(s.season), '401766458']]);
        expect(r.game.home).not.toHaveProperty('expected');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('a failed read: the page renders without the expected points, nothing is cached', async () => {
        ingested(); api.fail = true;
        const { astro, cache, headers } = fakeAstro({});
        const r: any = await prepareBasketballGame(astro, 'nba');
        expect(r.game.home).not.toHaveProperty('expected');
        expect(cache.at(-1)).toBe(false); expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('flag off: no read', async () => {
        ingested();
        await prepareBasketballGame(fakeAstro({ 'bball-situational-box': false }).astro, 'nba');
        expect(api.calls).toEqual([]);
    });
});
