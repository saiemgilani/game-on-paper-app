// BB-G42: the game page's Game info behind 'bball-game-info': the crew joined to official_seasons (BB-D34) and the league
// average, the injury report (ESPN's summary live and pregame, the espn_injuries snapshot for a final), the box's DNPs, the
// reads, the route's gate and the pages. Fixture (fixtures/README.md: game-info.json.gz) is real: ESPN summaries and Data
// API rows captured 2026-11-10. Every read here is mocked; nothing reaches the network.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const F = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/game-info.json.gz', import.meta.url))).toString());

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], answer: {} as Record<string, any[]>, fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (!(table in api.answer)) throw new Error(`unexpected table ${table}`);
        return api.answer[table];
    },
}));
const espn = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGameSummary: (...a: unknown[]) => espn.summary(...a) }));
const sched = vi.fn(), rows = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaGameRows: (...a: unknown[]) => rows(...a) }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: async () => [] }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import NbaPreGamePage from '../src/components/nba/game/NbaPreGamePage.astro';
import { retrieveGameInfo, pregameInfo } from '../src/resources/gameInfo';
import { fromDataApi, type NbaGame } from '../src/resources/nbaGame';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { FLAGS } from '../src/utils/features';
import { easternDate, injuriesFromSnapshot, injuriesFromSummary, injuryText, latestSnapshot, leagueAverage, officialsFromSummary, officialsFromTable, profileFor, shiftDate, type GameInfoReads, type OfficialSeason } from '../src/utils/gameInfo';

const gameApi = () => JSON.parse(readFileSync(new URL('./fixtures/nba/game_401766458_api.json', import.meta.url)).toString());
const OS = F.official_seasons as Record<string, OfficialSeason[]>;
beforeEach(() => { api.calls.length = 0; api.answer = {}; api.fail = false; espn.summary.mockReset(); sched.mockReset(); rows.mockReset(); });

describe('the crew and its season profiles', () => {
    test('the NBA final ORL-ATL (2025): the officials table\'s four, each matched by name', () => {
        const crew = officialsFromTable(F.officials['nba-401766458']);
        expect(crew.map((o) => o.name)).toEqual(['James Williams', 'Pat Fraher', 'Sean Corbin', 'Karl Lane']);
        expect(crew.map((o) => profileFor(o, OS['nba-2025'])?.games)).toEqual([63, 65, 61, 59]);
        // the summary names the same crew (no ids) and joins the same way
        expect(officialsFromSummary(F.summary['nba-401766458']).map((o) => profileFor(o, OS['nba-2025'])?.games)).toEqual([63, 65, 61, 59]);
    });
    test('WNBA: the table carries ESPN ids and joins on them; the summary\'s names reach the same rows', () => {
        const byTable = officialsFromTable(F.officials['wnba-401856902']);
        expect(byTable.every((o) => o.id != null)).toBe(true);
        const byId = byTable.map((o) => profileFor(o, OS['wnba-2026']));
        expect(byId.every((p) => p && p.official_id === byTable[byId.indexOf(p)].id)).toBe(true);
        const byName = officialsFromSummary(F.summary['wnba-401856902']).map((o) => profileFor(o, OS['wnba-2026']));
        expect(byName.map((p) => p?.official_name)).toEqual(byId.map((p) => p?.official_name));
    });
    test('college: every official on the MBB and WBB crews has a 2026 profile', () => {
        for (const [g, s] of [['mbb-401823353', 'mbb-2026'], ['wbb-401812873', 'wbb-2026']]) {
            const crew = officialsFromSummary(F.summary[g]);
            expect(crew).toHaveLength(3);
            for (const o of crew) expect(profileFor(o, OS[s]), `${g} ${o.name}`).not.toBeNull();
        }
    });
    test('names match whitespace and case folded; an unknown official has no profile', () => {
        const p = OS['nba-2025'];
        expect(profileFor({ name: '  pat   FRAHER ', id: null }, p)?.games).toBe(65);
        expect(profileFor({ name: 'Nobody Here', id: null }, p)).toBeNull();
        expect(profileFor({ name: 'Nobody Here', id: 1 }, [])).toBeNull();
    });
    test('the pregame summary before ESPN names the crew: none', () => {
        expect(officialsFromSummary(F.summary['nba-401909960'])).toEqual([]);
        expect(officialsFromSummary(null)).toEqual([]);
    });
    test('the league average: each rate over every official\'s games, weighted by its _n', () => {
        for (const rows of Object.values(OS)) {
            const avg = leagueAverage(rows);
            for (const k of ['fouls_per_game', 'fta_per_game', 'pace', 'home_win_pct', 'home_minus_away_fouls'] as const) {
                const live = rows.filter((r) => r[k] != null && (r[`${k}_n`] ?? 0) > 0);
                const want = live.reduce((s, r) => s + r[k]! * r[`${k}_n`]!, 0) / live.reduce((s, r) => s + r[`${k}_n`]!, 0);
                expect(avg[k], k).toBeCloseTo(want, 9);
                expect(avg[k]!).toBeGreaterThanOrEqual(Math.min(...live.map((r) => r[k]!)));
                expect(avg[k]!).toBeLessThanOrEqual(Math.max(...live.map((r) => r[k]!)));
            }
        }
        // the NBA's 78 officials, 2025: about 37 fouls and a .55 home win share per game
        const nba = leagueAverage(OS['nba-2025']);
        expect(nba.fouls_per_game!).toBeGreaterThan(30);
        expect(nba.home_win_pct!).toBeGreaterThan(0.4);
        expect(nba.home_win_pct!).toBeLessThan(0.7);
        expect(leagueAverage([]).pace).toBeNull(); // a season with no officials release
    });
});

describe('the injury report', () => {
    test('ESPN\'s summary: each team\'s players, with status, injury and the return date', () => {
        const pre = injuriesFromSummary(F.summary['nba-401909960']);
        expect(new Set(pre.map((r) => r.teamId))).toEqual(new Set([18, 15])); // NY, MIL
        const orl = injuriesFromSummary(F.summary['nba-401766458']).filter((r) => r.teamId === 19);
        expect(orl.find((r) => r.name === 'Jalen Suggs')).toMatchObject({ status: 'Out', injury: 'Knee (right)', returnDate: '2026-11-16' });
    });
    test('injuryText: body part, side and detail; "Not Specified" is left out', () => {
        expect(injuryText('Knee', 'Left', 'Not Specified')).toBe('Knee (left)');
        expect(injuryText('Foot', 'Left', 'Fracture')).toBe('Foot (left), fracture');
        expect(injuryText('Back', null, null)).toBe('Back');
        expect(injuryText(null, 'Left', 'Sprain')).toBeNull();
    });
    test('the snapshot window: the latest filing (Nov 8; none on Nov 9) and the two teams\' rows only', () => {
        const w = F.espn_injuries['nba-2026-11-06..09'];
        expect(latestSnapshot(w)).toBe('2026-11-08');
        const rowsOf = injuriesFromSnapshot(w.filter((r: any) => r.as_of_date === '2026-11-08'), [1, 13]); // ATL, LAL
        expect(new Set(rowsOf.map((r) => r.teamId))).toEqual(new Set([1, 13]));
        expect(rowsOf.find((r) => r.name === 'Mouhamed Gueye')).toMatchObject({ status: 'Out', injury: 'Foot (left), fracture', returnDate: '2026-11-20' });
        expect(latestSnapshot([])).toBeNull();
    });
    test('dates: the ESPN (Eastern) day of a UTC tip, and day arithmetic', () => {
        expect(easternDate('2026-11-10T00:00Z')).toBe('2026-11-09'); // LAL at ATL, 7 pm Eastern
        expect(easternDate('2025-04-15T23:30Z')).toBe('2025-04-15');
        expect(easternDate('nope')).toBeNull();
        expect(shiftDate('2026-03-01', -3)).toBe('2026-02-26');
    });
});

const nbaFinal = (): NbaGame => fromDataApi(gameApi(), 'nba');
/** The ORL-ATL rows as another game: a processor final or a live one, with that game's ids and date. */
const asGame = (g: NbaGame, over: { id: string; date: string; home: string; away: string; completed: boolean; season: number }): NbaGame => ({
    ...g, id: over.id, date: over.date, season: over.season, source: 'processor', status: { ...g.status, completed: over.completed, name: over.completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS' },
    home: { ...g.home, team: { ...g.home.team, id: over.home } }, away: { ...g.away, team: { ...g.away.team, id: over.away } },
});

describe('retrieveGameInfo', () => {
    test('an ingested NBA final: the officials table, the snapshot window and the season, never ESPN', async () => {
        api.answer = { officials: F.officials['nba-401766458'], espn_injuries: F.espn_injuries['nba-2025-04-15'], official_seasons: OS['nba-2025'] };
        const info = await retrieveGameInfo('nba', nbaFinal());
        expect(espn.summary).not.toHaveBeenCalled();
        expect(api.calls.map((c) => `${c.schema}.${c.table}`).sort()).toEqual(['nba.espn_injuries', 'nba.officials', 'nba_stats.official_seasons']);
        expect(api.calls.find((c) => c.table === 'officials')!.query).toMatchObject({ season: '2025', game_id: '401766458' });
        expect(api.calls.find((c) => c.table === 'espn_injuries')!.query).toMatchObject({ season: '2025', as_of_date__gte: '2025-04-12', as_of_date__lte: '2025-04-15', order: '-as_of_date' });
        expect(api.calls.find((c) => c.table === 'official_seasons')!.query).toMatchObject({ season: '2025', limit: '5000' });
        expect(info.officials).toHaveLength(4);
        expect(info.injuries).toEqual({ snapshot: true, asOf: null, rows: [] }); // nothing on file that far back
    });
    test('a processor final (LAL at ATL, 2026-27): the summary\'s crew, the last snapshot by the game day', async () => {
        espn.summary.mockResolvedValue(F.summary['nba-401909952']);
        api.answer = { espn_injuries: F.espn_injuries['nba-2026-11-06..09'], official_seasons: [] };
        const g = asGame(nbaFinal(), { id: '401909952', date: '2026-11-10T00:00Z', home: '1', away: '13', completed: true, season: 2027 });
        const info = await retrieveGameInfo('nba', g);
        expect(info.officials.map((o) => o.name)).toEqual(['James Williams', 'Brian Forte', 'Che Flores']);
        expect(info.profiles).toEqual([]); // no 2027 officials release yet: names only
        expect(info.injuries?.asOf).toBe('2026-11-08');
        expect(info.injuries?.rows.every((r) => r.teamId === 1 || r.teamId === 13)).toBe(true);
        expect(api.calls.find((c) => c.table === 'espn_injuries')!.query).toMatchObject({ as_of_date__gte: '2026-11-06', as_of_date__lte: '2026-11-09' });
    });
    test('live: ESPN\'s current report for the two teams, no snapshot read', async () => {
        espn.summary.mockResolvedValue(F.summary['nba-401766458']);
        api.answer = { official_seasons: OS['nba-2025'] };
        const g = asGame(nbaFinal(), { id: '401766458', date: '2025-04-15T23:30Z', home: '19', away: '1', completed: false, season: 2025 });
        const info = await retrieveGameInfo('nba', g);
        expect(api.calls.map((c) => c.table)).toEqual(['official_seasons']);
        expect(info.injuries?.snapshot).toBe(false);
        expect(info.injuries?.rows.length).toBe(9); // ORL 5, ATL 4
    });
    test('college: no injury source, so no injury read and no report', async () => {
        espn.summary.mockResolvedValue(F.summary['mbb-401823353']);
        api.answer = { official_seasons: OS['mbb-2026'] };
        const g = asGame(nbaFinal(), { id: '401823353', date: '2025-11-26T23:30Z', home: '1', away: '2', completed: true, season: 2026 });
        const info = await retrieveGameInfo('mbb', g);
        expect(info.injuries).toBeUndefined();
        expect(api.calls.map((c) => `${c.schema}.${c.table}`)).toEqual(['mbb.official_seasons']);
        expect(info.officials).toHaveLength(3);
    });
    test('strict: a failed Data API read, a silent ESPN or a capped season reject', async () => {
        api.fail = true;
        await expect(retrieveGameInfo('nba', nbaFinal())).rejects.toThrow();
        api.fail = false; espn.summary.mockResolvedValue(null); api.answer = { official_seasons: [] };
        await expect(retrieveGameInfo('wbb', asGame(nbaFinal(), { id: '401812873', date: '2026-02-13T02:00Z', home: '1', away: '2', completed: false, season: 2026 }))).rejects.toThrow('summary');
        await expect(pregameInfo('nba', 2027, null)).rejects.toThrow('summary');
        api.answer = { official_seasons: Array.from({ length: 5000 }, () => OS['nba-2025'][0]) };
        await expect(pregameInfo('nba', 2025, F.summary['nba-401909960'])).rejects.toThrow('cap');
    });
});

function fakeAstro(locals: Record<string, unknown>) {
    const cache: unknown[] = []; const headers = new Headers();
    const off = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false };
    return { astro: { params: { id: '401766458' }, url: new URL('https://gameonpaper.com/nba/game/401766458'), locals: { flagOverrides: off, ...locals }, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}

describe('prepareBasketballGame with the flag', () => {
    const ingested = () => { sched.mockResolvedValueOnce(gameApi().schedule[0]); rows.mockResolvedValueOnce(gameApi()); };
    const answer = () => { api.answer = { officials: F.officials['nba-401766458'], espn_injuries: [], official_seasons: OS['nba-2025'] }; };
    test("'bball-game-info' is a preview flag", () => { expect(FLAGS['bball-game-info']).toBe('preview'); });
    test('off: no read and no info key, the year-long cache kept', async () => {
        ingested();
        const { astro, cache } = fakeAstro({});
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && !('info' in r)).toBe(true);
        expect(api.calls).toEqual([]);
        expect((cache.at(-1) as any).maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
    });
    test('on, an ingested final: the reads, held for the season window (the profiles move nightly)', async () => {
        ingested(); answer();
        const { astro, cache } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('info' in r && r.info?.officials).toHaveLength(4);
        expect((cache.at(-1) as any).maxAge).toBe(6 * 60 * 60);
    });
    test('on, a failed read: info null, the page renders, nothing is cached', async () => {
        ingested(); api.fail = true;
        const { astro, cache, headers } = fakeAstro({ preview: true });
        const r = await prepareBasketballGame(astro, 'nba');
        expect('game' in r && r.info).toBeNull();
        expect(cache.at(-1)).toBe(false);
        expect(headers.get('Cache-Control')).toBe('no-store');
    });
    test('on, beside a final panel whose read failed: that panel\'s no-store is kept', async () => {
        ingested(); answer();
        const { astro, cache } = fakeAstro({ preview: true, flagOverrides: { 'bball-impact-box': false, 'bball-garbage-time': false, 'bball-game-flow': true } });
        const r = await prepareBasketballGame(astro, 'nba'); // game_flow is not in the mock's answer: its read fails
        expect('flow' in r && r.flow).toBeNull();
        expect('info' in r && r.info).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
    });
});

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const page = (league: string, game: NbaGame, info?: GameInfoReads | null) =>
    container.renderToString(NbaGamePage, { props: { game, ...(info !== undefined ? { info } : {}) }, locals: { league } as App.Locals });
const ORL: GameInfoReads = { officials: officialsFromTable(F.officials['nba-401766458']), profiles: OS['nba-2025'], injuries: { snapshot: true, asOf: '2025-04-15', rows: [] } };

describe('NbaGamePage', () => {
    test('without info, the page as before; with it, a Game info panel after the plays', async () => {
        const off = await page('nba', nbaFinal());
        expect(off).not.toContain('id="info"');
        const html = await page('nba', nbaFinal(), ORL);
        expect(html).toContain('href="#info"');
        expect(html.indexOf('id="plays"')).toBeLessThan(html.indexOf('id="info"'));
        const t = html.split('aria-label="Officials, season profile"')[1].split('</table>')[0];
        expect(t.match(/<tr/g)).toHaveLength(1 + 4 + 1); // header, the crew, the league average
        expect(t).toContain('Pat Fraher');
        expect(t).toContain('>65<'); // his games
        expect(t).toContain('League average');
        expect(t).toMatch(/\(([+−]\d+\.\d)\)/); // a difference from the average
        // the box's DNPs with its reasons
        expect(html).toContain('LEFT SHOULDER SURGERY');
        expect(html).toContain('id="dnp-list"');
        expect(html).toContain('as last filed by the game day, on Apr 15');
        expect(html).not.toMatch(/NaN|undefined|Infinity|n\/a/);
    });
    test('a season with no officials release: the crew by name, no table', async () => {
        const html = await page('nba', nbaFinal(), { ...ORL, profiles: [] });
        expect(html).toContain('id="officials-crew"');
        expect(html).not.toContain('Officials, season profile');
    });
    test('no snapshot on file, no crew yet, a failed read', async () => {
        const none = await page('nba', nbaFinal(), { officials: [], profiles: [], injuries: { snapshot: true, asOf: null, rows: [] } });
        expect(none).toContain('id="officials-none"');
        expect(none).toContain('id="injuries-none-filed"');
        expect(await page('nba', nbaFinal(), null)).toContain('id="game-info-unavailable"');
    });
    test('college: the WBB crew with profiles and the college note', async () => {
        const g = fromDataApi(gameApi(), 'wbb');
        const html = await page('wbb', g, { officials: officialsFromSummary(F.summary['wbb-401812873']), profiles: OS['wbb-2026'] });
        expect(html.split('aria-label="Officials, season profile"')[1].split('</table>')[0].match(/<tr/g)).toHaveLength(1 + 3 + 1);
        expect(html).toContain('id="injuries-none-college"');
        expect(html).toContain('Possessions per 40 minutes');
    });
});

const espnPage = (s: any) => ({ gameId: Number(s.header.id), gamepackageJSON: { header: { id: s.header.id, season: { year: 2027 }, competitions: [{ ...s.header.competitions[0], status: { type: { name: 'STATUS_SCHEDULED', description: 'Scheduled' } }, competitors: s.header.competitions[0].competitors.map((c: any) => ({ ...c, team: { ...c.team, name: c.team.abbreviation, location: c.team.abbreviation } })) }] } } });

describe('NbaPreGamePage', () => {
    test('on: ESPN\'s injury report and "no officials yet" from the summary the page already reads', async () => {
        espn.summary.mockResolvedValue(F.summary['nba-401909960']);
        api.answer = { official_seasons: [] };
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: espnPage(F.summary['nba-401909960']) }, locals: { league: 'nba', preview: true } as App.Locals });
        expect(html).toContain('id="info"');
        expect(html).toContain('id="officials-none"');
        expect(html).toContain('id="injury-report"');
        expect(html).toContain('ESPN&#39;s current injury report.');
        expect(espn.summary).toHaveBeenCalledTimes(1);
    });
    test('off: no section and no read', async () => {
        espn.summary.mockResolvedValue(F.summary['nba-401909960']);
        const html = await container.renderToString(NbaPreGamePage, { props: { espnGame: espnPage(F.summary['nba-401909960']) }, locals: { league: 'nba' } as App.Locals });
        expect(html).not.toContain('id="info"');
        expect(api.calls).toEqual([]);
    });
});
