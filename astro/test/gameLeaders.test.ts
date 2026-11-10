// BB-G35: the game page's Leaders panel behind 'bball-game-leaders'. Leaders against the raw player box, the assist web
// against the play-by-play's own text and the box's assists, the season averages' pivot and read, the route's gate and
// cache, and the page: panel shown, hidden, and the flag-off page byte for byte. Fixtures: the four leagues' ingested
// finals (fixtures/<lg>/game_*_api.json) with their assisters and season averages captured from the Data API
// (fixtures/README.md: game-leaders-*.json.gz). Every Data API read here is mocked.
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

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: (_q: Record<string, string>) => [] as any[], fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'player_season_stats') return api.rows(query);
        throw new Error(`unexpected table ${table}`);
    },
}));
const hook = vi.hoisted(() => ({ averages: null as null | ((...a: unknown[]) => unknown) }));
vi.mock('../src/resources/seasonAverages', async (orig) => {
    const real = await orig<typeof import('../src/resources/seasonAverages')>();
    return { ...real, retrieveSeasonAverages: (...a: Parameters<typeof real.retrieveSeasonAverages>) => (hook.averages ? hook.averages(...a) : real.retrieveSeasonAverages(...a)) };
});
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { pivotSeasonAverages, retrieveSeasonAverages } from '../src/resources/seasonAverages';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { assistWeb, leaderOf, leaderRows, overUnder, statOf, TS_MIN_ATTEMPTS, zoneOf, type SeasonAverage } from '../src/utils/gameLeaders';
import type { BasketballLeague } from '../src/utils/league';

type Lg = 'nba' | 'wnba' | 'mbb' | 'wbb';
interface Capture { league: Lg; espnGameId: string; season: number; assists: { game_play_number: number; athlete_id_2: number | null }[]; averages: { home: Record<string, any>[]; away: Record<string, any>[] } }
const FIX: Record<Lg, string> = { nba: 'nba/game_401766458_api', wnba: 'wnba/game_401736287_api', mbb: 'mbb/game_401820775_api', wbb: 'wbb/game_401805076_api' };
const LEAGUES = Object.keys(FIX) as Lg[];
const json = (p: string) => JSON.parse(readFileSync(new URL(`./fixtures/${p}.json`, import.meta.url)).toString());
const gz = (p: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${p}.json.gz`, import.meta.url))).toString());
const cap = Object.fromEntries(LEAGUES.map((lg) => [lg, gz(`game-leaders-${lg}-${FIX[lg].split('_')[1]}`) as Capture])) as Record<Lg, Capture>;
/** The ingested final's rows with the captured assister on each play (the fixtures predate athlete_id_2 in the select). */
function rowsOf(lg: Lg) {
    const r = json(FIX[lg]);
    const by = new Map(cap[lg].assists.map((a) => [Number(a.game_play_number), a.athlete_id_2]));
    r.pbp = r.pbp.map((p: any) => ({ ...p, athlete_id_2: by.get(Number(p.game_play_number)) ?? null }));
    return r;
}
const gameOf = (lg: Lg): NbaGame => fromDataApi(rowsOf(lg), lg);
const averagesOf = (lg: Lg): SeasonAverage[] => pivotSeasonAverages([...cap[lg].averages.home, ...cap[lg].averages.away], lg);
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const played = (r: any) => !(r.did_not_play === true || r.did_not_play === 'True' || r.did_not_play === 'true');

describe('leaders, against the raw player box', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: every count category is the box's maximum among the players who played`, () => {
            const raw = json(FIX[lg]), g = gameOf(lg);
            for (const ha of ['home', 'away'] as const) {
                const tid = Number(raw.schedule[0][`${ha}_id`]);
                const box = raw.player_box.filter((p: any) => Number(p.team_id) === tid && played(p));
                const col: Record<string, string> = { pts: 'points', reb: 'rebounds', ast: 'assists', stl: 'steals', blk: 'blocks', tov: 'turnovers', fgm: 'field_goals_made', fg3m: 'three_point_field_goals_made', fta: 'free_throws_attempted' };
                for (const [key, c] of Object.entries(col)) {
                    const max = Math.max(...box.map((p: any) => num(p[c]) ?? -Infinity));
                    const l = leaderOf(g[ha], key);
                    if (max <= 0) { expect(l, `${ha} ${key}`).toBeNull(); continue; }
                    expect(l!.value, `${ha} ${key}`).toBe(max);
                    expect(new Set(l!.players.map((p) => p.athlete_id))).toEqual(new Set(box.filter((p: any) => num(p[c]) === max).map((p: any) => Number(p.athlete_id))));
                }
                const ts = leaderOf(g[ha], 'ts');
                if (ts) for (const p of ts.players) {
                    const [fga, fta] = [num(raw.player_box.find((r: any) => Number(r.athlete_id) === p.athlete_id).field_goals_attempted)!, num(raw.player_box.find((r: any) => Number(r.athlete_id) === p.athlete_id).free_throws_attempted)!];
                    expect(fga + 0.44 * fta).toBeGreaterThanOrEqual(TS_MIN_ATTEMPTS);
                    expect(ts.value).toBeCloseTo(p.points! / (2 * (fga + 0.44 * fta)), 12);
                }
            }
        });
    }
    test('plus-minus: a row for the pros (its leader is the box\'s best), none in college (the source has none)', () => {
        for (const lg of ['nba', 'wnba'] as const) {
            const g = gameOf(lg), raw = json(FIX[lg]);
            const best = Math.max(...raw.player_box.filter((p: any) => Number(p.team_id) === Number(g.home.team.id) && played(p) && p.plus_minus != null).map((p: any) => Number(p.plus_minus)));
            expect(leaderOf(g.home, 'pm')!.value).toBe(best);
        }
        for (const lg of ['mbb', 'wbb'] as const) expect(leaderRows(gameOf(lg).home, gameOf(lg).away).map((r) => r.cat.key)).not.toContain('pm');
    });
    test('a tie lists every player at the top; a count nobody recorded has no leader; a DNP never leads', () => {
        const g = gameOf('nba');
        const [a, b] = g.home.players.filter((p) => !p.did_not_play);
        const side = { ...g.home, players: g.home.players.map((p) => (p === a || p === b ? { ...p, steals: 9, blocks: 0 } : { ...p, blocks: 0 })) };
        expect(leaderOf(side, 'stl')!.players.map((p) => p.athlete_id).sort()).toEqual([a.athlete_id, b.athlete_id].sort());
        expect(leaderOf(side, 'blk')).toBeNull();
        expect(leaderOf({ ...side, players: side.players.map((p) => ({ ...p, did_not_play: true })) }, 'pts')).toBeNull();
        expect(statOf('pm', { ...a, plus_minus: '-7' })).toBe(-7);
        expect(statOf('fgm', { ...a, fg: '–' })).toBeNull();
    });
});

describe('assist web, against the play-by-play text and the box', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: every assisted shot names its passer in the text, every pair is a teammate, and the box's assists are covered`, () => {
            const g = gameOf(lg);
            expect(g.plays.some((p) => p.athleteId2 != null)).toBe(true);
            for (const ha of ['home', 'away'] as const) {
                const side = g[ha], tid = Number(side.team.id);
                const web = assistWeb(g.plays, side);
                expect(web.linked).toBe(true);
                const roster = new Map(side.players.map((p) => [p.athlete_id, p]));
                for (const pr of web.pairs) { expect(roster.has(pr.passer)).toBe(true); expect(roster.has(pr.scorer)).toBe(true); expect(pr.passer).not.toBe(pr.scorer); }
                expect(web.pairs.reduce((t, p) => t + p.ast, 0)).toBe(web.assisted);
                // each pair is the plays' own passer -> scorer, counted independently here
                const want = new Map<string, number>();
                for (const p of g.plays) if (p.teamId === tid && p.scoringPlay && p.scoreValue >= 2 && p.athleteId2 != null) want.set(`${p.athleteId2}>${p.athleteId}`, (want.get(`${p.athleteId2}>${p.athleteId}`) ?? 0) + 1);
                expect(new Map(web.pairs.map((pr) => [`${pr.passer}>${pr.scorer}`, pr.ast]))).toEqual(want);
                // the feed's text and its second athlete agree: "(X assists)" / "Assisted by X" on exactly the linked makes
                const makes = g.plays.filter((p) => p.teamId === tid && p.scoringPlay && p.scoreValue >= 2);
                for (const p of makes) {
                    const says = /assist/i.test(p.text);
                    expect(p.athleteId2 != null, `${lg} ${p.text}`).toBe(says);
                    if (says) expect(p.text, p.text).toContain(roster.get(p.athleteId2!)!.name.split(' ').at(-1)!);
                }
                expect(web.assisted).toBeLessThanOrEqual(web.boxAssists!);
                expect(web.assisted).toBeGreaterThanOrEqual(Math.ceil(web.boxAssists! * 0.85));
                // every point of the team's scoring plays lands in one zone: the box's final score (not the feed's running
                // score, which ESPN can leave a point off: the ORL final's 119 for 120)
                const pts = Object.values(web.zones).reduce((t, z) => t + z.assisted + z.unassisted, 0);
                expect(pts).toBe(side.box!.team_score);
                expect(web.zones.ft.assisted).toBe(0);
            }
        });
    }
    test('zones by shot type: both feeds\' rim words, other twos, threes and free throws', () => {
        const p = (typeText: string, scoreValue: number) => ({ typeText, text: '', scoreValue } as any);
        expect(['LayUpShot', 'Driving Layup Shot', 'DunkShot', 'Alley Oop Dunk Shot', 'TipShot', 'Putback Layup', 'Finger Roll Layup'].map((t) => zoneOf(p(t, 2)))).toEqual(Array(7).fill('rim'));
        expect(['JumpShot', 'Pullup Jump Shot', 'Hook Shot', 'Floating Jump Shot'].map((t) => zoneOf(p(t, 2)))).toEqual(Array(4).fill('two'));
        expect(zoneOf(p('Step Back Jump Shot', 3))).toBe('three');
        expect(zoneOf(p('Free Throw - 1 of 2', 1))).toBe('ft');
    });
    test('a feed with no second athletes (an older processor payload): not linked, every point unassisted, no pairs', () => {
        const g = gameOf('nba');
        const web = assistWeb(g.plays.map((p) => ({ ...p, athleteId2: null })), g.home);
        expect([web.linked, web.pairs.length, web.assisted]).toEqual([false, 0, 0]);
        // a block's or a steal's second athlete alone is not a linked feed
        const others = assistWeb(g.plays.map((p) => (p.scoringPlay ? { ...p, athleteId2: null } : p)), g.home);
        expect(g.plays.some((p) => !p.scoringPlay && p.athleteId2 != null)).toBe(true);
        expect(others.linked).toBe(false);
    });
});

describe('against their average', () => {
    for (const lg of LEAGUES) {
        test(`${lg}: the pivot is the captured rows, and each listed player is 8+ minutes and points minus that average`, () => {
            const avgs = averagesOf(lg);
            // the pros' and MBB's tables have the rosters; WBB 2026 has one or two players a team (all career lines)
            if (lg === 'wbb') { expect(avgs).toEqual([]); return; }
            expect(avgs.length).toBeGreaterThan(lg === 'wnba' ? 3 : 10);
            const g = gameOf(lg);
            for (const ha of ['home', 'away'] as const) {
                const raw = cap[lg].averages[ha];
                const { over, under } = overUnder(g[ha], avgs);
                expect(over.length + under.length).toBeGreaterThan(0);
                expect(over.length).toBeLessThanOrEqual(3);
                expect(under.length).toBeLessThanOrEqual(3);
                for (const r of [...over, ...under]) {
                    expect(r.player.minutes!).toBeGreaterThanOrEqual(8);
                    const want = raw.find((x) => Number(x.athlete_id) === r.player.athlete_id && x.stat_name === 'avgPoints')!;
                    expect(r.avg.pts).toBe(Number(want.value));
                    expect(r.delta).toBeCloseTo(r.player.points! - Number(want.value), 12);
                }
                for (let i = 1; i < over.length; i++) expect(over[i - 1].delta).toBeGreaterThanOrEqual(over[i].delta);
                for (let i = 1; i < under.length; i++) expect(under[i - 1].delta).toBeLessThanOrEqual(under[i].delta);
                expect(over.every((r) => r.delta > 0) && under.every((r) => r.delta < 0)).toBe(true);
            }
        });
    }
    test('a player with no average, or whose only game is this one, is left out', () => {
        const g = gameOf('nba');
        const top = g.home.players.filter((p) => (p.minutes ?? 0) >= 8)[0];
        const avgs = averagesOf('nba');
        const without = avgs.filter((a) => a.athleteId !== top.athlete_id);
        const once = [...without, { athleteId: top.athlete_id, gp: 1, pts: 0, reb: 0, ast: 0 }];
        for (const a of [without, once]) {
            const { over, under } = overUnder(g.home, a);
            expect([...over, ...under].some((r) => r.player.athlete_id === top.athlete_id)).toBe(false);
        }
    });
});

describe('retrieveSeasonAverages', () => {
    beforeEach(() => { api.calls.length = 0; api.fail = false; hook.averages = null; });
    test('one read per side from the games schema, season-filtered, capped, pivoted', async () => {
        api.rows = (q) => (q.team_id === '19' ? cap.nba.averages.home : cap.nba.averages.away);
        const got = await retrieveSeasonAverages('nba', 2025, '401766458', 19, 1);
        expect(api.calls.map((c) => [c.schema, c.table, c.query.season, c.query.team_id, c.query.limit])).toEqual([['nba', 'player_season_stats', '2025', '19', '5000'], ['nba', 'player_season_stats', '2025', '1', '5000']]);
        expect(got).toEqual(averagesOf('nba'));
        for (const lg of ['wnba', 'mbb', 'wbb'] as const) {
            api.calls.length = 0;
            await retrieveSeasonAverages(lg, cap[lg].season, cap[lg].espnGameId, 1, 2);
            expect(api.calls.map((c) => c.schema)).toEqual([lg, lg]);
        }
    });
    test('a failed read or a read at the cap rejects', async () => {
        api.fail = true;
        await expect(retrieveSeasonAverages('nba', 2025, '401766458', 19, 1)).rejects.toThrow();
        api.fail = false;
        api.rows = () => Array(5000).fill({ athlete_id: 1, stat_name: 'avgPoints', value: 1 });
        await expect(retrieveSeasonAverages('nba', 2025, '401766458', 19, 1)).rejects.toThrow(/cap/);
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    const off = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false };
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { ...locals, flagOverrides: { ...off, ...(locals.flagOverrides as object) } }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame', () => {
    const ingested = () => { const r = rowsOf('nba'); sched.mockResolvedValueOnce(r.schedule[0]); rows.mockResolvedValueOnce(r); };
    const afn = vi.fn();
    beforeEach(() => { [sched, rows, afn].forEach((f) => f.mockReset()); hook.averages = afn; afn.mockResolvedValue(averagesOf('nba')); });
    test("'bball-game-leaders' is a preview flag", () => { expect(FLAGS['bball-game-leaders']).toBe('preview'); });
    test('off: no read and no averages key', async () => {
        ingested();
        expect('averages' in (await prepareBasketballGame(fakeAstro({ preview: true, flagOverrides: { 'bball-game-leaders': false } }).astro, 'nba'))).toBe(false);
        ingested();
        expect('averages' in (await prepareBasketballGame(fakeAstro({}).astro, 'nba'))).toBe(false); // no preview cookie
        expect(afn).not.toHaveBeenCalled();
    });
    test('on: one read with the season and the ESPN ids; the final then follows the season window, not a year', async () => {
        ingested();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        const s = rowsOf('nba').schedule[0];
        expect(afn).toHaveBeenCalledWith('nba', 2025, '401766458', Number(s.home_id), Number(s.away_id));
        expect('game' in r && r.averages).toEqual(averagesOf('nba'));
        expect(cache.at(-1)).toEqual({ maxAge: 6 * 60 * 60, swr: 6 * 60 * 60, tags: ['nba'] });
        // no averages yet (the season table lags the final): still the season window, so they appear once built
        afn.mockResolvedValue([]); ingested();
        const empty = fakeAstro({ preview: true });
        expect('game' in (await prepareBasketballGame(empty.astro, 'nba'))).toBe(true);
        expect(empty.cache.at(-1)).toEqual({ maxAge: 6 * 60 * 60, swr: 6 * 60 * 60, tags: ['nba'] });
    });
    test('on, a failed read: averages null, the page renders, nothing is cached', async () => {
        afn.mockRejectedValue(new Error('down')); ingested();
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.averages).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const normalize = (html: string) => html.replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
const page = async (lg: BasketballLeague, game: NbaGame, on: boolean, averages?: SeasonAverage[] | null) => normalize(await container.renderToString(NbaGamePage, {
    props: { game, ...(averages !== undefined ? { averages } : {}) },
    locals: { league: lg, preview: true, flagOverrides: { 'bball-game-leaders': on } } as unknown as App.Locals,
}));
const table = (html: string, label: string) => html.split(`aria-label="${label}"`)[1].split('</table>')[0];

describe('NbaGamePage', () => {
    test('off: no panel, no nav entry, and the page is the one without the averages prop', async () => {
        const g = gameOf('nba');
        const off = await page('nba', g, false);
        expect(off).not.toContain('id="leaders"');
        expect(off).not.toContain('#leaders');
        expect(await page('nba', g, false, averagesOf('nba'))).toBe(off);
    });
    test('on: the panel after the box score and its nav entry, and nothing else changes', async () => {
        const g = gameOf('nba');
        const off = await page('nba', g, false);
        const on = await page('nba', g, true, averagesOf('nba'));
        expect(on.indexOf('id="leaders"')).toBeGreaterThan(on.indexOf('id="players"'));
        expect(on.indexOf('id="leaders"')).toBeLessThan(on.indexOf('id="shots"'));
        // without the panel and its two nav entries (the links and the mobile select), the page is the flag-off one
        const strip = (h: string) => h.replace(/<div class="panel-group" id="leaders-panel">[\s\S]*?(?=<div class="panel-group" id="shots-panel">)/, '')
            .replace('<a href="#leaders" class="p-2 link-secondary">Leaders</a>', '').replace('<option value="#leaders">Leaders</option>', '');
        expect(strip(on)).toBe(off);
        expect(on).toContain('href="#leaders"');
        expect(on).not.toContain('NaN');
        expect(on).not.toContain('undefined');
        // the leader cells, by position: the away column first, then home (the header's order)
        const cells = (label: string) => table(on, 'Game leaders').split(`>${label}</abbr>`)[1].split('</tr>')[0].split('<td').slice(1).map((c) => c.replace(/^[^>]*>/, '').replace(/<[^>]+>/g, ''));
        const cell = (s: typeof g.home, key: string) => { const l = leaderOf(s, key)!; return `${l.value} ${l.players.map((p) => p.short_name || p.name).join(', ')}`; };
        expect(cells('PTS')).toEqual([cell(g.away, 'pts'), cell(g.home, 'pts')]);
        // a tie: every name, comma-separated (ORL's two-way tie for steals in this final)
        expect(leaderOf(g.home, 'stl')!.players.length).toBeGreaterThan(1);
        expect(cells('STL')).toEqual([cell(g.away, 'stl'), cell(g.home, 'stl')]);
        expect(on).toContain('id="leaders-over-under"');
        expect(on).toContain('id="assist-web-home"');
        expect(off.length).toBeLessThan(on.length);
    });
    test('live (no averages read): leaders and the assist web, no "against their average"; a failed read says so', async () => {
        const g = gameOf('nba');
        const live = await page('nba', g, true);
        expect(live).toContain('aria-label="Game leaders"');
        expect(live).not.toContain('Against their average');
        expect(await page('nba', g, true, null)).toContain('id="leaders-averages-unavailable"');
    });
    test('college: no plus-minus row; every league renders the three parts', async () => {
        for (const lg of LEAGUES) {
            const html = await page(lg, gameOf(lg), true, averagesOf(lg));
            expect(html).toContain('id="leaders-over-under"');
            expect(html).toContain(`aria-label="${gameOf(lg).home.team.abbreviation}`);
            expect(table(html, 'Game leaders').includes('>+/-<')).toBe(lg === 'nba' || lg === 'wnba');
            expect(html).not.toContain('NaN');
        }
    });
    test('a feed that links no assists: a note in place of the web', async () => {
        const g = gameOf('wbb');
        const html = await page('wbb', { ...g, plays: g.plays.map((p) => ({ ...p, athleteId2: null })) }, true);
        expect(html).toContain('does not say who assisted whom');
        expect(html).not.toContain('assists by passer and scorer');
    });
});
