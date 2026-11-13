// BB-G1: the game page's Impact box and Lineups used behind 'bball-impact-box'. The reads (the id mapping and every
// query season-filtered and capped), the pure steps, the page-side step (the flag and a final gate the read; a failed read
// keeps the page and is never cached) and the template, on real Data API reads (fixtures/README.md: impact-box-*.json.gz,
// captured with resources/impactBox.ts's own queries). Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

interface Capture {
    league: 'nba' | 'wnba' | 'mbb' | 'wbb'; season: number; espnGameId: string
    schedule: any[]; crosswalk?: any[]; names?: any[]; box?: any[]; players: any[]; home: any[]; away: any[]
    /** college: each side's ncaa_player_crosswalk pairs, keyed by its ESPN team id */
    xwalk?: Record<string, any[]>
}
const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
// every unit of each side (the module's UNIT_LIMIT read; the first five are the original captures' top five) and each
// season's shot_season_players person ids (the player pages), captured 2026-11-12: fixtures/README.md
const EXTRA: { units: Record<string, { home: any[]; away: any[] }>; pages: Record<string, { person_id: number }[]> } = gz('impact-box-units-pages');
const capture = (name: string): Capture => ({ ...gz(name), ...EXTRA.units[name.replace('impact-box-', '')] });
const CAPTURES = {
    nba: capture('impact-box-nba-2027'), // BOS 113 at DET 121, 2026-10-20 (ESPN 401909088, stats 0022600001)
    wnba: capture('impact-box-wnba-2026'), // CON 75 at NY 106, 2026-05-08 (ESPN 401856890, stats 1022600001)
    // Southern Miss 79 at Buffalo 85, 2025-11-03 (ESPN 401823425, contest 6388769), with both sides' crosswalk pairs
    mbb: { ...capture('impact-box-mbb-2026'), xwalk: gz('impact-box-mbb-2026-xwalk') } as Capture,
    wbb: capture('impact-box-wbb-2026'), // GW 50 at Temple 86 (ESPN 401824983, contest 6387150)
    nonD1: capture('impact-box-wbb-2026-nond1'), // UDC 47 at GW 86 (ESPN 401824982): the non-D1 side has no stats.ncaa.org ids
};

// an unmocked read would go to the Data API with the vitest config's dummy SDV_AUTH_TOKEN (a 429 lockout for this IP):
// any fetch at all fails the file instead
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

// the Data API: retrieveRowsFrom answers from the capture by table (and, for the units, by team), recording each query
const api = vi.hoisted(() => ({ cap: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: false, pages: {} as Record<string, unknown[]> }));
api.pages = EXTRA.pages;
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        const c = api.cap;
        if (table === 'schedule_crosswalk') return c.crosswalk ?? [];
        if (table === 'player_box') return c.names ?? [];
        if (table === 'ncaa_player_box') return c.box ?? [];
        if (table === 'ncaa_player_crosswalk') return c.xwalk?.[query.espn_team_id] ?? [];
        if (table === 'game_player_impact') return c.players;
        if (table === 'shot_season_players') return api.pages[`${source.schema}-${query.season}`] ?? [];
        if (table === 'game_lineups_used') {
            const x = c.crosswalk?.[0];
            const home = x ? x[`${c.league}_home_team_id`] : c.schedule[0].home_id;
            return String(query.team_id) === String(home) ? c.home : c.away;
        }
        throw new Error(`unexpected table ${table}`);
    },
}));
// the route test swaps retrieveImpactBox; everything else uses the real one (through the mocked reads above)
const box = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/impactBox', async (orig) => {
    const real = await orig<typeof import('../src/resources/impactBox')>();
    return { ...real, retrieveImpactBox: (...a: Parameters<typeof real.retrieveImpactBox>) => (box.fn ? box.fn(...a) : real.retrieveImpactBox(...a)) };
});
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaImpactBox from '../src/components/nba/game/NbaImpactBox.astro';
import { EMPTY_IMPACT, retrieveImpactBox, TOP_UNITS, UNIT_LIMIT, type ImpactBoxReads } from '../src/resources/impactBox';
import { fromDataApi } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { impactSide, shortName } from '../src/utils/impactBox';

const reads = async (c: Capture): Promise<ImpactBoxReads> => {
    api.cap = c;
    const s = c.schedule[0];
    return retrieveImpactBox(c.league, c.season, c.espnGameId, Number(s.home_id), Number(s.away_id));
};
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());
const gameApi = () => read('game_401766458_api'); // MIL 120, CHI 95 is the processor fixture's game, a 2024-25 final
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
beforeEach(() => { api.calls.length = 0; api.fail = false; box.fn = null; [sched, rows, proc, espn].forEach((f) => f.mockReset()); });

describe('the captures', () => {
    test("each team's player +/- adds to five times its final margin (the ESPN schedule's score)", () => {
        for (const c of Object.values(CAPTURES)) {
            const s = c.schedule[0];
            const x = c.crosswalk?.[0];
            const id = (side: 'home' | 'away') => Number(x ? x[`${c.league}_${side}_team_id`] : s[`${side}_id`]);
            for (const side of ['home', 'away'] as const) {
                const mine = c.players.filter((p) => Number(p.team_id) === id(side));
                if (c === CAPTURES.nonD1 && side === 'away') { expect(mine).toHaveLength(0); continue; }
                const margin = Number(s[`${side}_score`]) - Number(s[`${side === 'home' ? 'away' : 'home'}_score`]);
                expect(mine.length).toBeGreaterThanOrEqual(5);
                expect(mine.reduce((t, p) => t + p.plus_minus, 0)).toBe(5 * margin);
            }
        }
    });
    test('every unit is five of its own team\'s impact players, most minutes first, every unit under the cap', () => {
        for (const c of Object.values(CAPTURES)) {
            for (const side of ['home', 'away'] as const) {
                const units = c[side];
                if (c === CAPTURES.nonD1 && side === 'away') { expect(units).toHaveLength(0); continue; }
                expect(units.length).toBeGreaterThan(TOP_UNITS);
                expect(units.length).toBeLessThan(Number(UNIT_LIMIT)); // not truncated
                expect(units.map((u) => u.minutes)).toEqual([...units.map((u) => u.minutes)].sort((a, b) => b - a));
                for (const u of units) {
                    const own = new Set(c.players.filter((p) => p.team_id === u.team_id).map((p) => String(p.player_id)));
                    expect([u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].every((p) => own.has(String(p)))).toBe(true);
                }
            }
        }
    });
});

describe('retrieveImpactBox', () => {
    test('the pros: the crosswalk first, then four reads in the stats schema, each season-filtered and capped', async () => {
        const r = await reads(CAPTURES.nba);
        expect(api.calls[0]).toEqual({ schema: 'nba', table: 'schedule_crosswalk', query: { season: '2027', espn_game_id: '401909088', select: 'nba_game_id,nba_home_team_id,nba_away_team_id', limit: '1' } });
        const rest = api.calls.slice(1);
        expect(rest.map((c) => c.table).sort()).toEqual(['game_lineups_used', 'game_lineups_used', 'game_player_impact', 'player_box', 'shot_season_players']);
        // the player pages: the season's shooters, one season-wide read (the same query, so one cache entry, for every game)
        expect(rest.find((c) => c.table === 'shot_season_players')).toEqual({ schema: 'nba_stats', table: 'shot_season_players', query: { season: '2027', select: 'person_id', limit: '50000' } });
        for (const c of rest.filter((x) => x.table !== 'shot_season_players')) {
            expect(c.schema).toBe('nba_stats');
            expect(c.query).toMatchObject({ season: '2027', game_id: '0022600001' });
            expect(Number(c.query.limit)).toBeLessThanOrEqual(Number(UNIT_LIMIT));
        }
        expect(rest.filter((c) => c.table === 'game_lineups_used').map((c) => [c.query.team_id, c.query.order, c.query.limit]).sort())
            .toEqual([['1610612738', '-seconds', UNIT_LIMIT], ['1610612765', '-seconds', UNIT_LIMIT]]);
        expect(r.gameId).toBe('0022600001');
        expect(r.teams).toEqual({ home: 1610612765, away: 1610612738 }); // DET at home
        expect(r.names.find((n) => n.player_id === '1628369')?.name).toBe('Jayson Tatum');
    });
    test('the WNBA reads its own crosswalk columns', async () => {
        const r = await reads(CAPTURES.wnba);
        expect(api.calls[0].query.select).toBe('wnba_game_id,wnba_home_team_id,wnba_away_team_id');
        expect(api.calls.slice(1).every((c) => c.schema === 'wnba_stats')).toBe(true);
        expect(r.gameId).toBe('1022600001');
    });
    test('college: the stats.ncaa.org box by the ESPN game id gives the contest and the names; ESPN team ids key the units', async () => {
        const r = await reads(CAPTURES.mbb);
        expect(api.calls[0]).toMatchObject({ schema: 'mbb', table: 'ncaa_player_box', query: { season: '2026', espn_game_id: '401823425' } });
        for (const c of api.calls.slice(1).filter((x) => x.table !== 'ncaa_player_crosswalk' && x.table !== 'shot_season_players')) expect(c.query).toMatchObject({ season: '2026', game_id: '6388769' });
        expect(r.teams).toEqual({ home: 2084, away: 2572 });
        expect(r.names.find((n) => n.player_id === '9961090')?.name).toBe('Angelo Brizzi');
        // the player links: each side's crosswalk pairs, by ESPN team and season, in the same second round
        expect(api.calls.filter((c) => c.table === 'ncaa_player_crosswalk').map((c) => c.query))
            .toEqual([2084, 2572].map((t) => ({ season: '2026', espn_team_id: String(t), select: 'ncaa_player_id,espn_athlete_id', limit: '80' })));
        // every one of the game's 24 players has a pair, each to a distinct ESPN athlete id, all as strings
        const ids = r.players.map((p) => r.pageIds!.get(String(p.player_id)));
        expect(ids.every((id) => typeof id === 'string' && /^\d+$/.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(r.players.length);
        expect(r.pageIds!.get('9961090')).toBe('4684022'); // Angelo Brizzi
    });
    test("the pros read no crosswalk: their stats ids are the player pages' ids", async () => {
        const r = await reads(CAPTURES.nba);
        expect(api.calls.some((c) => c.table === 'ncaa_player_crosswalk')).toBe(false);
        expect(r.pageIds).toBeNull();
    });
    test('a game the crosswalk (or the stats.ncaa.org box) does not map is empty after one read', async () => {
        expect(await reads({ ...CAPTURES.nba, crosswalk: [] })).toEqual(EMPTY_IMPACT);
        expect(api.calls).toHaveLength(1);
        api.calls.length = 0;
        expect(await reads({ ...CAPTURES.mbb, box: [] })).toEqual(EMPTY_IMPACT);
        expect(api.calls).toHaveLength(1);
    });
    test('a failed read rejects (an outage is never an empty game)', async () => {
        api.fail = true;
        await expect(reads(CAPTURES.nba)).rejects.toThrow('down');
    });
});

describe('impactSide', () => {
    test('each side: its own players by minutes, every one named, and its units with five names', async () => {
        for (const c of [CAPTURES.nba, CAPTURES.wnba, CAPTURES.mbb, CAPTURES.wbb]) {
            const r = await reads(c);
            for (const side of ['home', 'away'] as const) {
                const s = impactSide(r, side);
                expect(s.players.length).toBeGreaterThanOrEqual(5);
                expect(s.players.every((p) => Number(p.team_id) === r.teams![side])).toBe(true);
                expect(s.players.map((p) => p.minutes)).toEqual([...s.players.map((p) => p.minutes)].sort((a, b) => b! - a!));
                expect(s.players.filter((p) => p.name.startsWith('#'))).toEqual([]);
                expect(s.units).toHaveLength(c[side].length); // every unit, the producer's order
                expect(s.units.every((u) => u.names.length === 5 && u.names.every((n) => !n.startsWith('#')))).toBe(true);
            }
        }
    });
    test("each player's page id: the stats id for the pros, the crosswalk's ESPN id in college, none without a pair", async () => {
        const nba = impactSide(await reads(CAPTURES.nba), 'away');
        expect(nba.players.every((p) => p.pageId === String(p.player_id))).toBe(true);
        const mbb = await reads(CAPTURES.mbb);
        expect(impactSide(mbb, 'home').players.find((p) => p.name === 'Angelo Brizzi')?.pageId).toBe('4684022');
        // wbb's captures carry no crosswalk rows: no pair, no page id (the name stays)
        const wbb = impactSide(await reads(CAPTURES.wbb), 'home');
        expect(wbb.players.every((p) => p.pageId === null && !p.name.startsWith('#'))).toBe(true);
    });
    test("a player the season's shot list does not name has no player page, so no page id (pros and college)", async () => {
        const nba = await reads(CAPTURES.nba);
        expect(nba.pages.has('1628369')).toBe(true); // every captured player shot this season
        const noShots = { ...nba, pages: new Set([...nba.pages].filter((id) => id !== '1628369')) };
        expect(impactSide(noShots, 'away').players.find((p) => p.name === 'Jayson Tatum')!.pageId).toBeNull();
        expect(impactSide(noShots, 'away').players.filter((p) => p.pageId === null)).toHaveLength(1);
        const mbb = await reads(CAPTURES.mbb);
        const brizzi = { ...mbb, pages: new Set([...mbb.pages].filter((id) => id !== '4684022')) };
        expect(impactSide(brizzi, 'home').players.find((p) => p.name === 'Angelo Brizzi')?.pageId).toBeNull();
    });
    test('a truncated shot list is a failed read, never a page list missing players', async () => {
        api.pages = { ...EXTRA.pages, 'nba_stats-2027': Array.from({ length: 50000 }, (_, i) => ({ person_id: i })) };
        try { await expect(reads(CAPTURES.nba)).rejects.toThrow('cap'); } finally { api.pages = EXTRA.pages; }
    });
    test('the sides follow the ESPN home and away, not the id order', async () => {
        const r = await reads(CAPTURES.nba);
        expect(impactSide(r, 'away').players.map((p) => p.name)).toContain('Jayson Tatum'); // BOS at DET
    });
    test('a player the box does not name keeps their id, so the side still adds up', async () => {
        const r = { ...(await reads(CAPTURES.nba)), names: [] };
        const s = impactSide(r, 'home');
        expect(s.players.every((p) => p.name === `#${p.player_id}`)).toBe(true);
        expect(s.players.reduce((t, p) => t + p.plus_minus!, 0)).toBe(40); // DET by 8
    });
    test('shortName', () => {
        expect(shortName('Angelo Brizzi')).toBe('A. Brizzi');
        expect(shortName('Betnijah Laney-Hamilton')).toBe('B. Laney-Hamilton');
        expect(shortName('Nene')).toBe('Nene');
        expect(shortName('#9961090')).toBe('#9961090');
    });
});

// BB-G28's Game flow shares the gate and BB-G2's garbage-time toggle sits beside the box: both off here, so these cases are the
// Impact box's alone (test/gameFlow.test.ts and test/garbageTime.test.ts have them)
function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { flagOverrides: { 'bball-game-flow': false, 'bball-garbage-time': false, 'bball-team-grid': false, 'bball-situational-box': false }, ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const procJson = () => read('game_401766458_processor');
const espnPage = (name: string, completed: boolean) => ({ page: { gameId: 401766458, gamepackageJSON: { header: { competitions: [{ date: '2025-04-15T23:30Z', status: { type: { name, completed } }, competitors: [] }] } } }, regressed: false });

describe('prepareBasketballGame with the flag', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    test("'bball-impact-box' is a preview flag", () => { expect(FLAGS['bball-impact-box']).toBe('preview'); });
    test("off (no preview): no read, no impact key, so the page is byte for byte today's", async () => {
        const fn = vi.fn(); box.fn = fn; ingested();
        const r = await prepareBasketballGame(fakeAstro({}).astro, 'nba');
        expect('game' in r).toBe(true);
        expect('impact' in r).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, an ingested final: one read with the season and the ESPN ids, the year-long cache kept', async () => {
        const pre = await reads(CAPTURES.nba);
        const fn = vi.fn(async () => pre); box.fn = fn; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        const s = gameApi().schedule[0];
        expect(fn).toHaveBeenCalledWith('nba', 2025, '401766458', Number(s.home_id), Number(s.away_id));
        expect('impact' in r && r.impact?.gameId).toBe('0022600001');
        expect(cache).toHaveLength(1);
        expect((cache[0] as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, a final the products have not reached: held for the season window, not a year', async () => {
        box.fn = async () => EMPTY_IMPACT; ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: the page renders, the impact is null, nothing is cached', async () => {
        box.fn = async () => { throw new Error('down'); }; ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.impact).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('on, a final with no season (the tables are per season): no read and no panel', async () => {
        const fn = vi.fn(); box.fn = fn;
        const noSeason = gameApi(); noSeason.schedule[0].season = null;
        sched.mockResolvedValueOnce(noSeason.schedule[0]); rows.mockResolvedValueOnce(noSeason);
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
        expect('game' in r && r.game.season).toBeNull();
        expect('impact' in r).toBe(false);
        expect(fn).not.toHaveBeenCalled();
    });
    test('on, a live game or a pregame spends no read', async () => {
        const fn = vi.fn(); box.fn = fn;
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce(espnPage('STATUS_IN_PROGRESS', false));
        const live = procJson(); live.status = { ...live.status, completed: false, name: 'STATUS_IN_PROGRESS' };
        proc.mockResolvedValueOnce(live);
        const r = await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba');
        expect('game' in r && 'impact' in r).toBe(false);
        sched.mockResolvedValueOnce(null);
        espn.mockResolvedValueOnce(espnPage('STATUS_SCHEDULED', false));
        expect('pregame' in (await prepareBasketballGame(fakeAstro({ preview: true }).astro, 'nba'))).toBe(true);
        expect(fn).not.toHaveBeenCalled();
    });
});

const render = (impact: ImpactBoxReads | null, league: string, homeAbbr = 'MIL', awayAbbr = 'CHI') => {
    const game = fromDataApi(gameApi(), 'nba');
    const g = { ...game, home: { ...game.home, team: { ...game.home.team, abbreviation: homeAbbr, displayName: homeAbbr } }, away: { ...game.away, team: { ...game.away.team, abbreviation: awayAbbr, displayName: awayAbbr } } };
    return container.renderToString(NbaImpactBox, { props: { game: g, impact }, locals: { league } as App.Locals });
};
const table = (html: string, label: string) => html.split(`aria-label="${label}"`)[1].split('</table>')[0];

describe('NbaImpactBox', () => {
    test('DET-BOS: both teams have an impact table and their top five units, named, signed, no NaN', async () => {
        const html = await render(await reads(CAPTURES.nba), 'nba', 'DET', 'BOS');
        for (const abbr of ['DET', 'BOS']) {
            expect(table(html, `${abbr} impact`).match(/<tr/g)!.length).toBeGreaterThan(5);
            expect(table(html, `${abbr} lineups used`).match(/<tr/g)).toHaveLength(TOP_UNITS + 1); // header + 5
        }
        expect(table(html, 'BOS impact')).toMatch(/<a href="\/nba\/players\/1628369(\?season=\d+)?">Jayson Tatum<\/a>/);
        expect(table(html, 'BOS lineups used')).toContain('J. Tatum');
        expect(html).toMatch(/>−\d+</); // BOS lost: a negative +/- with a real minus
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('>#');
    });
    test('the rest of the units, by minutes, sit behind a closed "All lineups" toggle', async () => {
        const r = await reads(CAPTURES.nba);
        const html = await render(r, 'nba', 'DET', 'BOS');
        for (const [abbr, key] of [['DET', 'home'], ['BOS', 'away']] as const) {
            const tag = html.match(new RegExp(`<details[^>]*id="impact-${key}-all-lineups"[^>]*>`));
            expect(tag).not.toBeNull();
            expect(tag![0]).not.toContain('open');
            const rest = r.lineups[key].length - TOP_UNITS;
            expect(html.split(`id="impact-${key}-all-lineups"`)[1].split('</details>')[0]).toContain(`All lineups (${rest} more)`);
            expect(table(html, `${abbr} all lineups`).match(/<tr/g)).toHaveLength(rest + 1);
        }
    });
    test('below 10 possessions the ratings are a dash with a reason; at 10 or more they print', async () => {
        const r = await reads(CAPTURES.nba);
        const few = r.players.find((p) => p.poss! < 10)!;
        expect(few).toBeDefined();
        const key = Number(few.team_id) === r.teams!.home ? 'home' : 'away';
        const abbr = key === 'home' ? 'DET' : 'BOS';
        const named = impactSide(r, key).players;
        const html = await render(r, 'nba', 'DET', 'BOS');
        const rowOf = (id: number | string) => table(html, `${abbr} impact`).split(`>${named.find((p) => p.player_id === id)!.name}<`)[1].split('</tr>')[0];
        const dashes = (few.opp_poss! < 10 ? 3 : 2); // ORtg and Net; DRtg on its own (defensive) count
        expect(rowOf(few.player_id).match(/<span title="Fewer than 10 possessions">—<\/span>/g)).toHaveLength(dashes);
        const many = r.players.find((p) => p.poss! >= 10 && p.opp_poss! >= 10 && p.team_id === few.team_id)!;
        expect(rowOf(many.player_id)).not.toContain('Fewer than 10');
        expect(rowOf(many.player_id)).toContain(many.off_rtg!.toFixed(1));
        expect(html).toContain('A rating over fewer than 10 possessions is shown as a dash.');
    });
    test('a player with no page this season is plain text, never a guessed link', async () => {
        const r = await reads(CAPTURES.nba);
        const html = await render({ ...r, pages: new Set([...r.pages].filter((id) => id !== '1628369')) }, 'nba', 'DET', 'BOS');
        expect(table(html, 'BOS impact')).toContain('>Jayson Tatum<');
        expect(table(html, 'BOS impact')).not.toContain('/nba/players/1628369');
        expect(table(html, 'BOS impact')).toMatch(/<a href="\/nba\/players\/\d+/); // his teammates keep theirs
    });
    test('college: Buffalo and Southern Miss, the stats.ncaa.org names', async () => {
        const html = await render(await reads(CAPTURES.mbb), 'mbb', 'BUF', 'USM');
        expect(table(html, 'BUF impact')).toMatch(/<a href="\/mbb\/players\/4684022(\?season=\d+)?">Angelo Brizzi<\/a>/);
        // every player row is linked (all 24 have a pair); the unit names stay plain
        expect(table(html, 'BUF impact').match(/<th scope="row"[^>]*><a href="\/mbb\/players\//g)).toHaveLength(impactSide(await reads(CAPTURES.mbb), 'home').players.length);
        expect(table(html, 'BUF lineups used')).not.toContain('<a ');
        expect(table(html, 'USM lineups used').match(/<tr/g)).toHaveLength(TOP_UNITS + 1);
        expect(html).not.toContain('NaN');
    });
    test('a non-D1 opponent: its side says it has no rows; the D1 side is whole', async () => {
        const html = await render(await reads(CAPTURES.nonD1), 'wbb', 'GW', 'UDC');
        expect(html.split('id="impact-away"')[1].split('id="impact-home"')[0]).toContain('No on-court rows for UDC');
        expect(table(html, 'GW lineups used').match(/<tr/g)).toHaveLength(TOP_UNITS + 1);
        // no crosswalk pairs in this capture: the names are plain text, never a guessed link
        expect(table(html, 'GW impact')).not.toContain('/wbb/players/');
    });
    test('a game season the player pages do not list links nothing', async () => {
        const game = fromDataApi(gameApi(), 'nba');
        const html = await container.renderToString(NbaImpactBox, { props: { game: { ...game, season: 1990 }, impact: await reads(CAPTURES.nba) }, locals: { league: 'nba' } as App.Locals });
        expect(html).toContain('Jayson Tatum');
        expect(html).not.toContain('/nba/players/');
    });
    test('a failed read says unavailable; an unbuilt game says so', async () => {
        expect(await render(null, 'nba')).toContain('id="impact-unavailable"');
        expect(await render(EMPTY_IMPACT, 'nba')).toContain('id="impact-empty"');
    });
});
