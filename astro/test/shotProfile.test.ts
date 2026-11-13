// BB-G51: the player and team pages' Shot profile behind 'bball-shot-profile'. The pure steps (a zone row as the panel's
// lines, a traded pro's rows added up unranked, where the points come from with his season FTM, college's crosswalk pick
// inside his team), the reads (player_shot_zones / team_shot_zones in the league's season schema; his player_season_stats
// FGM and FTM; the team's season rates on the season block's exact query), the page-side steps (the flag gates every
// read; a failed read keeps the page and is never cached), the panel and the player page: flag off is byte for byte the
// NBA byte-identity capture. On real Data API rows (fixtures/README.md: shot-zones.json.gz, shot-zones-xwalk-mbb-2026.json.gz,
// shot-profile-ft.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth (the IP-wide 429 lockout)
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = any; // fixture rows: the Data API's, checked by the tests below
const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const SZ = gz('shot-zones') as Record<'nba' | 'nbaTeam' | 'wnba' | 'mbbTexas' | 'mbbTeam' | 'wbbSouthCarolina', Row[]>;
// Texas 2025-26's ncaa_player_crosswalk pairs: ESPN athlete id -> the stats.ncaa.org id player_shot_zones keys players by
const XWALK = gz('shot-zones-xwalk-mbb-2026').xwalk as Row[];
const RATES = { nba: gz('team-season-nba-2026').rates as Row[], mbb: gz('team-season-mbb-2026').rates as Row[] };
const MBB_PLAYERS = gz('mbb/dashboards/season_players_2026') as Row[];
// player_season_stats: the pros' totals rows (MPJ 2025-26, A'ja Wilson 2025) and Texas 2025-26's ESPN season totals
const FT = gz('shot-profile-ft') as Record<'nba' | 'wnba' | 'mbbTexas', Row[]>;

const reads = vi.hoisted(() => ({ player: vi.fn(), roster: vi.fn(), team: vi.fn(), ncaa: vi.fn(), ft: vi.fn() }));
vi.mock('../src/resources/shotZones', async (orig) => ({
    ...(await orig<typeof import('../src/resources/shotZones')>()),
    retrievePlayerShotZones: (...a: unknown[]) => reads.player(...a),
    retrieveTeamPlayerShotZones: (...a: unknown[]) => reads.roster(...a),
    retrieveTeamShotZones: (...a: unknown[]) => reads.team(...a),
    retrieveNcaaPlayerId: (...a: unknown[]) => reads.ncaa(...a),
    retrieveSeasonFt: (...a: unknown[]) => reads.ft(...a),
}));
const sdv = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({ ...(await orig<typeof import('../src/resources/sdv')>()), retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a) }));
// the player page's other reads, as playerWar.test.ts mocks them
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());
const oracle = fx('nba/league_context');
const shots = fx('nba/shots') as any[];
const byPlayer = fx('nba/player_games') as Record<string, any[]>;
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => seasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrievePlayerGameRows: async (_s: number, id: number) => (byPlayer[String(id)] ?? []).map((g) => ({
        season: 2026, person_id: id, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
    retrieveCoverageRows: async () => [],
    retrieveTeamShots: async () => shots.filter((s) => s.team_id === 1610612751).map(lite),
}));

import ShotProfile from '../src/components/nba/ShotProfile.astro';
import { BASKETBALL } from '../src/basketball/config';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { ZONE_KEYS } from '../src/resources/shotZones';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { prepareBasketballPlayer } from '../src/routes/basketball/player';
import { prepareBasketballTeam } from '../src/routes/basketball/team';
import { FLAGS } from '../src/utils/features';
import { leagueSource } from '../src/utils/league';
import { collegePlayerRows, composition, playerView, teamViews, zoneSide } from '../src/utils/shotProfile';

const [MPJ] = SZ.nba; // Michael Porter Jr., 1629008, Brooklyn 2025-26
const PID = MPJ.player_id;
const [BKN] = SZ.nbaTeam;
const [DUKE] = SZ.mbbTeam;
const MPJ_FT = { fgm: FT.nba[0].fgm, ftm: FT.nba[0].ftm }; // 444 and 195, his regular-season totals
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-career': false, 'bball-shot-profile': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-shot-profile': on } });
const zoneSum = (r: Row, p = '') => ZONE_KEYS.reduce((a, z) => a + r[`${p}${z}_fga`], 0) + r[`${p}unlocated_fga`];

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [...Object.values(reads), sdv.from]) f.mockReset();
    reads.player.mockResolvedValue(SZ.nba);
    reads.roster.mockResolvedValue(SZ.mbbTexas);
    reads.team.mockResolvedValue({ zones: BKN, rates: RATES.nba });
    reads.ncaa.mockResolvedValue(null);
    reads.ft.mockResolvedValue(MPJ_FT);
});
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }
function fake(path: string, id: string, on: boolean) {
    const cache: unknown[] = [];
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}?season=2026`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}

describe('the captures', () => {
    test('the four zones plus unlocated add up to FGA, for and against; the pros key players by stats id, college by text', () => {
        for (const r of [...SZ.nba, ...SZ.wnba, ...SZ.mbbTexas, ...SZ.wbbSouthCarolina, BKN, DUKE]) expect(zoneSum(r)).toBe(r.fga);
        for (const r of [BKN, DUKE]) expect(zoneSum(r, 'opp_')).toBe(r.opp_fga);
        expect(typeof PID).toBe('number');
        expect(typeof SZ.mbbTexas[0].player_id).toBe('string');
        expect(SZ.wnba[0].player_name).toBe('Wilson'); // the pros' name is the family name only: the page names him itself
    });
    test("a three-point make rate is never ranked; the team's allowed side has its own ranks", () => {
        expect(MPJ.corner_3_fg_pct_rank).toBeNull();
        expect(MPJ.above_break_3_fg_pct_rank).toBeNull();
        expect(BKN.opp_rim_fg_pct_rank).not.toBeNull();
    });
});

describe('zoneSide', () => {
    test("one row: the producer's counts, rates, ranks and percentiles", () => {
        const s = zoneSide(SZ.nba)!;
        expect([s.fga, s.fgm, s.unlocated, s.ranked]).toEqual([MPJ.fga, MPJ.fgm, 0, true]);
        const rim = s.zones[0];
        expect(rim).toEqual({
            key: 'rim', label: 'Rim', fga: MPJ.rim_fga, fgm: MPJ.rim_fgm,
            fgPct: { value: MPJ.rim_fg_pct, rank: MPJ.rim_fg_pct_rank, pct: MPJ.rim_fg_pct_pct },
            freq: { value: MPJ.rim_freq, rank: MPJ.rim_freq_rank, pct: MPJ.rim_freq_pct },
            astPct: { value: MPJ.rim_ast_pct, rank: MPJ.rim_ast_pct_rank, pct: MPJ.rim_ast_pct_pct },
        });
        expect(s.zones.map((z) => z.key)).toEqual([...ZONE_KEYS]);
    });
    test("the allowed side reads the opp_ columns", () => {
        const s = zoneSide([BKN], 'opp_')!;
        expect([s.fga, s.zones[0].fgPct.value, s.zones[0].fgPct.rank]).toEqual([BKN.opp_fga, BKN.opp_rim_fg_pct, BKN.opp_rim_fg_pct_rank]);
    });
    test('a traded pro: his teams added up, the rates recomputed from the counts and unranked; no row, no side', () => {
        // his one row split in two "teams" by halving every count: the sums must give the producer's rates back
        const half = (r: Row, up: boolean): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && /(_fga|_fgm|_ast|_ast_pct_n|^fga|^fgm)$/.test(k) ? (up ? Math.ceil(v / 2) : Math.floor(v / 2)) : v]));
        const s = zoneSide([half(MPJ, true), half(MPJ, false)])!;
        expect([s.fga, s.fgm, s.ranked]).toEqual([MPJ.fga, MPJ.fgm, false]);
        for (const z of s.zones) {
            expect(z.fgPct.value).toBeCloseTo(MPJ[`${z.key}_fg_pct`], 9);
            expect(z.freq.value).toBeCloseTo(MPJ[`${z.key}_freq`], 9);
            expect(z.astPct.value).toBeCloseTo(MPJ[`${z.key}_ast_pct`], 9);
            expect(z.fgPct.rank).toBeNull();
        }
        expect(zoneSide([])).toBeNull();
    });
});

describe('composition', () => {
    test('2 × the rim and mid makes, 3 × the threes, his FTM as the free throws: the total is the producer\'s points', () => {
        const s = zoneSide(SZ.nba)!;
        const c = composition(s, MPJ_FT.ftm)!;
        const threes = 3 * (MPJ.corner_3_fgm + MPJ.above_break_3_fgm);
        expect(c.parts.map((p) => [p.key, p.pts])).toEqual([['rim', 2 * MPJ.rim_fgm], ['mid', 2 * MPJ.mid_fgm], ['three', threes], ['ft', 195]]);
        expect(c.pts).toBe(1259); // his player_season_stats `pts` (the totals row), not a number the page made up
        expect(c.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 12);
    });
    test('no free throws given, fewer than none, a make with no location, or no points at all: no split', () => {
        const s = zoneSide(SZ.nba)!;
        expect(composition(s, null)).toBeNull();
        expect(composition(s, -1)).toBeNull();
        expect(composition({ ...s, fgm: s.fgm + 1 }, 10)).toBeNull();
        expect(composition({ ...s, fgm: 0, zones: s.zones.map((z) => ({ ...z, fgm: 0 })) }, 0)).toBeNull();
    });
});

describe('the college pick', () => {
    test("by the crosswalk: every Texas 2025-26 shooter with a pair finds exactly his zone row by id, with the box's FGA", () => {
        const roster = MBB_PLAYERS.filter((r) => r.team_id === 251);
        const toNcaa = new Map(XWALK.map((x) => [String(x.espn_athlete_id), String(x.ncaa_player_id)]));
        const paired = roster.filter((p) => toNcaa.has(String(p.person_id)));
        expect(paired.length).toBeGreaterThan(0);
        for (const p of paired) {
            const ncaaId = toNcaa.get(String(p.person_id))!;
            expect(ncaaId).not.toBe(String(p.person_id)); // the page's id is not the table's: reading by it finds nothing
            expect(collegePlayerRows(SZ.mbbTexas, String(p.person_id))).toEqual([]);
            const hit = collegePlayerRows(SZ.mbbTexas, ncaaId);
            expect(hit).toHaveLength(1);
            expect(hit[0].player_id).toBe(ncaaId);
            expect(hit[0].fga).toBe(p.fga_total);
        }
    });
    test('no pair is no row, even when his name is on one (Q12: never a name match); a pair with no zone row is no row', () => {
        expect(SZ.mbbTexas[0].player_name).toBeTruthy();
        expect(collegePlayerRows(SZ.mbbTexas, null)).toEqual([]);
        expect(collegePlayerRows(SZ.mbbTexas, '0')).toEqual([]);
    });
});

describe('the views', () => {
    test("player: the split with his season FTM; the season stats' FGM not the zone table's drops it, saying why", () => {
        const v = playerView(SZ.nba, MPJ_FT)!;
        expect(v.comp!.parts.at(-1)).toMatchObject({ key: 'ft', pts: 195 });
        expect(v.why).toBeNull();
        const off = playerView(SZ.nba, { ...MPJ_FT, fgm: MPJ.fgm + 1 })!;
        expect(off.comp).toBeNull();
        expect(off.why).toBe(`The zone table counts ${MPJ.fgm} makes to the season stats’ ${MPJ.fgm + 1}, so the points cannot be split.`);
        expect(playerView(SZ.nba, null)!.why).toBe('The season stats carry no free throws.');
        expect(playerView([], MPJ_FT)).toBeNull();
    });
    test("real rows: A'ja Wilson's and every paired Texas shooter's zone points plus FTM are the season stats' points", async () => {
        const actual = await vi.importActual<typeof import('../src/resources/shotZones')>('../src/resources/shotZones');
        const [wilson] = SZ.wnba;
        sdv.from.mockResolvedValue(FT.wnba);
        const w = playerView(SZ.wnba, await actual.retrieveSeasonFt('wnba', 2025, wilson.player_id))!;
        expect(w.comp!.pts).toBe(937); // her 2025 regular-season totals row's pts
        const toNcaa = new Map(XWALK.map((x) => [String(x.espn_athlete_id), String(x.ncaa_player_id)]));
        const ids = [...new Set(FT.mbbTexas.map((r) => r.athlete_id))];
        expect(ids).toHaveLength(13);
        let exact = 0;
        for (const id of ids) {
            sdv.from.mockResolvedValue(FT.mbbTexas.filter((r) => r.athlete_id === id));
            const ft = (await actual.retrieveSeasonFt('mbb', 2026, id))!;
            const v = playerView(collegePlayerRows(SZ.mbbTexas, toNcaa.get(String(id)) ?? null), ft)!;
            expect(v.why).toBeNull();
            const espnPts = FT.mbbTexas.find((r) => r.athlete_id === id && r.stat_name === 'points').display_value;
            expect(Math.abs(v.comp!.pts - Number(espnPts))).toBeLessThanOrEqual(1); // one shooter's zone points are one over ESPN's (the FG and FT counts agree)
            if (v.comp!.pts === Number(espnPts)) exact++;
        }
        expect(exact).toBe(12);
    });
    test("team: offense and allowed, each against the season rates' points when the games agree", () => {
        for (const [zones, rates] of [[BKN, RATES.nba], [DUKE, RATES.mbb]] as const) {
            const all = rates.find((r) => r.split === 'all');
            const [off, opp] = teamViews({ zones, rates });
            expect([off.title, opp.title]).toEqual(['Offense', 'Allowed']);
            expect([off.comp!.pts, opp.comp!.pts]).toEqual([all.pts, all.opp_pts]);
            expect(opp.side.fga).toBe(zones.opp_fga);
        }
    });
    test("team: the charts missing games, or no rates row, keeps the tables and drops the split, saying why; no zone row, no views", () => {
        const short = teamViews({ zones: { ...BKN, games: 80 }, rates: RATES.nba });
        expect(short.map((v) => v.comp)).toEqual([null, null]);
        expect(short[0].why).toBe('The shot charts cover 80 of the 82 games, so the points cannot be split.');
        expect(teamViews({ zones: BKN, rates: [] })[0].why).toBe('The season’s box points are not built yet.');
        expect(teamViews({ zones: null, rates: RATES.nba })).toEqual([]);
    });
});

describe('the reads', () => {
    test("the league's season schema: the pros by stats id, college by ESPN team; the team row and the season block's rates query", async () => {
        const actual = await vi.importActual<typeof import('../src/resources/shotZones')>('../src/resources/shotZones');
        sdv.from.mockResolvedValue([]);
        await actual.retrievePlayerShotZones('nba', 2026, PID);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'player_shot_zones', { season: '2026', player_id: String(PID), limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await actual.retrieveTeamPlayerShotZones('mbb', 2026, 251);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('mbb'), 'player_shot_zones', { season: '2026', team_id: '251', limit: '40' }, 21600, true, NBA_READ_TIMEOUT_MS);
        // his season's stats.ncaa.org id: season-filtered (a new id every season), the crosswalk's text id as a string
        const [pair] = XWALK;
        sdv.from.mockImplementation(async (_s: unknown, _t: string, q: Record<string, string>) => XWALK
            .filter((x) => String(x.season) === q.season && String(x.espn_athlete_id) === q.espn_athlete_id).map((x) => ({ ncaa_player_id: x.ncaa_player_id })));
        expect(await actual.retrieveNcaaPlayerId('mbb', 2026, pair.espn_athlete_id)).toBe(String(pair.ncaa_player_id));
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('mbb'), 'ncaa_player_crosswalk', { season: '2026', espn_athlete_id: String(pair.espn_athlete_id), select: 'ncaa_player_id', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(await actual.retrieveNcaaPlayerId('mbb', 2025, pair.espn_athlete_id)).toBeNull();
        sdv.from.mockReset();
        // his season FGM and FTM (Q13): the pros' one regular-season totals row (the two schemas spell the filters differently)
        sdv.from.mockResolvedValue(FT.nba);
        expect(await actual.retrieveSeasonFt('nba', 2026, PID)).toEqual({ fgm: 444, ftm: 195 });
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'player_season_stats', { season: '2026', player_id: String(PID), season_type: 'regular-season', per_mode: 'totals', measure_type: 'base', select: 'player_id,fgm,ftm', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        sdv.from.mockResolvedValue(FT.wnba);
        expect(await actual.retrieveSeasonFt('wnba', 2025, 1628932)).toEqual({ fgm: 332, ftm: 248 });
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('wnba'), 'player_season_stats', { season: '2025', player_id: '1628932', season_type: 'Regular Season', per_mode: 'Totals', measure_type: 'Base', select: 'player_id,fgm,ftm', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        sdv.from.mockResolvedValue([...FT.nba, ...FT.nba]);
        expect(await actual.retrieveSeasonFt('nba', 2026, PID)).toBeNull(); // two rows are never added up
        // college: ESPN's long season totals by the page's own athlete id; the counts sit in the made-attempted display value
        const texas = FT.mbbTexas.filter((r) => r.athlete_id === 4432243);
        sdv.from.mockResolvedValue(texas);
        expect(texas.find((r) => r.stat_name === 'freeThrowsMade-freeThrowsAttempted')).toMatchObject({ display_value: '83-111', value: null });
        expect(await actual.retrieveSeasonFt('mbb', 2026, 4432243)).toEqual({ fgm: 184, ftm: 83 });
        expect(sdv.from).toHaveBeenLastCalledWith(BASKETBALL.mbb.gamesSource, 'player_season_stats', { season: '2026', athlete_id: '4432243', category: 'totals', select: 'athlete_id,stat_name,display_value', limit: '20' }, 21600, true, NBA_READ_TIMEOUT_MS);
        sdv.from.mockResolvedValue(texas.filter((r) => r.stat_name !== 'freeThrowsMade-freeThrowsAttempted'));
        expect(await actual.retrieveSeasonFt('mbb', 2026, 4432243)).toBeNull();
        sdv.from.mockReset();
        sdv.from.mockImplementation(async (_s: unknown, table: string) => (table === 'team_shot_zones' ? [BKN] : RATES.nba));
        expect(await actual.retrieveTeamShotZones('nba', 2026, 1610612751)).toEqual({ zones: BKN, rates: RATES.nba });
        expect(sdv.from).toHaveBeenCalledWith(leagueSource('nba'), 'team_shot_zones', { season: '2026', team_id: '1610612751', limit: '1' }, 21600, true, NBA_READ_TIMEOUT_MS);
        // resources/teamSeason.ts's query, key for key in its order: one cached response serves both
        const [, , q] = sdv.from.mock.calls.find((c) => c[1] === 'team_season_rates')!;
        expect(Object.entries(q)).toEqual([['season', '2026'], ['team_id', '1610612751'], ['limit', '10']]);
        sdv.from.mockImplementation(async () => []);
        expect((await actual.retrieveTeamShotZones('nba', 2026, 1)).zones).toBeNull();
    });
});

describe('the pages', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-shot-profile']).toBe('preview'); });
    test('player, off: no read and no zones key; on: his rows by stats id; a failed read is null and never cached', async () => {
        const off = ok(await prepareNbaPlayer(fake(`/nba/players/${PID}`, String(PID), false).astro));
        expect('zones' in off).toBe(false);
        expect(reads.player).not.toHaveBeenCalled();
        const a = fake(`/nba/players/${PID}`, String(PID), true);
        const on = ok(await prepareNbaPlayer(a.astro));
        expect([on.zones, on.zonesFt]).toEqual([SZ.nba, MPJ_FT]);
        expect(reads.player).toHaveBeenCalledWith('nba', 2026, PID);
        expect(reads.ft).toHaveBeenCalledWith('nba', 2026, PID);
        expect(a.cache.at(-1)).not.toBe(false);
        for (const failing of [reads.player, reads.ft]) {
            failing.mockRejectedValueOnce(new Error('503'));
            const b = fake(`/nba/players/${PID}`, String(PID), true);
            expect(ok(await prepareNbaPlayer(b.astro)).zones).toBeNull();
            expect(b.cache.at(-1)).toBe(false);
        }
    });
    test('team, off: no read; on: the reads by team id; a failed read is null and never cached', async () => {
        const off = ok(await prepareBasketballTeam(fake('/nba/team/1610612751', '1610612751', false).astro, 'nba'));
        expect('shotZones' in off).toBe(false);
        expect(reads.team).not.toHaveBeenCalled();
        expect(ok(await prepareBasketballTeam(fake('/nba/team/1610612751', '1610612751', true).astro, 'nba')).shotZones).toEqual({ zones: BKN, rates: RATES.nba });
        expect(reads.team).toHaveBeenCalledWith('nba', 2026, 1610612751);
        reads.team.mockRejectedValueOnce(new Error('503'));
        const b = fake('/nba/team/1610612751', '1610612751', true);
        expect(ok(await prepareBasketballTeam(b.astro, 'nba')).shotZones).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
    test("prepareBasketballPlayer's college path reads his ESPN team and his crosswalk id, and keeps only his row by that id", async () => {
        // the mbb page's identity reads are the NBA mock's here; the college branch is what is under test
        const first = seasonPlayerRows()[0];
        // his name is on row 0, his crosswalk id on row 1: the id wins
        reads.roster.mockResolvedValue([{ ...SZ.mbbTexas[0], player_name: first.player_name }, ...SZ.mbbTexas.slice(1)]);
        reads.ncaa.mockResolvedValue(String(SZ.mbbTexas[1].player_id));
        const r = ok(await prepareBasketballPlayer(fake(`/mbb/players/${first.person_id}`, String(first.person_id), true).astro, 'mbb'));
        expect(reads.roster).toHaveBeenCalledWith('mbb', 2026, first.team_id);
        expect(reads.ncaa).toHaveBeenCalledWith('mbb', 2026, first.person_id);
        expect(reads.player).not.toHaveBeenCalled();
        expect(r.zones).toHaveLength(1);
        expect(r.zones![0].player_id).toBe(SZ.mbbTexas[1].player_id);
        expect(reads.ft).toHaveBeenCalledWith('mbb', 2026, first.person_id); // ESPN's id: the season stats' own
        // no pair: no row, though his name is on row 0 (Q12)
        reads.ncaa.mockResolvedValue(null);
        const n = ok(await prepareBasketballPlayer(fake(`/mbb/players/${first.person_id}`, String(first.person_id), true).astro, 'mbb'));
        expect(n.zones).toEqual([]);
        // a failed crosswalk read is "unavailable", never a name guess
        reads.ncaa.mockRejectedValueOnce(new Error('503'));
        const b = fake(`/mbb/players/${first.person_id}`, String(first.person_id), true);
        expect(ok(await prepareBasketballPlayer(b.astro, 'mbb')).zones).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
});

describe('the panel', () => {
    const render = (views: any, league: string, team = false, season = 2026) => container.renderToString(ShotProfile, { props: { views, season, name: 'Them', ...(team ? { team } : {}) }, locals: { league } as any });
    test("player: the four zones, the producer's rank, FG% shading, the zone note and where the points come from", async () => {
        const html = await render([playerView(SZ.nba, MPJ_FT)], 'nba');
        expect(html.match(/data-zone="/g)).toHaveLength(4);
        expect(html).toContain('Above-the-break 3');
        expect(html).toContain(`>#${MPJ.rim_fg_pct_rank}</span>`);
        expect(html).toMatch(/hulk-bg-level-\d[^>]*title="Rank 15, 95th percentile"/);
        expect(html).toContain('the paint outside the restricted area included');
        expect(html).toContain('The shot charts below draw the paint as its own zone');
        expect(html).toContain('Regular season.');
        expect(html).toMatch(/data-part="ft">FT \d+%/);
        expect(html).toContain('free throws are the season’s free throws made, 1 point each.');
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('team (college): offense and allowed, every game, the allowed ranking note', async () => {
        const html = await render(teamViews({ zones: DUKE, rates: RATES.mbb }), 'mbb', true);
        expect(html).toContain('id="shot-profile-offense"');
        expect(html).toContain('id="shot-profile-allowed"');
        expect(html).toContain('Where the points allowed come from');
        expect(html).toContain('Every game, the postseason included.');
        expect(html).toContain('Allowed FG% ranks the stingiest first.');
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('a failed read says so; no row says so; a missing split says why', async () => {
        expect(await render(null, 'nba')).toContain('id="shot-profile-unavailable"');
        expect(await render([], 'wnba', false, 2025)).toContain('id="shot-profile-empty"');
        expect(await render([playerView(SZ.nba, null)], 'nba')).toContain('The season stats carry no free throws.');
    });
});

describe('the player page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(on: boolean) {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page)", async () => {
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
    });
    test('on: the panel and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        const link = '<a href="#shot-profile" class="ms-2">Shot profile</a>';
        expect(on).toContain(link);
        const section = on.match(/<section id="shot-profile"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('data-zone="rim"');
        expect(on.replace(section, '').replace(link, '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
});
