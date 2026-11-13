// BB-G37: the game page's in-game lineups (1- to 5-man units, on/off, the on/off picker) inside the Impact box behind
// 'bball-ingame-lineups'. The picker's split, the reads (season-filtered and capped), the page-side step and the template,
// on real Data API reads (fixtures/README.md: ingame-lineups-*.json.gz with the impact-box-*.json.gz games). Every Data
// API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const LEAGUES = {
    nba: { impact: gz('impact-box-nba-2027'), inGame: gz('ingame-lineups-nba') }, // BOS at DET, stats 0022600001
    wnba: { impact: gz('impact-box-wnba-2026'), inGame: gz('ingame-lineups-wnba') }, // CON at NY, stats 1022600001
    mbb: { impact: gz('impact-box-mbb-2026'), inGame: gz('ingame-lineups-mbb') }, // Southern Miss at Buffalo, contest 6388769
    wbb: { impact: gz('impact-box-wbb-2026'), inGame: gz('ingame-lineups-wbb') }, // GW at Temple, contest 6387150
} as const;

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ cap: null as any, inGame: null as any, calls: [] as { schema: string; table: string; query: Record<string, string> }[], fail: '' }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail === table) throw new Error('down');
        const c = api.cap;
        if (table === 'schedule_crosswalk') return c.crosswalk ?? [];
        if (table === 'player_box') return c.names ?? [];
        if (table === 'ncaa_player_box') return c.box ?? [];
        if (table === 'game_player_impact') return c.players;
        if (table === 'game_lineups_used') {
            const x = c.crosswalk?.[0];
            const home = x ? x[`${c.league}_home_team_id`] : c.schedule[0].home_id;
            return String(query.team_id) === String(home) ? c.home : c.away;
        }
        if (table === 'game_units') return api.inGame.units;
        if (table === 'game_on_off') return api.inGame.onoff;
        if (table === 'team_season_rates') return api.inGame.season ?? [];
        // BB-G1's player-page reads (links only): none needed here
        if (table === 'shot_season_players' || table === 'ncaa_player_crosswalk') return [];
        throw new Error(`unexpected table ${table}`);
    },
}));
const box = vi.hoisted(() => ({ fn: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/impactBox', async (orig) => {
    const real = await orig<typeof import('../src/resources/impactBox')>();
    return { ...real, retrieveImpactBox: (...a: Parameters<typeof real.retrieveImpactBox>) => (box.fn ? box.fn(...a) : real.retrieveImpactBox(...a)) };
});
const sched = vi.fn(), rows = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaImpactBox from '../src/components/nba/game/NbaImpactBox.astro';
import { retrieveImpactBox, retrieveInGameLineups, GAME_UNIT_LIMIT, type ImpactBoxReads, type InGameReads } from '../src/resources/impactBox';
import { fromDataApi } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { allCombos, bigSample, inGameSide, pickSplit, unitKey } from '../src/utils/inGameLineups';

type L = keyof typeof LEAGUES;
const reads = async (lg: L, inGame = true): Promise<ImpactBoxReads> => {
    const c = LEAGUES[lg];
    api.cap = c.impact; api.inGame = c.inGame;
    const s = c.impact.schedule[0];
    return retrieveImpactBox(c.impact.league, c.impact.season, c.impact.espnGameId, Number(s.home_id), Number(s.away_id), inGame);
};
const asReads = (lg: L): InGameReads => ({ units: LEAGUES[lg].inGame.units, onOff: LEAGUES[lg].inGame.onoff, season: LEAGUES[lg].inGame.season });
const sideOf = (lg: L, teamId: number) => inGameSide(asReads(lg), teamId, (id) => id);
const teamIds = (lg: L) => [...new Set<number>(LEAGUES[lg].inGame.onoff.map((r: any) => Number(r.team_id)))];
const ids5 = (u: any) => [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].filter((p) => p != null).map(String);

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { api.calls.length = 0; api.fail = ''; box.fn = null; [sched, rows, proc, espn].forEach((f) => f.mockReset()); });

describe('the captures', () => {
    test('two teams, every size 1..5, a one-man unit for every on/off player with his on totals', () => {
        for (const lg of Object.keys(LEAGUES) as L[]) {
            for (const t of teamIds(lg)) {
                const s = sideOf(lg, t);
                for (const n of [1, 2, 3, 4, 5]) expect(s.units[n].length, `${lg} ${t} ${n}`).toBeGreaterThan(0);
                for (const r of s.onOff) {
                    const one = s.units[1].find((u) => String(u.player_1) === String(r.player_id))!;
                    expect([one.poss, one.opp_poss, one.pts, one.opp_pts]).toEqual([r.poss_on, r.opp_poss_on, r.pts_on, r.opp_pts_on]);
                }
            }
        }
    });
});

describe('pickSplit', () => {
    // ground truth from the five-man rows alone: the stretches whose five include every ON player and no OFF player
    const truth = (lg: L, t: number, on: string[], off: string[]) => {
        const sum = [0, 0, 0, 0];
        for (const u of sideOf(lg, t).units[5]) {
            const p = ids5(u);
            if (on.every((x) => p.includes(x)) && !off.some((x) => p.includes(x))) [u.poss, u.opp_poss, u.pts, u.opp_pts].forEach((v, i) => (sum[i] += v));
        }
        return sum;
    };
    test('no one chosen is the team game; one player ON / OFF is his on / off row', () => {
        for (const lg of Object.keys(LEAGUES) as L[]) for (const t of teamIds(lg)) {
            const s = sideOf(lg, t);
            const r = s.onOff[0];
            const whole = pickSplit(s.picker!, [], []);
            expect([whole.poss, whole.pts]).toEqual([r.poss_on + r.poss_off, r.pts_on + r.pts_off]);
            const on = pickSplit(s.picker!, [String(r.player_id)], []);
            const off = pickSplit(s.picker!, [], [String(r.player_id)]);
            expect([on.poss, on.opp_poss, on.pts, on.opp_pts]).toEqual([r.poss_on, r.opp_poss_on, r.pts_on, r.opp_pts_on]);
            expect([off.poss, off.opp_poss, off.pts, off.opp_pts]).toEqual([r.poss_off, r.opp_poss_off, r.pts_off, r.opp_pts_off]);
            expect(off.minutes).toBeCloseTo(r.minutes_off!, 3);
        }
    });
    test('mixed ON/OFF sets of up to five players match the five-man stretches (inclusion-exclusion is exact)', () => {
        for (const lg of Object.keys(LEAGUES) as L[]) for (const t of teamIds(lg)) {
            const s = sideOf(lg, t);
            // only exact where every stretch lists five players (the identity BB-D32 states); the captures all do
            const fiveSum = s.units[5].reduce((a, u) => a + u.poss, 0);
            expect(fiveSum).toBe(pickSplit(s.picker!, [], []).poss);
            const top = s.onOff.slice(0, 6).map((r) => String(r.player_id));
            for (const [on, off] of [[top.slice(0, 2), top.slice(2, 4)], [top.slice(0, 1), top.slice(1, 5)], [[], top.slice(0, 3)], [top.slice(0, 3), [top[5]]], [top.slice(0, 5), []]]) {
                const p = pickSplit(s.picker!, on, off);
                expect([p.poss, p.opp_poss, p.pts, p.opp_pts], `${lg} ${t} on ${on} off ${off}`).toEqual(truth(lg, t, on, off));
            }
        }
    });
    test('ratings follow the totals; a split that never happened is zero with no rating', () => {
        const s = sideOf('nba', teamIds('nba')[0]);
        const [a] = s.onOff.map((r) => String(r.player_id));
        const p = pickSplit(s.picker!, [a], []);
        expect(p.off_rtg).toBeCloseTo((100 * p.pts) / p.poss, 9);
        expect(p.plus_minus).toBe(p.pts - p.opp_pts);
        // six of one side's players can never share the floor: five ON plus the sixth ON is past the cap; five ON is fine
        const never = pickSplit(s.picker!, ['no-such-player'], []);
        expect([never.minutes, never.poss, never.off_rtg, never.net_rtg]).toEqual([0, 0, null, null]);
        expect(() => pickSplit(s.picker!, s.onOff.slice(0, 6).map((r) => String(r.player_id)), [])).toThrow();
    });
    test('allCombos: 2^k splits for up to four players, adding up to the team game', () => {
        const s = sideOf('mbb', teamIds('mbb')[0]);
        const four = s.onOff.slice(0, 4).map((r) => String(r.player_id));
        const c = allCombos(s.picker!, four);
        expect(c).toHaveLength(16);
        expect(c[0].off).toEqual([]);
        expect(c.reduce((a, x) => a + x.split.poss, 0)).toBe(pickSplit(s.picker!, [], []).poss);
        expect(allCombos(s.picker!, s.onOff.slice(0, 5).map((r) => String(r.player_id)))).toEqual([]);
    });
    test('unitKey and bigSample', () => {
        expect(unitKey(['9', '10', '1'])).toBe('1-10-9');
        // offensive possessions only (Q28): 5 + 5 is not 10 of them
        expect(bigSample({ minutes: 5, poss: 10 })).toBe(true);
        expect(bigSample({ minutes: 5, poss: 5 })).toBe(false);
        expect(bigSample({ minutes: 4.9, poss: 50 })).toBe(false);
        expect(bigSample({ minutes: 20, poss: 9 })).toBe(false);
    });
    test('the stricter gate hides more real units than offense plus defense did', () => {
        for (const lg of Object.keys(LEAGUES) as L[]) {
            const u = LEAGUES[lg].inGame.units;
            const old = u.filter((x: any) => x.minutes >= 5 && x.poss + x.opp_poss >= 10).length;
            expect(u.filter(bigSample).length, lg).toBeLessThanOrEqual(old);
        }
    });
    test("each side's season net rating is the producer's team_season_rates row, in the impact tables' id space", () => {
        const want = { nba: [1610612738, 11.36], wnba: [1611661313, 3.93], mbb: [2084, 2.25], wbb: [45, 0.67] } as const;
        for (const [lg, [id, net]] of Object.entries(want) as [L, readonly [number, number]][]) {
            const s = sideOf(lg, id).seasonNet;
            expect(s?.net_rtg, lg).toBeCloseTo(net, 2);
            expect(s?.games, lg).toBeGreaterThan(0);
        }
        expect(inGameSide({ ...asReads('nba'), season: [] }, 1610612738, (id) => id).seasonNet).toBeNull();
    });
});

describe('the reads', () => {
    test('retrieveInGameLineups: three reads in the season schema, season-filtered, the game ones by the producer game id, capped', async () => {
        api.inGame = LEAGUES.wnba.inGame;
        const r = await retrieveInGameLineups('wnba', 2026, '1022600001');
        expect(r.units.length).toBe(LEAGUES.wnba.inGame.units.length);
        expect(api.calls.map((c) => [c.schema, c.table, c.query.season, c.query.game_id])).toEqual([['wnba_stats', 'game_units', '2026', '1022600001'], ['wnba_stats', 'game_on_off', '2026', '1022600001'], ['wnba_stats', 'team_season_rates', '2026', undefined]]);
        expect(api.calls[2].query.split).toBe('all');
        expect(r.season.length).toBe(15);
        expect(api.calls.every((c) => Number(c.query.limit) > 0 && c.query.select)).toBe(true);
    });
    test('a units read at its cap is a failure, never a short table', async () => {
        api.inGame = { units: Array.from({ length: GAME_UNIT_LIMIT }, () => LEAGUES.nba.inGame.units[0]), onoff: [] };
        await expect(retrieveInGameLineups('nba', 2027, '0022600001')).rejects.toThrow(/cap/);
    });
    test('with the impact box: one round more, the college reads by the contest id; without the flag no units read', async () => {
        const r = await reads('mbb');
        expect(r.inGame?.units.length).toBe(LEAGUES.mbb.inGame.units.length);
        expect(api.calls.find((c) => c.table === 'game_units')?.query.game_id).toBe('6388769');
        api.calls.length = 0;
        const off = await reads('mbb', false);
        expect('inGame' in off).toBe(false);
        expect(api.calls.some((c) => c.table === 'game_units' || c.table === 'game_on_off')).toBe(false);
    });
    test("a failed units read is the section's own (null); the impact box stands", async () => {
        api.fail = 'game_on_off';
        const r = await reads('nba');
        expect(r.players.length).toBeGreaterThan(0);
        expect(r.inGame).toBeNull();
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { flagOverrides: { 'bball-game-flow': false, 'bball-garbage-time': false }, ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());
const gameApi = () => read('game_401766458_api');
const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };

describe('prepareBasketballGame', () => {
    test("'bball-ingame-lineups' is a preview flag", () => { expect(FLAGS['bball-ingame-lineups']).toBe('preview'); });
    test('the flag rides the Impact box read; off (or no impact box) asks for no units', async () => {
        const seen: unknown[] = [];
        box.fn = (...a: unknown[]) => { seen.push(a[5]); return Promise.resolve({ gameId: 'x', teams: { home: 1, away: 2 }, players: [{}], lineups: { home: [], away: [] }, names: [], ...(a[5] ? { inGame: { units: [], onOff: [], season: [] } } : {}) }); };
        for (const overrides of [{}, { 'bball-ingame-lineups': false }]) {
            ingested();
            const { astro } = fakeAstro({ preview: true });
            astro.locals.flagOverrides = { ...astro.locals.flagOverrides, ...overrides };
            await prepareBasketballGame(astro, 'nba');
        }
        expect(seen).toEqual([true, false]);
        ingested();
        const { astro } = fakeAstro({ preview: true });
        astro.locals.flagOverrides = { ...astro.locals.flagOverrides, 'bball-impact-box': false };
        await prepareBasketballGame(astro, 'nba');
        expect(seen).toHaveLength(2);
    });
    test('a failed units read keeps the page and caches nothing', async () => {
        box.fn = () => Promise.resolve({ gameId: 'x', teams: { home: 1, away: 2 }, players: [{}], lineups: { home: [], away: [] }, names: [], inGame: null });
        ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r: any = await prepareBasketballGame(astro, 'nba');
        expect(r.impact.inGame).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('impact rows but no units yet (BB-D32 a night behind): held for the season window, not the final\'s year', async () => {
        box.fn = () => Promise.resolve({ gameId: 'x', teams: { home: 1, away: 2 }, players: [{}], lineups: { home: [], away: [] }, names: [], inGame: { units: [], onOff: [], season: [] } });
        ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        await prepareBasketballGame(astro, 'nba');
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
});

const render = (impact: ImpactBoxReads | null, fromLog = false, homeAbbr = 'DET', awayAbbr = 'BOS') => {
    const game = fromDataApi(gameApi(), 'nba');
    const g = { ...game, home: { ...game.home, team: { ...game.home.team, abbreviation: homeAbbr, displayName: homeAbbr } }, away: { ...game.away, team: { ...game.away.team, abbreviation: awayAbbr, displayName: awayAbbr } } };
    return container.renderToString(NbaImpactBox, { props: { game: g, impact, fromLog }, locals: { league: 'nba' } as App.Locals });
};
const table = (html: string, label: string) => html.split(`aria-label="${label}"`)[1].split('</table>')[0];

describe('NbaImpactBox with the in-game lineups', () => {
    test('DET-BOS: each side has its five-man units (small samples hidden), its on/off and the picker, named, no NaN', async () => {
        const r = await reads('nba');
        const html = await render(r);
        for (const abbr of ['DET', 'BOS']) {
            expect(html).toContain(`aria-label="${abbr} 5-man units"`);
            expect(table(html, `${abbr} on/off`).match(/<tr/g)!.length).toBeGreaterThan(5);
            expect(html).toContain(`aria-label="${abbr} on/off split"`);
        }
        expect(table(html, 'BOS on/off')).toContain('Jayson Tatum');
        expect(table(html, 'BOS 5-man units')).toContain('J. Tatum');
        const shown = table(html, 'BOS 5-man units').match(/<tr/g)!.length - 1;
        const bos = inGameSide(r.inGame!, r.teams!.away, (id) => id).units[5];
        expect(shown).toBe(bos.filter(bigSample).length);
        expect(html).toContain('<astro-island');
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('id="ingame-note"');
        expect(html).toContain("BOS's season net rating: <span class=\"fw-bold text-body\">+11.4</span> (12 games)");
        expect(html).toContain('10+ <abbr title="Offensive possessions">off. poss</abbr>');
    });
    test('college: the stats.ncaa.org names on the units', async () => {
        api.cap = LEAGUES.wbb.impact;
        const html = await render(await reads('wbb'), false, 'TEM', 'GW');
        expect(html).toContain('aria-label="TEM on/off"');
        expect(html).not.toContain('>#');
    });
    test('notes: a failed read, a season not built, the garbage-time split; nothing with the flag off', async () => {
        const r = await reads('nba');
        expect(await render({ ...r, inGame: null })).toContain('temporarily unavailable');
        expect(await render({ ...r, inGame: { units: [], onOff: [], season: [] } })).toContain('not built for this game yet');
        const split = await render(r, true);
        expect(split).toContain('left out of the garbage-time split');
        expect(split).not.toContain('5-man units');
        const { inGame: _, ...flagOff } = r;
        const off = await render(flagOff as ImpactBoxReads);
        expect(off).not.toContain('ingame');
        expect(off).not.toContain('<astro-island');
    });
});
