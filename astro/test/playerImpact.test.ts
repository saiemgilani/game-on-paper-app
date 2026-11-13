// BB-G6: the player page's Impact panel behind 'bball-impact'. The pure step (the measures from the producer's columns, the
// boban_* columns never their darko_* aliases, a rank only when the producer ships one), the read (the games schema's
// player_impact for the NBA/WNBA, player_value in college), the page-side step (the flag gates the read; a failed read keeps
// the page and is never cached), the panel and the page: flag off is byte for byte the NBA byte-identity capture. College
// reads ncaa_rapm by his season's stats.ncaa.org id from ncaa_player_crosswalk. On real Data API reads (fixtures/README.md:
// player-impact.json.gz, player-impact-xwalk.json.gz). Every read is mocked.
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
// against the Data API from this IP (429 lockout). A fetch here fails the file instead (as rollingMovers.render.test.ts).
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const PI = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-impact.json.gz', import.meta.url))).toString()) as Record<'nba' | 'wnba' | 'mbbTeam' | 'wbbTeam', Record<string, any>[]>;
// college through the crosswalk: Cameron Boozer (Duke, ESPN 5041935 -> stats.ncaa.org 11195975), Joyce Edwards (South Carolina, ESPN 5239100 -> 9342023)
const XW = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-impact-xwalk.json.gz', import.meta.url))).toString()) as Record<'mbbXwalk' | 'mbbRapm' | 'mbbPv' | 'wbbXwalk' | 'wbbRapm', Record<string, any>[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const impact = vi.hoisted(() => vi.fn());
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: (...a: unknown[]) => impact(...a) }));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other reads, exactly as byteIdentity.render.test.ts mocks them
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

import PlayerImpact from '../src/components/nba/PlayerImpact.astro';
import { BASKETBALL } from '../src/basketball/config';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { leagueSource } from '../src/utils/league';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { FLAGS } from '../src/utils/features';
import { COLLEGE_IMPACT, impactPanel, impactShown } from '../src/utils/playerImpact';
import { signed1 } from '../src/utils/shotQuality';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-player-situations': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-impact': on } });
const [NBA] = PI.nba;
const top = (rows: Record<string, any>[]) => [...rows].sort((a, b) => b.min - a.min)[0];

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => { for (const f of [impact, sdv.rows, sdv.from]) f.mockReset(); impact.mockResolvedValue(PI.nba); });

function fakeAstro(on: boolean) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the captures', () => {
    test("one regular-season row per pro player; the producer's nets are the sums of their halves", () => {
        for (const rows of [PI.nba, PI.wnba]) {
            expect(rows).toHaveLength(1);
            const [r] = rows;
            expect(r.season_type).toBe('Regular Season');
            for (const [o, d, n] of [['o_rapm', 'd_rapm', 'rapm'], ['o_adj_rapm', 'd_adj_rapm', 'adj_rapm'], ['ospm', 'dspm', 'spm'], ['obpm', 'dbpm', 'bpm']]) expect(r[o] + r[d]).toBeCloseTo(r[n], 9);
            expect(r.off_poss).toBeGreaterThan(1000);
        }
        expect(NBA.player_id).toBe(PID);
        for (const rows of [PI.mbbTeam, PI.wbbTeam]) for (const r of rows) expect(r.box_obpm + r.box_dbpm).toBeCloseTo(r.box_bpm, 9);
    });
});

describe('impactPanel', () => {
    test("NBA/WNBA: RAPM, Adj. RAPM, SPM, BPM (each Off/Def/Net), BOBAN, WAR, each the producer's column; no rank columns today", () => {
        for (const rows of [PI.nba, PI.wnba]) {
            const p = impactPanel(rows, false)!;
            const [r] = rows;
            expect(p.measures.map((m) => m.label)).toEqual(['RAPM', 'Adj. RAPM', 'SPM', 'BPM', 'BOBAN', 'WAR']);
            expect(p.measures.map((m) => [m.off?.value ?? null, m.def?.value ?? null, m.net.value])).toEqual([
                [r.o_rapm, r.d_rapm, r.rapm], [r.o_adj_rapm, r.d_adj_rapm, r.adj_rapm], [r.ospm, r.dspm, r.spm], [r.obpm, r.dbpm, r.bpm],
                [null, null, r.boban_filtered_skill], [null, null, r.war],
            ]);
            expect(p.ranked).toBe(false);
            expect([p.offPoss, p.defPoss, p.gp, p.min]).toEqual([r.off_poss, r.def_poss, r.gp, r.min]);
            expect(p.projection).toEqual({ rating: r.boban_projected_rating, sd: r.boban_projected_sd });
            expect(p.qualified).toBeNull();
        }
    });
    test('BOBAN is read from boban_* only: without them it is blank even though the darko_* aliases are there', () => {
        const row = Object.fromEntries(Object.entries(NBA).filter(([k]) => !k.startsWith('boban_')));
        expect(row.darko_filtered_skill).not.toBeNull();
        const p = impactPanel([row], false)!;
        expect(p.measures.find((m) => m.label === 'BOBAN')!.net.value).toBeNull();
        expect(p.projection).toBeNull();
    });
    test("a rank and percentile show only when the producer ships <m>_rank / <m>_pct (the columns BB-D2's grammar names)", () => {
        const p = impactPanel([{ ...NBA, rapm_rank: 3, rapm_pct: 98.4 }], false)!;
        expect(p.ranked).toBe(true);
        expect(p.measures[0].net).toEqual({ col: 'rapm', value: NBA.rapm, rank: 3, pct: 98.4 });
        expect(p.measures[0].off!.rank).toBeNull();
    });
    test("college shows now that ncaa_player_crosswalk exists (Akshay on #408: wait for a crosswalk); the pros always show", () => {
        expect(COLLEGE_IMPACT).toBe(true);
        expect(impactShown(true)).toBe(true);
        expect(impactShown(false)).toBe(true);
    });
    test("college with his ncaa_rapm columns: RAPM (Off/Def/Net) over its possessions, then box BPM, each the producer's column", () => {
        const edwards = PI.wbbTeam.filter((r) => r.player_id === String(XW.wbbXwalk[0].espn_athlete_id));
        for (const [pv, [rapm]] of [[XW.mbbPv, XW.mbbRapm], [edwards, XW.wbbRapm]] as const) {
            const [me] = pv;
            const p = impactPanel([{ ...me, ...rapm }], true)!;
            expect(p.measures.map((m) => [m.label, m.off!.value, m.def!.value, m.net.value])).toEqual([
                ['RAPM', rapm.orapm, rapm.drapm, rapm.rapm_net], ['BPM', me.box_obpm, me.box_dbpm, me.box_bpm]]);
            expect([p.offPoss, p.defPoss, p.min, p.projection]).toEqual([rapm.off_poss, rapm.def_poss, me.min, null]);
        }
    });
    test('college with no crosswalk pair: box BPM and minutes from player_value; the row with the most minutes when there are two', () => {
        for (const rows of [PI.mbbTeam, PI.wbbTeam]) {
            const me = top(rows);
            const p = impactPanel([{ ...me, team_id: '1', min: 1 }, me], true)!;
            expect(p.measures.map((m) => [m.label, m.off!.value, m.def!.value, m.net.value])).toEqual([['BPM', me.box_obpm, me.box_dbpm, me.box_bpm]]);
            expect([p.min, p.qualified, p.offPoss, p.projection]).toEqual([me.min, me.qualified, null, null]);
        }
        const unq = PI.mbbTeam.find((r) => r.qualified === false)!;
        expect(impactPanel([unq], true)!.qualified).toBe(false);
    });
    test('no row, no panel', () => {
        expect(impactPanel([], false)).toBeNull();
        expect(impactPanel([], true)).toBeNull();
    });
});

describe('the read', () => {
    test("NBA/WNBA: the games schema's player_impact, the regular season, by person id; college: player_value by ESPN id", async () => {
        const { retrievePlayerImpact } = await vi.importActual<typeof import('../src/resources/playerImpact')>('../src/resources/playerImpact');
        sdv.from.mockResolvedValue(PI.nba);
        expect(await retrievePlayerImpact('nba', 2026, PID)).toEqual(PI.nba);
        // strict and bounded by the game page's read timeout (CodeRabbit on #408): a stall is a rejection, so the panel's null
        expect(sdv.from).toHaveBeenCalledWith(BASKETBALL.nba.gamesSource, 'player_impact', { season: '2026', player_id: String(PID), limit: '5', season_type: 'Regular Season' }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(BASKETBALL.nba.gamesSource.schema).toBe('nba');
        await retrievePlayerImpact('wnba', 2025, 1628932);
        expect(sdv.from.mock.calls[1][0].schema).toBe('wnba');
        // no select: a producer rank column reaches the page the day it ships
        for (const call of sdv.from.mock.calls) expect(call[2]).not.toHaveProperty('select');
    });
    // the captures served as the Data API filters them: a row only for the season and id it is keyed by, `select`'s columns only
    const serve = (src: Record<string, Record<string, any>[]>) => sdv.from.mockImplementation(async (_s: unknown, table: string, q: Record<string, string>) => {
        const rows = ({ ncaa_player_crosswalk: src.xwalk, ncaa_rapm: src.rapm, player_value: src.pv } as Record<string, Record<string, any>[]>)[table];
        const key = table === 'ncaa_player_crosswalk' ? 'espn_athlete_id' : 'player_id';
        const pick = (r: Record<string, any>) => (q.select ? Object.fromEntries(q.select.split(',').map((c) => [c, r[c]])) : r);
        return rows.filter((r) => String(r.season) === q.season && String(r[key]) === q[key]).map(pick);
    });
    test("college: player_value by his ESPN id, ncaa_rapm by his season's stats.ncaa.org id from ncaa_player_crosswalk", async () => {
        const { retrievePlayerImpact } = await vi.importActual<typeof import('../src/resources/playerImpact')>('../src/resources/playerImpact');
        const cases = [
            ['mbb', 5041935, { xwalk: XW.mbbXwalk, rapm: XW.mbbRapm, pv: XW.mbbPv }],
            ['wbb', 5239100, { xwalk: XW.wbbXwalk, rapm: XW.wbbRapm, pv: PI.wbbTeam }],
        ] as const;
        for (const [league, id, src] of cases) {
            sdv.from.mockReset();
            serve(src);
            const ncaaId = src.xwalk[0].ncaa_player_id;
            expect(ncaaId).not.toBe(String(id)); // the two ids differ, so reading ncaa_rapm by the page's id finds nothing
            const rows = await retrievePlayerImpact(league, 2026, id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ player_id: String(id), box_bpm: src.pv.find((r) => r.player_id === String(id))!.box_bpm, rapm_net: src.rapm[0].rapm_net, off_poss: src.rapm[0].off_poss });
            const from = leagueSource(league);
            expect(sdv.from).toHaveBeenCalledWith(from, 'ncaa_player_crosswalk', { season: '2026', espn_athlete_id: String(id), select: 'ncaa_player_id', limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
            expect(sdv.from).toHaveBeenCalledWith(from, 'ncaa_rapm', { season: '2026', player_id: ncaaId, select: 'orapm,drapm,rapm_net,off_poss,def_poss', limit: '1' }, 21600, true, NBA_READ_TIMEOUT_MS);
            expect(sdv.from).toHaveBeenCalledWith(from, 'player_value', { season: '2026', player_id: String(id), limit: '5' }, 21600, true, NBA_READ_TIMEOUT_MS);
        }
    });
    test('college: the crosswalk is season-filtered (a new stats.ncaa.org id every season); no pair is box BPM only, with no RAPM read', async () => {
        const { retrievePlayerImpact } = await vi.importActual<typeof import('../src/resources/playerImpact')>('../src/resources/playerImpact');
        const lastSeason = { ...XW.mbbPv[0], season: 2025 };
        serve({ xwalk: XW.mbbXwalk, rapm: XW.mbbRapm, pv: [lastSeason] });
        expect(await retrievePlayerImpact('mbb', 2025, 5041935)).toEqual([lastSeason]);
        expect(sdv.from.mock.calls.map((c) => c[1]).sort()).toEqual(['ncaa_player_crosswalk', 'player_value']);
        // a failed crosswalk read is the panel's "unavailable", never "no RAPM"
        sdv.from.mockReset();
        sdv.from.mockImplementation(async (_s: unknown, table: string) => { if (table === 'ncaa_player_crosswalk') throw new Error('down'); return XW.mbbPv; });
        await expect(retrievePlayerImpact('mbb', 2026, 5041935)).rejects.toThrow('down');
    });
});

describe('the player page', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-impact']).toBe('preview'); });
    test('off: no read and no impact key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(false).astro));
        expect(impact).not.toHaveBeenCalled();
        expect('impact' in r).toBe(false);
    });
    test('on: one read keyed by his person id, the rows on the page; a failed read is null and never cached', async () => {
        const a = fakeAstro(true);
        const r = ok(await prepareNbaPlayer(a.astro));
        expect(impact).toHaveBeenCalledWith('nba', 2026, PID);
        expect(r.impact).toEqual(PI.nba);
        expect(a.cache.at(-1)).not.toBe(false);
        impact.mockRejectedValueOnce(new Error('down'));
        const b = fakeAstro(true);
        expect(ok(await prepareNbaPlayer(b.astro)).impact).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
});

describe('the panel', () => {
    const render = (rows: any, league: string, season = 2026) => container.renderToString(PlayerImpact, { props: { rows, season, name: 'Him' }, locals: { league } as any });
    test('NBA: six measures, the possessions they come from, the BOBAN projection; no rank column without producer ranks', async () => {
        const html = await render(PI.nba, 'nba');
        for (const id of ['rapm', 'adj_rapm', 'spm', 'bpm', 'boban_filtered_skill', 'war']) expect(html).toContain(`id="impact-${id}"`);
        expect(html).toContain(`${NBA.off_poss.toLocaleString('en-US')} offensive and ${NBA.def_poss.toLocaleString('en-US')} defensive possessions`);
        // adjusted RAPM shows its trio like RAPM's (Akshay on #408), and the caption no longer says "net only"
        for (const c of ['o_rapm', 'd_rapm', 'rapm', 'o_adj_rapm', 'd_adj_rapm', 'adj_rapm', 'war']) expect(html).toContain(`>${signed1(NBA[c])}</td>`);
        expect(html).not.toContain('net only');
        // full width, like the page's other sections (Akshay on #408: the half-width table left the right half empty)
        expect(html).toContain('<div class="table-responsive">');
        expect(html).not.toContain('col-lg-6');
        expect(html).toContain(`± ${NBA.boban_projected_sd.toFixed(1)}`);
        expect(html).not.toContain('>Rank<');
        expect(html).not.toContain('hulk-bg-level');
        expect(html).not.toMatch(/undefined|NaN|darko/i);
    });
    test("with producer ranks: a Rank column per side, the cell shaded by the producer's percentile", async () => {
        const html = await render([{ ...NBA, rapm_rank: 3, rapm_pct: 98.4 }], 'nba');
        expect(html.match(/>Rank</g)).toHaveLength(3);
        expect(html).toMatch(/hulk-bg-level-9[^>]*title="98th percentile"/);
        expect(html).toContain('>3<');
        expect(html).toContain('Rank among the league’s qualified players. Shading by percentile.');
    });
    test('a percentile without a rank still shades its cell, with no Rank column (CodeRabbit on #408)', async () => {
        const html = await render([{ ...NBA, rapm_pct: 98.4 }], 'nba');
        expect(html).not.toContain('>Rank<');
        expect(html).toMatch(/hulk-bg-level-9[^>]*title="98th percentile"/);
        expect(html).toContain(' Shading by percentile.');
        expect(html).not.toContain('Rank among');
    });
    test('college with RAPM: RAPM then BPM, its possessions and his minutes', async () => {
        const [me, rapm] = [XW.mbbPv[0], XW.mbbRapm[0]];
        const html = await render([{ ...me, ...rapm }], 'mbb');
        expect(html).toContain('id="impact-rapm_net"');
        expect(html).toContain('id="impact-box_bpm"');
        for (const v of [rapm.orapm, rapm.drapm, rapm.rapm_net, me.box_bpm]) expect(html).toContain(`>${signed1(v)}</td>`);
        expect(html).toContain(`${rapm.off_poss.toLocaleString('en-US')} offensive and ${rapm.def_poss.toLocaleString('en-US')} defensive possessions`);
        expect(html).toContain(`${me.min.toLocaleString('en-US')} MIN`);
        expect(html).not.toMatch(/BOBAN|WAR|undefined|NaN/);
        // a crosswalk pair and a RAPM row but no player_value row: RAPM and its possessions, no minutes and no BPM
        const only = await render([rapm], 'mbb');
        expect(only).toContain(`${rapm.def_poss.toLocaleString('en-US')} defensive possessions</p>`);
        expect(only).not.toMatch(/MIN|impact-box_bpm|n\/a/);
    });
    test('college with no crosswalk pair: box BPM only, with minutes', async () => {
        const me = top(PI.mbbTeam);
        const html = await render([me], 'mbb');
        expect(html.match(/id="impact-/g)).toHaveLength(3); // the sample line, the table and its one row
        expect(html).toContain('id="impact-box_bpm"');
        expect(html).toContain(`${me.min.toLocaleString('en-US')} MIN`);
        expect(html).not.toContain('below the qualifying minutes');
        expect(html).not.toMatch(/RAPM|BOBAN|defensive possessions|undefined|NaN/);
        expect(await render([PI.mbbTeam.find((r) => r.qualified === false)], 'mbb')).toContain('below the qualifying minutes');
    });
    test('a failed read says so; no row says so', async () => {
        expect(await render(null, 'nba')).toContain('id="impact-unavailable"');
        expect(await render([], 'wnba', 2025)).toContain('id="impact-empty"');
    });
});

describe('the page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(on: boolean) {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page)", async () => {
        // a Windows checkout may write the capture with CRLF; the render is LF
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(impact).not.toHaveBeenCalled();
    });
    test('on: the panel and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        expect(on).toContain('<a href="#impact" class="ms-2">Impact</a>');
        const section = on.match(/<section id="impact"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('id="impact-rapm"');
        expect(on.replace(section, '').replace('<a href="#impact" class="ms-2">Impact</a>', '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
});
