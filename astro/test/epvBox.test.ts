// BB-G26 / BB-G46: the basketball game page's EPV box behind 'bball-epv', all four leagues. The reads (the id mapping and
// every query season-filtered and capped), the side split, the page-side step (the flag, the season, and a final gate the
// read; a failed read keeps the page and is never cached) and the template, on real rows (fixtures/README.md:
// epv-box-{nba,wnba,mbb,wbb}-2025.json.gz). Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// CHA 89 at ORL 114, 2024-11-12 (ESPN 401703372, stats 0022400003)
const capture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const CAP = capture('epv-box-nba-2025');
// BB-G46: LV at NY, 2025-05-17 (ESPN 401736116, stats 1022500005); UNC Wilmington 67 at East Carolina 53, 2024-12-03
// (ESPN 401722197, contest 5722015); Winthrop 39 at Georgia Tech 85, 2024-11-04 (ESPN 401711537, contest 5722020)
const MORE = { wnba: { home: 17, away: 9, ...capture('epv-box-wnba-2025') }, // the ESPN ids (unused by a pro read)
    mbb: capture('epv-box-mbb-2025'), wbb: capture('epv-box-wbb-2025') };
const HOME = 1610612753, AWAY = 1610612766; // ORL, CHA (stats ids; ESPN 19 and 30)

// an unmocked read would go to the Data API with the vitest config's dummy SDV_AUTH_TOKEN (a 429 lockout for this IP):
// any fetch at all fails the file instead
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ cap: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const c = api.cap;
        if (table === 'schedule_crosswalk') return c.crosswalk;
        if (table === 'player_box' || table === 'player_crosswalk') return c.names;
        if (table === 'ncaa_player_box') return c.box;
        // the cap applies, so a lowered limit would drop rows and fail the tests below
        if (table === 'epv_player_games') return c.players.slice(0, Number(query.limit));
        if (table === 'epv_team_games') return c.teams.slice(0, Number(query.limit));
        // Q31's links: the season's player pages, and college's per-side crosswalk pairs
        if (table === 'shot_season_players') return c.pages ?? [];
        if (table === 'ncaa_player_crosswalk') return c.pairs?.[query.espn_team_id] ?? [];
        throw new Error(`unexpected table ${table}`);
    },
}));
// the route test swaps retrieveEpvBox; everything else uses the real one (through the mocked reads above)
const box = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/epvBox', async (orig) => {
    const real = await orig<typeof import('../src/resources/epvBox')>();
    return { ...real, retrieveEpvBox: (...a: Parameters<typeof real.retrieveEpvBox>) => (box.fn ? box.fn(...a) : real.retrieveEpvBox(...a)) };
});
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));

import NbaEpvBox from '../src/components/nba/game/NbaEpvBox.astro';
import NbaGameRoute from '../src/components/routes/NbaGameRoute.astro';
import { EMPTY_EPV, EPV_FIRST_SEASON, epvSide, hasEpv, retrieveEpvBox, type EpvBoxReads } from '../src/resources/epvBox';
import { fromDataApi } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';

/** Q31's link reads, the Impact box's (left out of the game-read checks below) */
const LINKS = new Set(['shot_season_players', 'ncaa_player_crosswalk']);
const gameCalls = () => api.calls.filter((c) => !LINKS.has(c.table));
const reads = async (cap = CAP): Promise<EpvBoxReads> => { api.cap = cap; return retrieveEpvBox('nba', 2025, '401703372', 19, 30); };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());
const gameApi = () => read('game_401766458_api'); // ATL 95 at ORL 120, the 2025 play-in: the route tests' final
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { api.calls.length = 0; api.fail = false; box.fn = null; [sched, rows].forEach((f) => f.mockReset()); });

describe('the capture', () => {
    const mine = (id: number) => CAP.players.filter((p: any) => p.team_id === id);
    const team = (id: number) => CAP.teams.find((t: any) => t.team_id === id);
    test("the producer's identities: on-court sums are five times the team's, and the nets cancel", () => {
        for (const id of [HOME, AWAY]) {
            const sum = (k: string) => mine(id).reduce((t: number, p: any) => t + p[k], 0);
            expect(sum('off_epv_on')).toBeCloseTo(5 * team(id).off_epv, 6);
            expect(sum('def_epv_on')).toBeCloseTo(5 * team(id).def_epv, 6);
            expect(sum('epv_on')).toBeCloseTo(5 * team(id).net_epv, 6);
        }
        expect(team(HOME).net_epv + team(AWAY).net_epv).toBeCloseTo(0, 9);
        expect(team(HOME).off_epv).toBeCloseTo(team(AWAY).def_epv, 9);
    });
    test('ORL won by 25 and its net EPV is +25.1: the sign follows the score', () => {
        const s = CAP.schedule[0];
        expect(s.home_score - s.away_score).toBe(25);
        expect(team(HOME).net_epv).toBeCloseTo(25.05, 2);
    });
    test('every EPV player is named by the stats box', () => {
        const named = new Set(CAP.names.map((n: any) => n.person_id));
        expect(CAP.players.filter((p: any) => !named.has(p.player_id))).toEqual([]);
    });
});

describe('retrieveEpvBox', () => {
    test('the crosswalk first, then three reads in nba_stats, each season-filtered, by the stats game id, capped', async () => {
        const r = await reads();
        expect(api.calls[0]).toEqual({ schema: 'nba', table: 'schedule_crosswalk', query: { season: '2025', espn_game_id: '401703372', select: 'nba_game_id,nba_home_team_id,nba_away_team_id', limit: '1' } });
        const rest = gameCalls().slice(1);
        expect(rest.map((c) => c.table).sort()).toEqual(['epv_player_games', 'epv_team_games', 'player_box']);
        for (const c of rest) {
            expect(c.schema).toBe('nba_stats');
            expect(c.query).toMatchObject({ season: '2025', game_id: '0022400003' });
        }
        expect(Object.fromEntries(rest.map((c) => [c.table, c.query.limit]))).toEqual({ epv_player_games: '80', epv_team_games: '2', player_box: '80' });
        expect(r.players).toHaveLength(CAP.players.length);
        expect(r.team).toHaveLength(2);
        expect(r.gameId).toBe('0022400003');
        expect(r.teams).toEqual({ home: HOME, away: AWAY });
    });
    test('the names read is the Impact box\'s query, so the two panels share one cache entry', async () => {
        await reads();
        expect(api.calls.find((c) => c.table === 'player_box')!.query).toEqual({ season: '2025', game_id: '0022400003', select: 'person_id,first_name,family_name,name_i', limit: '80' });
    });
    test('a game the crosswalk does not map is empty after one read', async () => {
        expect(await reads({ ...CAP, crosswalk: [] })).toEqual(EMPTY_EPV);
        expect(api.calls).toHaveLength(1);
    });
    test('a failed read rejects (an outage is never an empty game)', async () => {
        api.fail = true;
        await expect(reads()).rejects.toThrow('down');
    });
    test('hasEpv: every league from 2021-22 (the WNBA from 2022)', () => {
        expect(EPV_FIRST_SEASON).toBe(2022);
        for (const l of ['nba', 'wnba', 'mbb', 'wbb'] as const) {
            expect(hasEpv(l, 2022)).toBe(true);
            expect(hasEpv(l, 2026)).toBe(true);
            expect(hasEpv(l, 2021)).toBe(false);
        }
    });
});

describe("Q31: player links, the Impact box's rule", () => {
    const more = async (league: 'wnba' | 'mbb' | 'wbb') => { const c = MORE[league]; api.cap = c; return retrieveEpvBox(league, c.season, c.espnGameId, c.home, c.away); };
    test("the link reads are the Impact box's queries, key for key (one cache entry each)", async () => {
        await reads();
        expect(api.calls.find((c) => c.table === 'shot_season_players')).toEqual({ schema: 'nba_stats', table: 'shot_season_players', query: { season: '2025', select: 'person_id', limit: '50000' } });
        expect(api.calls.some((c) => c.table === 'ncaa_player_crosswalk')).toBe(false);
        api.calls.length = 0;
        await more('mbb');
        expect(api.calls.filter((c) => c.table === 'ncaa_player_crosswalk').map((c) => c.query)).toEqual([151, 350].map((t) =>
            ({ season: '2025', espn_team_id: String(t), select: 'ncaa_player_id,espn_athlete_id', limit: '80' })));
    });
    test('the pros link by the stats id; college by the ESPN athlete id; a player with no page has no link', async () => {
        const all = (r: EpvBoxReads) => (['home', 'away'] as const).flatMap((side) => epvSide(r, side).players);
        const nba = all(await reads());
        expect(nba.every((p) => p.pageId === String(p.player_id))).toBe(true);
        expect(all(await more('wnba')).every((p) => p.pageId === String(p.player_id))).toBe(true);
        for (const l of ['mbb', 'wbb'] as const) {
            const ps = all(await more(l));
            const linked = ps.filter((p) => p.pageId);
            // the real captures: every college player but one has a crosswalk pair and a page that season
            expect(linked.length, l).toBe(ps.length - 1);
            expect(linked.every((p) => p.pageId !== String(p.player_id))).toBe(true);
        }
        const r = await reads();
        expect(all({ ...r, pages: new Set() }).every((p) => p.pageId === null)).toBe(true);
    });
    test('the box links each named player to his page and leaves the rest as text', async () => {
        const html = await render(await reads());
        const wagner = epvSide(await reads(), 'home').players.find((p) => p.name === 'Franz Wagner')!;
        expect(table(html, 'ORL EPV')).toContain(`/players/${wagner.player_id}`);
        expect(table(html, 'ORL EPV')).toMatch(/<a href="[^"]+">Franz Wagner<\/a>/);
        const c = await more('wbb');
        const page = await render(c, 'wbb', 'GT', 'WIN');
        const rows = (['GT EPV', 'WIN EPV'] as const).map((t) => table(page, t)).join('');
        expect((rows.match(/<a href="[^"]*\/players\//g) ?? []).length).toBe(MORE.wbb.players.length - 1);
        expect(await render({ ...(await reads()), pages: new Set() })).not.toContain('/players/');
    });
    test('a failed link read rejects like the rest (strict)', async () => {
        await expect(reads({ ...CAP, get pages() { throw new Error('down'); } })).rejects.toThrow('down');
    });
});

describe('epvSide', () => {
    test('each side: its own players, most EPV added first, every one named, and its team row', async () => {
        const r = await reads();
        for (const [side, id, n] of [['home', HOME, 14], ['away', AWAY, 12]] as const) {
            const s = epvSide(r, side);
            expect(s.team?.team_id).toBe(id);
            expect(s.players).toHaveLength(n);
            expect(s.players.map((p) => p.epv_own)).toEqual([...s.players.map((p) => p.epv_own)].sort((a, b) => b! - a!));
            expect(s.players.filter((p) => p.name.startsWith('#'))).toEqual([]);
        }
        expect(epvSide(r, 'home').players[0].name).toBe('Franz Wagner');
        expect(epvSide(r, 'away').players[0].name).toBe('Moussa Diabaté');
    });
    test('a player the box does not name keeps their id', async () => {
        const s = epvSide({ ...(await reads()), names: [] }, 'away');
        expect(s.players.every((p) => p.name === `#${p.player_id}`)).toBe(true);
    });
});

describe('BB-G46: the WNBA and college', () => {
    const more = async (league: 'wnba' | 'mbb' | 'wbb') => {
        const c = MORE[league]; api.cap = c;
        return retrieveEpvBox(league, c.season, c.espnGameId, c.home, c.away);
    };
    test("the captures hold the producer's identities: on-court sums are five times the team's, and the nets cancel", () => {
        for (const c of Object.values(MORE)) {
            expect(c.teams).toHaveLength(2);
            for (const t of c.teams) {
                const sum = (k: string) => c.players.filter((p: any) => p.team_id === t.team_id).reduce((a: number, p: any) => a + p[k], 0);
                expect(sum('off_epv_on')).toBeCloseTo(5 * t.off_epv, 6);
                expect(sum('epv_on')).toBeCloseTo(5 * t.net_epv, 6);
            }
            expect(c.teams[0].net_epv + c.teams[1].net_epv).toBeCloseTo(0, 9);
        }
    });
    test('the WNBA: the crosswalk, then wnba_stats by the stats game id and the season\'s names from the player crosswalk', async () => {
        const r = await more('wnba');
        expect(api.calls[0]).toEqual({ schema: 'wnba', table: 'schedule_crosswalk', query: { season: '2025', espn_game_id: '401736116', select: 'wnba_game_id,wnba_home_team_id,wnba_away_team_id', limit: '1' } });
        const by = Object.fromEntries(gameCalls().slice(1).map((c) => [c.table, c]));
        expect(Object.keys(by).sort()).toEqual(['epv_player_games', 'epv_team_games', 'player_crosswalk']);
        for (const t of ['epv_player_games', 'epv_team_games']) expect(by[t]).toMatchObject({ schema: 'wnba_stats', query: { season: '2025', game_id: '1022500005' } });
        // one read per season, not per game: no game filter, capped
        expect(by.player_crosswalk).toEqual({ schema: 'wnba', table: 'player_crosswalk', query: { season: '2025', select: 'wnba_player_id,wnba_player_name', limit: '600' } });
        expect(r.teams).toEqual({ home: 1611661313, away: 1611661319 });
        expect(r.players).toHaveLength(MORE.wnba.players.length);
    });
    test("college: the Impact box's stats.ncaa.org box read (one cache entry), then the league schema by the contest id", async () => {
        for (const l of ['mbb', 'wbb'] as const) {
            api.calls.length = 0;
            const c = MORE[l];
            const r = await more(l);
            expect(api.calls[0]).toEqual({ schema: l, table: 'ncaa_player_box', query: { season: '2025', espn_game_id: c.espnGameId, select: 'contest_id,player_id,clean_name,player', limit: '80' } });
            for (const x of gameCalls().slice(1)) expect(x).toMatchObject({ schema: l, query: { season: '2025', game_id: c.box[0].contest_id } });
            expect(gameCalls().slice(1).map((x) => x.table).sort()).toEqual(['epv_player_games', 'epv_team_games']);
            expect(r.teams).toEqual({ home: c.home, away: c.away });
        }
    });
    test('each side of each league: its own players and team row, every player named', async () => {
        for (const l of ['wnba', 'mbb', 'wbb'] as const) {
            const r = await more(l);
            const total = (['home', 'away'] as const).map((side) => {
                const s = epvSide(r, side);
                expect(s.team?.team_id).toBe(r.teams![side]);
                expect(s.players.length).toBeGreaterThan(5);
                expect(s.players.filter((p) => p.name.startsWith('#'))).toEqual([]);
                return s.players.length;
            });
            expect(total[0] + total[1]).toBe(MORE[l].players.length);
        }
    });
    test('the sign follows the score: the winner has the positive net', async () => {
        for (const l of ['mbb', 'wbb'] as const) {
            const r = await more(l); const sc = MORE[l].score;
            const homeNet = epvSide(r, 'home').team!.net_epv!;
            expect(Math.sign(homeNet)).toBe(Math.sign(sc.home_score - sc.away_score));
        }
    });
    test('an unmapped game is empty after one read', async () => {
        api.cap = { ...MORE.mbb, box: [] };
        expect(await retrieveEpvBox('mbb', 2025, MORE.mbb.espnGameId, MORE.mbb.home, MORE.mbb.away)).toEqual(EMPTY_EPV);
        expect(api.calls).toHaveLength(1);
        api.calls.length = 0; api.cap = { ...MORE.wnba, crosswalk: [] };
        expect(await retrieveEpvBox('wnba', 2025, MORE.wnba.espnGameId, 17, 9)).toEqual(EMPTY_EPV);
        expect(api.calls).toHaveLength(1);
    });
    test('the box renders college rows: named, signed, no NaN', async () => {
        const html = await render(await more('wbb'), 'wbb', 'GT', 'WIN');
        expect(table(html, 'GT EPV')).toContain(epvSide(await more('wbb'), 'home').players[0].name);
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('>#');
        // small screens get the abbreviation, larger ones the name
        expect(html).toContain('<span class="d-none d-md-inline">GT</span><span class="d-md-none">GT</span>');
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    // the sibling panels share the gate: off here, so these cases are the EPV box's alone
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { flagOverrides: { 'bball-impact-box': false, 'bball-game-flow': false }, ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame with the flag', () => {
    const ingested = (season?: number) => {
        const g = gameApi();
        if (season !== undefined) g.schedule[0].season = season;
        sched.mockResolvedValueOnce(g.schedule[0]); rows.mockResolvedValueOnce(g);
    };
    test("'bball-epv' is a preview flag", () => { expect(FLAGS['bball-epv']).toBe('preview'); });
    test('off (no preview): no read, no epv key, so the page is byte for byte today\'s', async () => {
        const fn = vi.fn(); box.fn = fn; ingested();
        const r = await prepareBasketballGame(fakeAstro({}).astro, 'nba');
        expect('game' in r).toBe(true);
        expect('epv' in r).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read with the season and the ESPN game id, the year-long cache kept', async () => {
        const pre = await reads();
        const fn = vi.fn(async () => pre); box.fn = fn; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect(fn).toHaveBeenCalledWith('nba', 2025, '401766458', expect.any(Number), expect.any(Number));
        expect('epv' in r && r.epv?.gameId).toBe('0022400003');
        expect(cache).toHaveLength(1);
        expect((cache[0] as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a final the backfill has not reached (no rows): held for the season window, not a year', async () => {
        const pre = await reads();
        box.fn = async () => ({ ...pre, players: [], team: [] }); ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('epv' in r && r.epv?.players).toEqual([]);
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, player rows but a team row missing: held for the season window too', async () => {
        const pre = await reads();
        box.fn = async () => ({ ...pre, team: pre.team.slice(0, 1) }); ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: the page renders, the epv is null, nothing is cached', async () => {
        box.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.epv).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('on, a season before the booster (2020-21): no read and no panel', async () => {
        const fn = vi.fn(); box.fn = fn; ingested(2021);
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
        expect('game' in r && 'epv' in r).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
});

function render(epv: EpvBoxReads | null, league = 'nba', homeAbbr = 'ORL', awayAbbr = 'CHA') {
    const game = fromDataApi(gameApi(), 'nba');
    const g = { ...game, home: { ...game.home, team: { ...game.home.team, abbreviation: homeAbbr, displayName: homeAbbr === 'ORL' ? 'Orlando Magic' : homeAbbr } }, away: { ...game.away, team: { ...game.away.team, abbreviation: awayAbbr, displayName: awayAbbr === 'CHA' ? 'Charlotte Hornets' : awayAbbr } } };
    return container.renderToString(NbaEpvBox, { props: { game: g, epv }, locals: { league } as App.Locals });
}
function table(html: string, label: string) { return html.split(`aria-label="${label}"`)[1].split('</table>')[0]; }

describe('NbaEpvBox', () => {
    test('CHA at ORL: the team table, away first, and each side\'s players, named, signed, no NaN', async () => {
        const html = await render(await reads());
        const teams = table(html, 'Team EPV');
        expect(teams.indexOf('CHA')).toBeLessThan(teams.indexOf('ORL'));
        expect(teams).toContain('+25.1');
        expect(teams).toContain('−25.1'); // a real minus
        expect(table(html, 'ORL EPV').match(/<tr/g)).toHaveLength(14 + 1);
        expect(table(html, 'CHA EPV').match(/<tr/g)).toHaveLength(12 + 1);
        expect(table(html, 'ORL EPV')).toContain('Franz Wagner');
        expect(table(html, 'CHA EPV')).toContain('Moussa Diabaté');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('>#');
    });
    test('a value that rounds to zero has no sign', async () => {
        const pre = await reads();
        const html = await render({ ...pre, team: pre.team.map((t) => ({ ...t, off_epv_per_poss: -0.004 })) });
        expect(table(html, 'Team EPV')).not.toContain('−0.00');
        expect(table(html, 'Team EPV')).toContain('>0.00<');
    });
    test('a failed read says unavailable; an unbuilt game says so', async () => {
        expect(await render(null)).toContain('id="epv-unavailable"');
        expect(await render(EMPTY_EPV)).toContain('id="epv-empty"');
    });
});

describe('the game page', () => {
    const page = (epv?: EpvBoxReads | null) => container.renderToString(NbaGameRoute, { props: { data: { game: fromDataApi(gameApi(), 'nba'), ...(epv !== undefined ? { epv } : {}) } }, locals: { league: 'nba' } as App.Locals });
    test('with the reads: the panel and its nav entry; without: neither', async () => {
        const on = await page(await reads());
        expect(on).toContain('href="#epv"');
        expect(on).toContain('aria-label="Team EPV"');
        const off = await page();
        expect(off).not.toContain('#epv');
        expect(off).not.toContain('Team EPV');
    });
});
