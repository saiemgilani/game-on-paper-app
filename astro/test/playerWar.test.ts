// BB-G27: the player page's Value panel behind 'bball-war'. The pure step (his player_war row as the panel, WAR never
// without its interval), the reads (player_war and epv_player_seasons in the league's season schema by person id, EPV from
// 2021-22), the proof that the producer's season EPV is the sum the page used to do (Q39), the page-side step (the flag gates both
// reads; a failed read keeps the page and is never cached), the panel and the page: flag off is byte for byte the NBA
// byte-identity capture; with the Impact panel on, Value closes it and its own WAR reads "Impact WAR". On real producer
// output (fixtures/README.md: player-war.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = any; // fixture rows: the producer frames, checked by the tests below
const PW = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-war.json.gz', import.meta.url))).toString()) as Record<'nba' | 'wnba' | 'mbbTeam' | 'wbbTeam' | 'nbaEpvSeason' | 'epvProof', Row[]>;
const PI = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-impact.json.gz', import.meta.url))).toString()) as Record<'nba', Row[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const reads = vi.hoisted(() => ({ war: vi.fn(), epv: vi.fn(), impact: vi.fn() }));
// BB-G51's Shot profile reads the Data API with 'bball-shot-profile' on (preview): never from a test
vi.mock('../src/resources/shotZones', async (orig) => ({ ...(await orig<typeof import('../src/resources/shotZones')>()), retrievePlayerShotZones: async () => [], retrieveTeamPlayerShotZones: async () => [], retrieveTeamShotZones: async () => ({ zones: null, rates: [] }), retrieveSeasonFt: async () => null }));
vi.mock('../src/resources/playerWar', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playerWar')>()),
    retrievePlayerWar: (...a: unknown[]) => reads.war(...a),
    retrievePlayerEpv: (...a: unknown[]) => reads.epv(...a),
}));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: (...a: unknown[]) => reads.impact(...a) }));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other reads, exactly as playerImpact.test.ts mocks them
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
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
}));

import PlayerValue from '../src/components/nba/PlayerValue.astro';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { EPV_FIRST_SEASON, hasEpv } from '../src/resources/playerWar';
import { leagueSource } from '../src/utils/league';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { FLAGS } from '../src/utils/features';
import { impactPanel } from '../src/utils/playerImpact';
import { warPanel } from '../src/utils/playerWar';
import { signed1 } from '../src/utils/shotQuality';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-shot-profile': false };
const locals = (war: boolean, impact = false) => ({ preview: true, flagOverrides: { ...OFF, 'bball-war': war, 'bball-impact': impact } });
const [NBA] = PW.nba;
const [WNBA] = PW.wnba;
const [EPV] = PW.nbaEpvSeason; // Michael Porter Jr.'s 2025-26 epv_player_seasons row
const d1 = (v: number) => v.toFixed(1);

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [...Object.values(reads), sdv.rows, sdv.from]) f.mockReset();
    reads.war.mockResolvedValue(PW.nba); reads.epv.mockResolvedValue(PW.nbaEpvSeason); reads.impact.mockResolvedValue(PI.nba);
});

function fakeAstro(war: boolean, impact = false) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(war, impact), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the captures', () => {
    test("one regular-season row per player-season; every WAR sits inside its producer interval; the headline is the sources' mean", () => {
        for (const r of [NBA, WNBA, ...PW.mbbTeam, ...PW.wbbTeam]) {
            expect(r.war_lo).toBeLessThanOrEqual(r.war);
            expect(r.war_hi).toBeGreaterThanOrEqual(r.war);
        }
        for (const r of [NBA, WNBA]) expect((r.war_bpm + r.war_rapm + r.war_boban) / 3).toBeCloseTo(r.war, 9);
        expect(NBA.player_id).toBe(PID);
        expect(typeof PW.mbbTeam[0].player_id).toBe('string'); // college: ESPN's athlete id as text
        expect(PW.mbbTeam[0]).not.toHaveProperty('war_bpm');
    });
});

// Q39: the producer's epv_player_seasons replaced the page's own sum of his epv_player_games rows. The page's old rule
// (the regular season for the pros, 002 / 102 game ids; every game in college), kept here only as the oracle.
const oldSum = (league: string, games: Row[]) => {
    const kept = games.filter((g) => league === 'mbb' || league === 'wbb' || /^(002|102)/.test(String(g.game_id)));
    const sum = (k: string) => kept.reduce((a, g) => a + g[k], 0);
    return { games: kept.length, epv_own: sum('epv_own'), own_actions: sum('own_actions'), off_epv_on: sum('off_epv_on'), def_epv_on: sum('def_epv_on'), epv_on: sum('epv_on') };
};
describe('epv_player_seasons is the old site sum (Q39)', () => {
    test('five real players in all four leagues: the same games, plays and EPV as summing his game rows', () => {
        expect(PW.epvProof.map((p) => `${p.league} ${p.season} ${p.player_id}`)).toEqual(['nba 2026 1629008', 'nba 2025 1629029', 'wnba 2025 1628932', 'mbb 2026 11195975', 'wbb 2026 9341835']);
        for (const p of PW.epvProof) {
            const [row] = p.season_row;
            const old = oldSum(p.league, p.games);
            expect([row.games, row.own_actions]).toEqual([old.games, old.own_actions]);
            for (const k of ['epv_own', 'off_epv_on', 'def_epv_on', 'epv_on'] as const) expect(row[k]).toBeCloseTo(old[k], 9);
            expect(row.epv_own_rank).toBeGreaterThanOrEqual(1);
            expect(row.epv_own_pct).toBeGreaterThan(0);
        }
    });
    test('the pros drop the preseason and playoffs (and keep both teams of a traded player); college keeps every game', () => {
        const [mpj, luka, aja, mbb, wbb] = PW.epvProof;
        const types = (p: Row) => [...new Set(p.games.map((g: Row) => String(g.game_id).slice(0, 3)))].sort();
        expect(types(mpj)).toEqual(['001', '002']);
        expect(types(luka)).toEqual(['002', '004']);
        expect(luka.season_row[0].teams).toBe(2);
        expect(types(aja)).toEqual(['102', '104']);
        for (const p of [mpj, luka, aja]) expect(p.season_row[0].games).toBeLessThan(p.games.length);
        for (const p of [mbb, wbb]) expect(p.season_row[0].games).toBe(p.games.length);
    });
});

describe('warPanel', () => {
    test("WAR with its interval, VORP, the rating and the producer's rank and percentile; the pros' three sources", () => {
        const p = warPanel(PW.nba)!;
        expect(p.war).toEqual({ value: NBA.war, lo: NBA.war_lo, hi: NBA.war_hi, rank: NBA.war_rank, pct: NBA.war_pct });
        expect(p.vorp).toEqual({ value: NBA.vorp, rank: NBA.vorp_rank, pct: NBA.vorp_pct });
        expect([p.rating, p.poss, p.min, p.teams, p.ranked]).toEqual([NBA.rating, NBA.poss, NBA.min, 1, true]);
        expect(p.sources).toEqual([{ label: 'BPM', war: NBA.war_bpm }, { label: 'RAPM', war: NBA.war_rapm }, { label: 'BOBAN', war: NBA.war_boban }]);
    });
    test('college: no sources; no row, no panel; no rank without the producer rank', () => {
        expect(warPanel([PW.mbbTeam[0]])!.sources).toEqual([]);
        expect(warPanel([])).toBeNull();
        expect(warPanel([{ ...NBA, war_rank: null, vorp_rank: null }])!.ranked).toBe(false);
    });
});

describe('the reads', () => {
    test("player_war and epv_player_seasons in the league's season schema by person id, every column; EPV from 2021-22", async () => {
        const actual = await vi.importActual<typeof import('../src/resources/playerWar')>('../src/resources/playerWar');
        sdv.from.mockResolvedValue(PW.nba);
        expect(await actual.retrievePlayerWar('nba', 2026, PID)).toEqual(PW.nba);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'player_war', { season: '2026', player_id: String(PID), limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(leagueSource('nba').schema).toBe('nba_stats');
        await actual.retrievePlayerWar('mbb', 2026, 4848625);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('mbb'), 'player_war', { season: '2026', player_id: '4848625', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await actual.retrievePlayerEpv('nba', 2026, PID);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'epv_player_seasons', { season: '2026', player_id: String(PID), limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await actual.retrievePlayerEpv('wbb', 2026, 9341835);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('wbb'), 'epv_player_seasons', { season: '2026', player_id: '9341835', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        // the producer's season row, not his game rows: one read, never summed
        expect(sdv.from).not.toHaveBeenCalledWith(expect.anything(), 'epv_player_games', expect.anything(), expect.anything(), expect.anything(), expect.anything());
        expect(EPV_FIRST_SEASON).toBe(2022);
        expect((['nba', 'wnba', 'mbb', 'wbb'] as const).map((l) => [hasEpv(l, EPV_FIRST_SEASON), hasEpv(l, EPV_FIRST_SEASON - 1)])).toEqual(Array(4).fill([true, false]));
    });
});

describe('the player page', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-war']).toBe('preview'); });
    test('off: no read and no war or epv key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(false).astro));
        expect(reads.war).not.toHaveBeenCalled();
        expect(reads.epv).not.toHaveBeenCalled();
        expect('war' in r || 'epv' in r).toBe(false);
    });
    test('on: both reads keyed by his person id, the rows on the page; a failed read is null and never cached', async () => {
        const a = fakeAstro(true);
        const r = ok(await prepareNbaPlayer(a.astro));
        expect(reads.war).toHaveBeenCalledWith('nba', 2026, PID);
        expect(reads.epv).toHaveBeenCalledWith('nba', 2026, PID);
        expect([r.war, r.epv]).toEqual([PW.nba, PW.nbaEpvSeason]);
        expect(a.cache.at(-1)).not.toBe(false);
        for (const f of [reads.war, reads.epv]) {
            f.mockRejectedValueOnce(new Error('404 player_war'));
            const b = fakeAstro(true);
            const rb = ok(await prepareNbaPlayer(b.astro));
            expect(f === reads.war ? rb.war : rb.epv).toBeNull();
            expect(b.cache.at(-1)).toBe(false);
        }
    });
    test('on, before 2021-22: no EPV read and no epv key', async () => {
        const a = fakeAstro(true);
        a.astro.url = new URL(`https://gameonpaper.com/nba/players/${PID}?season=${EPV_FIRST_SEASON - 1}`);
        const r = ok(await prepareNbaPlayer(a.astro));
        expect(reads.epv).not.toHaveBeenCalled();
        expect('epv' in r).toBe(false);
        expect(r.war).toEqual(PW.nba);
    });
});

describe('the panel', () => {
    const render = (war: any, league: string, epv?: any, season = 2026) => container.renderToString(PlayerValue, { props: { war, season, name: 'Him', ...(epv !== undefined ? { epv } : {}) }, locals: { league } as any });
    test('NBA: WAR with its 90% interval, VORP, the rating, ranks, percentile shading, the source spread and EPV added', async () => {
        const html = await render(PW.nba, 'nba', PW.nbaEpvSeason);
        expect(html).toMatch(new RegExp(`id="value-war"[\\s\\S]*>${d1(NBA.war)}</td>`));
        expect(html).toContain(`id="value-war-interval">${d1(NBA.war_lo)} to ${d1(NBA.war_hi)}<`);
        expect(html).toContain(`>${d1(NBA.vorp)}</td>`);
        expect(html).toContain(`>${signed1(NBA.rating)}</td>`);
        expect(html).toContain(`>${NBA.war_rank}</td>`); // 46, as formatRank prints it
        expect(html).toMatch(/hulk-bg-level-\d[^>]*title="92nd percentile"/);
        expect(html).toContain(`BPM ${d1(NBA.war_bpm)} · RAPM ${d1(NBA.war_rapm)} · BOBAN ${d1(NBA.war_boban)}`);
        // the producer's row as read: +236.3, rank 91 and the 84th percentile (shaded), on 1,865 plays in 53 games
        expect(html).toMatch(new RegExp(`id="value-epv-own"[^>]*>${signed1(EPV.epv_own).replace('+', '\\+')}</span> \\(rank <span id="value-epv-rank">91</span>, 84th percentile\\) on 1,865 plays in 53 games`));
        expect(html).toMatch(/class="fw-bold px-1 hulk-bg-level-\d[^"]*"[^>]*title="84th percentile"[^>]*id="value-epv-own"/);
        expect(html).toContain(`on-court EPV +/-</abbr> ${signed1(EPV.epv_on)}`);
        expect(html).toContain('over his regular-season games');
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('WAR is never printed without its interval: no producer interval says so', async () => {
        const html = await render([{ ...NBA, war_lo: null, war_hi: null }], 'nba');
        expect(html).toContain('id="value-war-interval">no interval yet<');
    });
    test('college: no sources line; no EPV read, no EPV line', async () => {
        const me = PW.mbbTeam[0];
        const html = await render([me], 'mbb');
        expect(html).toContain(`id="value-war-interval">${d1(me.war_lo)} to ${d1(me.war_hi)}<`);
        expect(html).not.toMatch(/value-sources|value-epv|BOBAN|undefined|NaN/);
        expect(await render(PW.wnba, 'wnba', undefined, 2025)).not.toContain('value-epv');
    });
    test("WNBA and college: the producer's EPV row with its rank; college says every game", async () => {
        const [, , aja, , wbb] = PW.epvProof;
        const w = await render(PW.wnba, 'wnba', aja.season_row, 2025);
        expect(w).toContain('id="value-epv-rank">1</span>, 99th percentile) on 1,705 plays in 40 games');
        expect(w).toContain('over his regular-season games');
        const c = await render(PW.wbbTeam, 'wbb', wbb.season_row);
        expect(c).toContain(`>${signed1(wbb.season_row[0].epv_own)}</span>`);
        expect(c).toContain('plays in 38 games');
        expect(c).toContain('over his games');
        expect(c).not.toMatch(/regular-season games|undefined|NaN/);
    });
    test('no producer rank: the value without a rank', async () => {
        const html = await render(PW.nba, 'nba', [{ ...EPV, epv_own_rank: null, epv_own_pct: null }]);
        expect(html).toContain('id="value-epv-own"');
        expect(html).not.toContain('value-epv-rank');
    });
    test('a failed read says so; no row says so; a failed EPV read keeps the WAR table', async () => {
        expect(await render(null, 'nba')).toContain('id="value-unavailable"');
        expect(await render([], 'wnba', undefined, 2025)).toContain('id="value-empty"');
        const html = await render(PW.nba, 'nba', null);
        expect(html).toContain('id="value-table"');
        expect(html).toContain('id="value-epv-unavailable"');
        expect(await render(PW.nba, 'nba', [])).not.toContain('value-epv');
    });
});

describe('the Impact panel', () => {
    test("keeps player_impact's WAR, relabelled \"Impact WAR\" only when asked (the Value block shows player_war's)", () => {
        expect(impactPanel(PI.nba, false)!.measures.map((m) => m.label)).toEqual(['RAPM', 'Adj. RAPM', 'SPM', 'BPM', 'BOBAN', 'WAR']);
        const both = impactPanel(PI.nba, false, true)!;
        expect(both.measures.map((m) => m.label)).toEqual(['RAPM', 'Adj. RAPM', 'SPM', 'BPM', 'BOBAN', 'Impact WAR']);
        // the same producer cell, only the name and hover change
        expect(both.measures.at(-1)!.net).toEqual(impactPanel(PI.nba, false)!.measures.at(-1)!.net);
        expect(both.measures.at(-1)!.hover).toContain('A separate estimate from the Value WAR below');
    });
});

describe('the page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(war: boolean, impact = false) {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(war, impact) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page)", async () => {
        // a Windows checkout may write the capture with CRLF; the render is LF
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(reads.war).not.toHaveBeenCalled();
    });
    test('on, Impact off: the Value section and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        expect(on).toContain('<a href="#value" class="ms-2">Value</a>');
        const section = on.match(/<section id="value"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('id="value-war-interval"');
        expect(section).toContain('id="value-epv"');
        expect(on.replace(section, '').replace('<a href="#value" class="ms-2">Value</a>', '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
    test('with the Impact panel on too: Value closes the Impact section, no Value link, and its WAR row reads "Impact WAR"', async () => {
        const [impactOnly, both] = [await page(false, true), await page(true, true)];
        expect(impactOnly).toMatch(/id="impact-war"[\s\S]*?>WAR<\/abbr>/);
        expect(both).toMatch(/id="impact-war"[\s\S]*?>Impact WAR<\/abbr>/);
        const impact = both.match(/<section id="impact"[\s\S]*?<\/section>/)![0];
        const value = impact.match(/<div id="value" class="mt-3">[\s\S]*<\/div>/)![0];
        expect(value).toContain('<h3 class="h6">Value</h3>');
        expect(value).toContain('id="value-war-interval"');
        expect(both).not.toContain('<section id="value"');
        expect(both).not.toContain('href="#value"');
        expect(both).toContain('<a href="#impact" class="ms-2">Impact</a>');
        // the Impact section with Value taken out and its WAR named back is the Impact-only one
        const impactOnlySection = impactOnly.match(/<section id="impact"[\s\S]*?<\/section>/)![0];
        expect(impact.replace(value, '').replace(/\s+<\/section>$/, '</section>').replace('>Impact WAR</abbr>', '>WAR</abbr>').replace(/title="Wins above replacement from the impact ratings[^"]*"/, ''))
            .toBe(impactOnlySection.replace(/\s+<\/section>$/, '</section>').replace(/title="Wins above replacement \(replacement level[^"]*"/, ''));
    });
});
