// BB-G56: the NBA player page's Season vs Current panel behind 'bball-current-impact'. The pure step (his player_impact row's
// season rating and his latest current_impact row as the panel; early in the season, mostly prior), the read (current_impact
// in the games schema by person id, the latest as_of), the page-side step (the flag and the NBA from 2006-07 gate the read;
// the season rating shares BB-G6's read; a failed read keeps the page and is never cached), the panel and the page: flag off
// is byte for byte the NBA byte-identity capture. On real producer output (fixtures/README.md: current-impact.json.gz).
// Every read is mocked.
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
const CI = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/current-impact.json.gz', import.meta.url))).toString()) as Record<'season' | 'latest' | 'opening', Row[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const reads = vi.hoisted(() => ({ current: vi.fn(), impact: vi.fn() }));
vi.mock('../src/resources/currentImpact', async (orig) => ({
    ...(await orig<typeof import('../src/resources/currentImpact')>()),
    retrieveCurrentImpact: (...a: unknown[]) => reads.current(...a),
}));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: (...a: unknown[]) => reads.impact(...a) }));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other reads, exactly as playerWar.test.ts mocks them
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

import PlayerCurrentImpact from '../src/components/nba/PlayerCurrentImpact.astro';
import { BASKETBALL } from '../src/basketball/config';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { CURRENT_IMPACT_FIRST_SEASON, hasCurrentImpact } from '../src/resources/currentImpact';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { FLAGS } from '../src/utils/features';
import { currentImpactPanel, EARLY_POSS } from '../src/utils/currentImpact';
import { signed1 } from '../src/utils/shotQuality';
import { fmtDate } from '../src/nba/format';

const esc = (t: string) => t.replace(/[+.]/g, (c) => `\\${c}`);

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-current-impact': false };
const locals = (on: boolean, impact = false) => ({ preview: true, flagOverrides: { ...OFF, 'bball-current-impact': on, 'bball-impact': impact } });
const [S] = CI.season;
const [NOW] = CI.latest;
const [OPEN] = CI.opening;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [...Object.values(reads), sdv.rows, sdv.from]) f.mockReset();
    reads.current.mockResolvedValue(CI.latest); reads.impact.mockResolvedValue(CI.season);
});

function fakeAstro(on: boolean, impact = false, season = 2026) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(PID) }, url: new URL(`https://gameonpaper.com/nba/players/${PID}?season=${season}`), locals: locals(on, impact), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the captures', () => {
    test("his regular-season row carries the season rating and its box prior; current_impact's opening night has no possessions", () => {
        expect([S.player_id, S.season, S.season_type]).toEqual([PID, 2026, 'Regular Season']);
        expect(S.o_reml_rapm + S.d_reml_rapm).toBeCloseTo(S.reml_rapm, 9);
        expect(S.o_box_prior + S.d_box_prior).toBeCloseTo(S.box_prior, 9);
        expect([OPEN.off_poss, OPEN.def_poss]).toEqual([0, 0]);
        expect(NOW.as_of > OPEN.as_of).toBe(true);
        expect(NOW.off_poss).toBeGreaterThan(EARLY_POSS);
        expect(NOW).not.toHaveProperty('current_impact_lo'); // no interval column: the panel shows none
    });
});

describe('currentImpactPanel', () => {
    test("the season rating and its box prior; the latest current rating, its prior (no net) and its date, as read", () => {
        const p = currentImpactPanel(CI.season, CI.latest)!;
        expect(p.season).toEqual({ rating: { off: S.o_reml_rapm, def: S.d_reml_rapm, net: S.reml_rapm }, prior: { off: S.o_box_prior, def: S.d_box_prior, net: S.box_prior } });
        expect(p.current).toEqual({
            rating: { off: NOW.o_current_impact, def: NOW.d_current_impact, net: NOW.current_impact },
            prior: { off: NOW.o_prior, def: NOW.d_prior, net: null },
            asOf: NOW.as_of, lastGame: NOW.last_game_date, offPoss: NOW.off_poss, defPoss: NOW.def_poss, early: false,
        });
    });
    test('opening night is mostly prior; either side alone still makes a panel; neither, no panel', () => {
        expect(currentImpactPanel(CI.season, CI.opening)!.current!.early).toBe(true);
        expect(currentImpactPanel(CI.season, [{ ...NOW, off_poss: null, def_poss: null }])!.current!.early).toBe(false);
        expect(currentImpactPanel(CI.season, [{ ...NOW, off_poss: null }])!.current!.early).toBe(false);
        expect(currentImpactPanel([], CI.latest)!.season).toBeNull();
        expect(currentImpactPanel(CI.season, [])!.current).toBeNull();
        // a season row before BB-D38's build: reml_rapm null, so no season rating
        expect(currentImpactPanel([{ ...S, o_reml_rapm: null, d_reml_rapm: null, reml_rapm: null }], [])).toBeNull();
        expect(currentImpactPanel([], [])).toBeNull();
    });
});

describe('the read', () => {
    test("current_impact in the NBA games schema by person id, the season's latest as_of; the NBA from 2006-07 only", async () => {
        const actual = await vi.importActual<typeof import('../src/resources/currentImpact')>('../src/resources/currentImpact');
        sdv.from.mockResolvedValue(CI.latest);
        expect(await actual.retrieveCurrentImpact('nba', 2026, PID)).toEqual(CI.latest);
        expect(sdv.from).toHaveBeenLastCalledWith(BASKETBALL.nba.gamesSource, 'current_impact', { season: '2026', player_id: String(PID), order: '-as_of', limit: '1' }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(BASKETBALL.nba.gamesSource.schema).toBe('nba');
        expect([hasCurrentImpact('nba', CURRENT_IMPACT_FIRST_SEASON), hasCurrentImpact('nba', CURRENT_IMPACT_FIRST_SEASON - 1), hasCurrentImpact('wnba', 2026), hasCurrentImpact('mbb', 2026)]).toEqual([true, false, false, false]);
    });
});

describe('the player page', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-current-impact']).toBe('preview'); });
    test('off: no read and no currentImpact key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(false).astro));
        expect(reads.current).not.toHaveBeenCalled();
        expect(reads.impact).not.toHaveBeenCalled();
        expect('currentImpact' in r).toBe(false);
    });
    test('on: both reads keyed by his person id; with the Impact panel on too, its read is shared', async () => {
        const a = fakeAstro(true);
        const r = ok(await prepareNbaPlayer(a.astro));
        expect(reads.current).toHaveBeenCalledWith('nba', 2026, PID);
        expect(reads.impact).toHaveBeenCalledWith('nba', 2026, PID);
        expect(r.currentImpact).toEqual({ seasonRows: CI.season, current: CI.latest });
        expect(a.cache.at(-1)).not.toBe(false);
        reads.impact.mockClear();
        const both = ok(await prepareNbaPlayer(fakeAstro(true, true).astro));
        expect(reads.impact).toHaveBeenCalledTimes(1);
        expect(both.impact).toEqual(CI.season);
    });
    test('a failed read is null and never cached', async () => {
        for (const f of [reads.current, reads.impact]) {
            f.mockRejectedValueOnce(new Error('503'));
            const b = fakeAstro(true);
            const rb = ok(await prepareNbaPlayer(b.astro));
            expect(f === reads.current ? rb.currentImpact!.current : rb.currentImpact!.seasonRows).toBeNull();
            expect(b.cache.at(-1)).toBe(false);
        }
    });
    test('before 2006-07: no read and no key', async () => {
        const r = ok(await prepareNbaPlayer(fakeAstro(true, false, CURRENT_IMPACT_FIRST_SEASON - 1).astro));
        expect(reads.current).not.toHaveBeenCalled();
        expect('currentImpact' in r).toBe(false);
    });
});

describe('the panel', () => {
    const render = (seasonRows: any, current: any, season = 2026) => container.renderToString(PlayerCurrentImpact, { props: { seasonRows, current, season, name: 'Him' }, locals: { league: 'nba' } as any });
    test('both ratings with their priors, the date and the possessions; no interval anywhere', async () => {
        const html = await render(CI.season, CI.latest);
        expect(html).toMatch(new RegExp(`id="current-impact-season"[\\s\\S]*?>${esc(signed1(S.reml_rapm))}</td>`));
        expect(html).toMatch(new RegExp(`id="current-impact-current"[\\s\\S]*?>${esc(signed1(NOW.current_impact))}</td>`));
        expect(html).toContain(`>${signed1(S.box_prior)}</td>`);
        expect(html).toContain(`>${signed1(NOW.o_prior)}</td>`);
        expect(html).toContain(`Current as of ${fmtDate(NOW.as_of)} &middot; last game ${fmtDate(NOW.last_game_date)}`);
        expect(html).toContain(`${NOW.off_poss.toLocaleString('en-US')} offensive`);
        expect(html).not.toMatch(/interval|±|undefined|NaN|current-impact-early/);
    });
    test('opening night says mostly prior', async () => {
        expect(await render(CI.season, CI.opening)).toContain('id="current-impact-early"');
    });
    test("an unbuilt season (2026-27's today) says so; one side missing or failed says which", async () => {
        expect(await render([], [], 2027)).toContain('No 2026-27 season or current impact for Him yet.');
        expect(await render(CI.season, [])).toContain('id="current-impact-no-current"');
        expect(await render([], CI.latest)).toContain('id="current-impact-no-season"');
        expect(await render(CI.season, null)).toContain('Current impact is temporarily unavailable.');
        expect(await render(null, null)).toContain('Season and current impact are temporarily unavailable.');
        expect(await render([], null)).toContain('id="current-impact-empty">Current impact is temporarily unavailable.<');
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
        expect(reads.current).not.toHaveBeenCalled();
    });
    test('on: the panel and its link in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        const link = '<a href="#current-impact" class="ms-2">Season vs current</a>';
        expect(on).toContain(link);
        const section = on.match(/<section id="current-impact"[\s\S]*?<\/section>/)![0];
        expect(section).toContain('id="current-impact-table"');
        expect(section).toContain('id="current-impact-season"');
        expect(section).toContain('id="current-impact-current"');
        expect(on.replace(section, '').replace(link, '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
});
