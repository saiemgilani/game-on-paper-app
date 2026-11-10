// BB-G54: the player page's Career panel behind 'bball-career'. The pure steps (his player_war / player_impact seasons as one
// table, the cohort a rank is out of, the percentile trend), the reads (one per player over the league's season range), the
// page-side step (the flag gates both reads; a failed read keeps the page and is never cached), the panel (a click opens rank,
// cohort, percentile and sample) and the page: flag off is byte for byte the NBA byte-identity capture. On real Data API rows
// (fixtures/README.md: player-career.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// a live request from a test counts as a failed auth against the Data API (429 lockout): a fetch here fails the file instead
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = any; // fixture rows: the Data API's, checked by the tests below
const PC = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-career.json.gz', import.meta.url))).toString()) as Record<'nba' | 'nbaImpact' | 'wnba' | 'wnbaImpact' | 'mbb' | 'wbb', Row[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const reads = vi.hoisted(() => ({ war: vi.fn(), impact: vi.fn() }));
vi.mock('../src/resources/playerCareer', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playerCareer')>()),
    retrievePlayerWarCareer: (...a: unknown[]) => reads.war(...a),
    retrievePlayerImpactCareer: (...a: unknown[]) => reads.impact(...a),
}));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other reads, exactly as playerWar.test.ts mocks them
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: async () => [] }));
vi.mock('../src/resources/playerWar', async (orig) => ({ ...(await orig<typeof import('../src/resources/playerWar')>()), retrievePlayerWar: async () => [], retrievePlayerEpv: async () => [] }));
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

import PlayerCareer from '../src/components/nba/PlayerCareer.astro';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { BASKETBALL } from '../src/basketball/config';
import { LEAGUES, leagueSource } from '../src/utils/league';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { FLAGS } from '../src/utils/features';
import { careerTable, cohortOf, pctLabel, trendPoints } from '../src/utils/playerCareer';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., the fixture's NBA player
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-career': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-career': on } });
const NBA_SEASONS = LEAGUES.nba.seasons;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [...Object.values(reads), sdv.rows, sdv.from]) f.mockReset();
    reads.war.mockResolvedValue(PC.nba); reads.impact.mockResolvedValue(PC.nbaImpact);
});

function fakeAstro(on: boolean) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the captures', () => {
    test("one row per player-season in every league; WAR / VORP / RAPM / BPM carry the producer's _rank, _pct and _n", () => {
        expect(PC.nba.every((r) => r.player_id === PID)).toBe(true);
        for (const rows of [PC.nba, PC.wnba, PC.mbb, PC.wbb, PC.nbaImpact, PC.wnbaImpact]) {
            expect(rows.length).toBeGreaterThan(1);
            expect(new Set(rows.map((r) => r.season)).size).toBe(rows.length);
        }
        for (const r of [...PC.nba, ...PC.wnba, ...PC.mbb, ...PC.wbb]) for (const m of ['war', 'vorp']) {
            expect(typeof r[`${m}_rank`]).toBe('number');
            expect(typeof r[`${m}_pct`]).toBe('number');
        }
        // RAPM / BPM are ranked among the season's qualifiers: his nine-game 2022 is below the gate, so null, never a number
        const unranked = PC.nbaImpact.filter((r) => r.rapm_rank == null).map((r) => r.season);
        expect(unranked).toEqual([2022]);
        for (const r of [...PC.nbaImpact, ...PC.wnbaImpact]) if (r.season !== 2022 || r.player_id !== PID) for (const m of ['rapm', 'bpm']) expect(typeof r[`${m}_rank`]).toBe('number');
        // `_n` is his own sample (the rate's denominator), not the cohort: player_war's is his possessions
        for (const r of PC.nba) expect(Math.abs(r.war_n - r.poss)).toBeLessThanOrEqual(0.5); // the producer rounds half to even
    });
});

describe('cohortOf', () => {
    test("inverts the producer's Weibull percentile exactly on every ranked cell of the captures", () => {
        const cells = [
            ...[...PC.nba, ...PC.wnba, ...PC.mbb, ...PC.wbb].flatMap((r) => ['war', 'vorp'].map((m) => [r[`${m}_rank`], r[`${m}_pct`]])),
            ...[...PC.nbaImpact, ...PC.wnbaImpact].flatMap((r) => ['rapm', 'bpm'].map((m) => [r[`${m}_rank`], r[`${m}_pct`]])),
        ].filter(([rank]) => rank != null) as [number, number][];
        expect(cells.length).toBeGreaterThan(50);
        for (const [rank, pct] of cells) {
            const n = cohortOf(rank, pct)!;
            expect(Number.isInteger(n)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(Math.floor(rank));
            expect((100 * (n + 1 - rank)) / (n + 1)).toBeCloseTo(pct, 6);
        }
        // the producer's WAR and VORP share one cohort per season
        for (const r of PC.nba) expect(cohortOf(r.war_rank, r.war_pct)).toBe(cohortOf(r.vorp_rank, r.vorp_pct));
    });
    test('null without a rank or a percentile', () => {
        expect([cohortOf(null, 50), cohortOf(3, null), cohortOf(3, 100)]).toEqual([null, null, null]);
    });
});

describe('careerTable', () => {
    test('pros: oldest season first, WAR columns then RAPM and BPM, every cell as read', () => {
        const t = careerTable(PC.nba, PC.nbaImpact)!;
        expect(t.columns.map((c) => c.key)).toEqual(['poss', 'rating', 'war', 'vorp', 'rapm', 'bpm']);
        expect(t.rows.map((r) => r.season)).toEqual([...PC.nba].map((r) => r.season).sort((a, b) => a - b));
        const r26 = t.rows.find((r) => r.season === 2026)!;
        const w = PC.nba.find((r) => r.season === 2026);
        const i = PC.nbaImpact.find((r) => r.season === 2026);
        expect(r26.cells.war).toEqual({ value: w.war, rank: w.war_rank, pct: w.war_pct, of: cohortOf(w.war_rank, w.war_pct), n: w.war_n });
        expect(r26.cells.rapm).toEqual({ value: i.rapm, rank: i.rapm_rank, pct: i.rapm_pct, of: cohortOf(i.rapm_rank, i.rapm_pct), n: i.rapm_n });
        expect(r26.cells.poss).toEqual({ value: w.poss, rank: null, pct: null, of: null, n: null });
    });
    test('college (no impact read) and a failed impact read: the WAR columns only', () => {
        expect(careerTable(PC.mbb, undefined)!.columns.map((c) => c.key)).toEqual(['poss', 'rating', 'war', 'vorp']);
        expect(careerTable(PC.nba, null)!.columns.map((c) => c.key)).toEqual(['poss', 'rating', 'war', 'vorp']);
    });
    test('a season with two team rows keeps the one with the most possessions; nothing at all is null', () => {
        const [a] = PC.mbb;
        const t = careerTable([a, { ...a, poss: a.poss / 2, war: -9 }], undefined)!;
        expect(t.rows).toHaveLength(1);
        expect(t.rows[0].cells.war.value).toBe(a.war);
        expect(careerTable([], [])).toBeNull();
    });
});

describe('trendPoints and pctLabel', () => {
    test('a dot per ranked season, a line through consecutive ones, a gap where he was not ranked; null under two', () => {
        const t = careerTable(PC.wnba, PC.wnbaImpact)!;
        const full = trendPoints(t.rows, 'war', 72, 24)!;
        expect(full.dots).toHaveLength(t.rows.length);
        expect(full.runs).toHaveLength(1);
        expect(full.dots[0][0]).toBe(0);
        expect(full.dots.at(-1)![0]).toBe(72);
        for (const [, y] of full.dots) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(24); }
        const holed = t.rows.map((r, i) => (i === 2 ? { ...r, cells: { ...r.cells, war: { ...r.cells.war, pct: null } } } : r));
        expect(trendPoints(holed, 'war', 72, 24)!.runs).toHaveLength(2);
        expect(trendPoints(t.rows.slice(0, 1), 'war', 72, 24)).toBeNull();
    });
    test('the text never prints the 0th or 100th percentile', () => {
        expect([pctLabel(99.83), pctLabel(0.17), pctLabel(50.4)]).toEqual([99, 1, 50]);
    });
});

describe('the reads', () => {
    test("player_war in the league's season schema and player_impact (pros, regular season), the season range and his id", async () => {
        const actual = await vi.importActual<typeof import('../src/resources/playerCareer')>('../src/resources/playerCareer');
        sdv.from.mockResolvedValue(PC.nba);
        expect(await actual.retrievePlayerWarCareer('nba', 1998, 2026, PID)).toEqual(PC.nba);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'player_war', { season__gte: '1998', season__lte: '2026', player_id: String(PID), limit: '40' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await actual.retrievePlayerWarCareer('wbb', 2003, 2026, 5239100);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('wbb'), 'player_war', { season__gte: '2003', season__lte: '2026', player_id: '5239100', limit: '40' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await actual.retrievePlayerImpactCareer('wnba', 1997, 2026, 1628932);
        expect(sdv.from).toHaveBeenLastCalledWith(BASKETBALL.wnba.gamesSource, 'player_impact', { season__gte: '1997', season__lte: '2026', player_id: '1628932', season_type: 'Regular Season', limit: '40' }, 21600, true, NBA_READ_TIMEOUT_MS);
    });
});

describe('the player page', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-career']).toBe('preview'); });
    test('off: no read and no career key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(false).astro));
        expect(reads.war).not.toHaveBeenCalled();
        expect(reads.impact).not.toHaveBeenCalled();
        expect('career' in r).toBe(false);
    });
    test("on: both reads over the league's season range, the rows on the page; a failed read is null and never cached", async () => {
        const a = fakeAstro(true);
        const r = ok(await prepareNbaPlayer(a.astro));
        const [first, last] = [NBA_SEASONS[0], NBA_SEASONS.at(-1)];
        expect(reads.war).toHaveBeenCalledWith('nba', first, last, PID);
        expect(reads.impact).toHaveBeenCalledWith('nba', first, last, PID);
        expect(r.career).toEqual({ war: PC.nba, impact: PC.nbaImpact });
        expect(a.cache.at(-1)).not.toBe(false);
        for (const f of [reads.war, reads.impact]) {
            f.mockRejectedValueOnce(new Error('503'));
            const b = fakeAstro(true);
            const rb = ok(await prepareNbaPlayer(b.astro));
            expect(f === reads.war ? rb.career!.war : rb.career!.impact).toBeNull();
            expect(b.cache.at(-1)).toBe(false);
        }
    });
});

describe('the panel', () => {
    const render = (war: any, league: string, impact?: any, season = 2026, hisSeasons = [2025, 2026]) => container.renderToString(PlayerCareer, {
        props: { war, ...(impact !== undefined ? { impact } : {}), season, current: 2026, hisSeasons, personId: PID, name: 'Him' }, locals: { league } as any,
    });
    test('NBA: a row per season, the page season marked, his other page seasons linked, a click opens rank / cohort / percentile / sample', async () => {
        const html = await render(PC.nba, 'nba', PC.nbaImpact);
        for (const r of PC.nba) expect(html).toContain(`id="career-${r.season}"`);
        expect(html).toMatch(/id="career-2026" class="table-active" aria-current="true"/);
        expect(html).toContain(`href="/nba/players/${PID}?season=2025"`);
        expect(html).not.toContain(`href="/nba/players/${PID}?season=2021"`); // no shots that season in hisSeasons: no page, no link
        const w = PC.nba.find((r) => r.season === 2026);
        expect(html).toContain(`<summary>${w.war.toFixed(1)}</summary>`);
        expect(html).toContain(`Rank ${w.war_rank} of ${cohortOf(w.war_rank, w.war_pct)} · ${pctLabel(w.war_pct)}th percentile · on ${w.war_n.toLocaleString('en-US')} possessions`);
        expect(html).toMatch(/id="career-2022"[\s\S]*?Not ranked this season/); // his nine-game RAPM, below the gate
        expect(html).toContain('id="career-trend"');
        expect((html.match(/class="career-trend/g) ?? []).length).toBe(4); // WAR, VORP, RAPM, BPM
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('college: the WAR columns only; a failed impact read says so and keeps the table', async () => {
        const mbb = await render(PC.mbb, 'mbb', undefined, 2026, [2026]);
        expect(mbb).not.toMatch(/RAPM|career-impact-unavailable|undefined|NaN/);
        expect((mbb.match(/class="career-trend/g) ?? []).length).toBe(2);
        const failed = await render(PC.nba, 'nba', null);
        expect(failed).toContain('id="career-impact-unavailable"');
        expect(failed).toContain('id="career-table"');
    });
    test('a failed read says so; no rows says so', async () => {
        expect(await render(null, 'nba')).toContain('id="career-unavailable"');
        expect(await render([], 'wbb', undefined)).toContain('id="career-empty"');
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
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(reads.war).not.toHaveBeenCalled();
    });
    test('on: the panel and its link in "On this page"', async () => {
        const on = await page(true);
        expect(on).toContain('<a href="#career" class="ms-2">Career</a>');
        expect(on).toMatch(/<section id="career"[\s\S]*id="career-table"/);
    });
});
