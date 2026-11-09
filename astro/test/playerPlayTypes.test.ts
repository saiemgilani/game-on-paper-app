// BB-G19: the NBA player page's Play types and Defense panels behind 'bball-play-types'. The fixture against stats.nba.com
// (the Data API's Synergy rows are its own, to the digit), the pure steps (offense and defense ordered by frequency, a
// traded player's most-games team, the matchup positions in order), the reads (nba_stats, regular season, per-mode and a
// small limit; matchups only from 2017-18, nothing before 2015-16 or outside the NBA), the page-side step (the flag gates
// every read; a failed read is its own "unavailable" line and is never cached), the panels and the page: flag off is
// byte for byte the NBA byte-identity capture. On live Data API reads (fixtures/README.md: player-play-types.json.gz).
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

type Row = any; // fixture rows: the Data API's and stats.nba.com's, checked by the tests below
type Player = Record<'synergy' | 'hustle' | 'rollup' | 'matchups', Row[]>;
const PT = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/player-play-types.json.gz', import.meta.url))).toString()) as { porter: Player; zubac: Player; statsNba: Row[] };
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const reads = vi.hoisted(() => ({ synergy: vi.fn(), hustle: vi.fn(), rollup: vi.fn(), matchups: vi.fn() }));
vi.mock('../src/resources/playerPlayTypes', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playerPlayTypes')>()),
    retrievePlayerSynergy: (...a: unknown[]) => reads.synergy(...a),
    retrievePlayerHustle: (...a: unknown[]) => reads.hustle(...a),
    retrievePlayerMatchupRollup: (...a: unknown[]) => reads.rollup(...a),
    retrievePlayerTopMatchups: (...a: unknown[]) => reads.matchups(...a),
}));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the player page's other flagged reads, as playerWar.test.ts mocks them (all off below, so none is called)
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

import PlayerPlayTypes from '../src/components/nba/PlayerPlayTypes.astro';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { hasMatchups, hasPlayTypes, MATCHUPS_FIRST_SEASON, SYNERGY_FIRST_SEASON, TOP_MATCHUPS } from '../src/resources/playerPlayTypes';
import { prepareBasketballPlayer } from '../src/routes/basketball/player';
import { FLAGS } from '../src/utils/features';
import { leagueSource } from '../src/utils/league';
import { matchupRollup, PLAY_TYPE_LABELS, playTypesPanel, topMatchups } from '../src/utils/playerPlayTypes';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const ZUBAC = 1627826; // traded LAC to IND in 2025-26: Synergy rows for both teams
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-war': false, 'bball-play-types': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-play-types': on } });
const { porter: MPJ, zubac: ZU } = PT;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the page's season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [...Object.values(reads), sdv.rows, sdv.from]) f.mockReset();
    reads.synergy.mockResolvedValue(MPJ.synergy); reads.hustle.mockResolvedValue(MPJ.hustle);
    reads.rollup.mockResolvedValue(MPJ.rollup); reads.matchups.mockResolvedValue(MPJ.matchups);
});

function fakeAstro(on: boolean, path: string, id: number, season = 2026) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(id) }, url: new URL(`https://gameonpaper.com${path}/${id}?season=${season}`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the fixture against stats.nba.com', () => {
    test("every Synergy row is stats.nba.com's own: frequency, possessions, PPP and percentile to the digit, none missing", () => {
        const nba = new Map(PT.statsNba.map((r) => [`${r.PLAYER_ID}|${r.TEAM_ID}|${r.TYPE_GROUPING}|${r.PLAY_TYPE}`, r]));
        let n = 0;
        for (const [pid, p] of [[PID, MPJ], [ZUBAC, ZU]] as const) {
            for (const r of p.synergy) {
                const o = nba.get(`${pid}|${r.team_id}|${r.type_grouping}|${r.play_type}`);
                expect(o, `${pid} ${r.team_abbreviation} ${r.type_grouping} ${r.play_type}`).toBeDefined();
                expect([r.poss_pct, r.poss, r.ppp, r.percentile, r.gp]).toEqual([o.POSS_PCT, o.POSS, o.PPP, o.PERCENTILE, o.GP]);
                n += 1;
            }
        }
        expect(n).toBe(PT.statsNba.length); // 31 rows: 18 his, 13 Zubac's over two teams
        expect(n).toBe(31);
    });
    test('every play type key has a label', () => {
        for (const r of [...MPJ.synergy, ...ZU.synergy]) expect(PLAY_TYPE_LABELS[r.play_type]).toBeDefined();
    });
});

describe('the pure steps', () => {
    test('offense and defense, each most frequent first, every row kept', () => {
        const p = playTypesPanel(MPJ.synergy)!;
        expect(p.team).toBe('BKN');
        expect(p.otherTeams).toEqual([]);
        expect(p.offense.map((l) => l.key)).toEqual(['Spotup', 'Handoff', 'OffScreen', 'Transition', 'Cut', 'Isolation', 'PRBallHandler', 'OffRebound', 'Misc', 'Postup', 'PRRollMan']);
        expect(p.offense[0]).toEqual({ key: 'Spotup', label: 'Spot up', freq: 0.213, poss: 238, ppp: 0.954, pct: 0.316 });
        expect(p.defense.map((l) => l.key)).toEqual(['Spotup', 'PRBallHandler', 'Isolation', 'Handoff', 'PRRollMan', 'Postup', 'OffScreen']);
        expect(p.offense.length + p.defense.length).toBe(MPJ.synergy.length);
        // a tie in frequency (both 4.9%) goes by label
        expect(p.offense.slice(6, 8).map((l) => [l.label, l.freq])).toEqual([['Pick & roll ball handler', 0.049], ['Putbacks', 0.049]]);
    });
    test("a traded player: the team he played the most games for, the other named, its rows not mixed in", () => {
        const p = playTypesPanel(ZU.synergy)!;
        expect([p.team, p.gp, p.otherTeams]).toEqual(['LAC', 40, ['IND']]);
        expect(p.offense.find((l) => l.key === 'Postup')!.poss).toBe(145); // LAC's 145, not IND's 21 or the sum
        expect(p.offense.length + p.defense.length).toBe(ZU.synergy.filter((r) => r.team_abbreviation === 'LAC').length);
    });
    test('no row is no panel', () => { expect(playTypesPanel([])).toBeNull(); });
    test('matchups: guards, forwards, centers, then all; the most-guarded players first', () => {
        expect(matchupRollup(MPJ.rollup)!.map((r) => r.row.position)).toEqual(['G', 'F', 'C', 'TOTAL']);
        expect(matchupRollup([])).toBeNull();
        const top = topMatchups([...MPJ.matchups].reverse());
        expect(new Set(top)).toEqual(new Set(MPJ.matchups));
        const poss = top.map((m) => m.partial_poss!);
        expect(poss).toEqual([...poss].sort((a, b) => b - a));
        expect(top[0].off_player_name).toBe('Andrew Wiggins');
    });
});

describe('the reads', () => {
    test('nba_stats, regular season, by season and id, per-mode, a select and a small limit; strict and bounded', async () => {
        const R = await vi.importActual<typeof import('../src/resources/playerPlayTypes')>('../src/resources/playerPlayTypes');
        sdv.from.mockResolvedValue([]);
        const base = { season: '2026', season_type: 'regular-season' };
        await R.retrievePlayerSynergy(2026, PID);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'synergy', { ...base, player_id: String(PID), per_mode: 'totals', select: 'team_id,team_abbreviation,type_grouping,play_type,gp,poss,poss_pct,ppp,percentile', limit: '120' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await R.retrievePlayerHustle(2026, PID);
        expect(sdv.from.mock.lastCall!.slice(1, 3)).toEqual(['hustle_player', { ...base, player_id: String(PID), per_mode: 'pergame', select: 'g,min,deflections,contested_shots,contested_shots_3_pt,charges_drawn,def_loose_balls_recovered,def_boxouts', limit: '5' }]);
        await R.retrievePlayerMatchupRollup(2026, PID);
        expect(sdv.from.mock.lastCall!.slice(1, 3)).toEqual(['matchups_rollup', { ...base, def_player_id: String(PID), per_mode: 'totals', select: 'position,percent_of_time,partial_poss,player_pts,matchup_fgm,matchup_fga,matchup_fg3_m,matchup_fg3_a', limit: '10' }]);
        await R.retrievePlayerTopMatchups(2026, PID);
        expect(sdv.from.mock.lastCall!.slice(1, 3)).toEqual(['matchups', { ...base, def_player_id: String(PID), per_mode: 'totals', order: '-partial_poss', select: 'off_player_id,off_player_name,gp,partial_poss,player_pts,matchup_fgm,matchup_fga,matchup_fg3_m,matchup_fg3_a', limit: String(TOP_MATCHUPS) }]);
        expect(sdv.from.mock.calls.every((c) => c[0].schema === 'nba_stats' && c[4] === true && c[5] === NBA_READ_TIMEOUT_MS)).toBe(true);
    });
    test('the seasons: play types and hustle from 2015-16, matchups from 2017-18, the NBA only', () => {
        expect([SYNERGY_FIRST_SEASON, MATCHUPS_FIRST_SEASON]).toEqual([2016, 2018]);
        expect([hasPlayTypes('nba', 2015), hasPlayTypes('nba', 2016), hasMatchups('nba', 2017), hasMatchups('nba', 2018)]).toEqual([false, true, false, true]);
        for (const l of ['wnba', 'mbb', 'wbb'] as const) expect([hasPlayTypes(l, 2026), hasMatchups(l, 2026)]).toEqual([false, false]);
    });
});

describe('the player page step', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-play-types']).toBe('preview'); });
    test('off: no read and no playTypes key', async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(false, '/nba/players', PID).astro, 'nba'));
        expect(Object.values(reads).every((f) => f.mock.calls.length === 0)).toBe(true);
        expect('playTypes' in r).toBe(false);
    });
    test('on: the four reads keyed by his person id; the page is cached', async () => {
        const a = fakeAstro(true, '/nba/players', PID);
        const r = ok(await prepareBasketballPlayer(a.astro, 'nba'));
        for (const f of Object.values(reads)) expect(f).toHaveBeenCalledWith(2026, PID);
        expect(r.playTypes).toEqual({ synergy: MPJ.synergy, hustle: MPJ.hustle, rollup: MPJ.rollup, matchups: MPJ.matchups });
        expect(a.cache.at(-1)).not.toBe(false);
    });
    test('one failed read is that one null, the rest kept, and the page is not cached', async () => {
        reads.rollup.mockRejectedValueOnce(new Error('down'));
        const a = fakeAstro(true, '/nba/players', PID);
        const r = ok(await prepareBasketballPlayer(a.astro, 'nba'));
        expect(r.playTypes).toEqual({ synergy: MPJ.synergy, hustle: MPJ.hustle, rollup: null, matchups: MPJ.matchups });
        expect(a.cache.at(-1)).toBe(false);
    });
    test('2016-17: play types and hustle, no matchup read or key', async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(true, '/nba/players', PID, 2017).astro, 'nba'));
        expect(reads.synergy).toHaveBeenCalledWith(2017, PID);
        expect(reads.rollup).not.toHaveBeenCalled();
        expect(reads.matchups).not.toHaveBeenCalled();
        expect(Object.keys(r.playTypes!)).toEqual(['synergy', 'hustle']);
    });
    test('2014-15 and the WNBA: no read and no key, flag on', async () => {
        for (const [lg, path, season] of [['nba', '/nba/players', 2015], ['wnba', '/wnba/players', 2025]] as const) {
            const r = ok(await prepareBasketballPlayer(fakeAstro(true, path, PID, season).astro, lg));
            expect('playTypes' in r).toBe(false);
        }
        expect(Object.values(reads).every((f) => f.mock.calls.length === 0)).toBe(true);
    });
});

describe('the panels', () => {
    const render = (data: Record<string, unknown>) => container.renderToString(PlayerPlayTypes, { props: { data, season: 2026, name: 'Michael Porter Jr.', q: '?season=2026' }, locals: { league: 'nba' } as any });
    test("his: offense table, hustle line, defended play types, matchups by position and his most-guarded players", async () => {
        const html = await render(MPJ);
        expect(html).toContain('With BKN &middot; 50 GP');
        const off = html.match(/<table[^>]*id="play-types-table"[\s\S]*?<\/table>/)![0];
        expect(off.match(/<tr data-play-type=/g)).toHaveLength(11);
        expect(off).toMatch(/<th scope="row"[^>]*>Spot up<\/th>\s*<td[^>]*>21\.3%<\/td>\s*<td[^>]*>238<\/td>\s*<td[^>]*>0\.95<\/td>\s*<td[^>]*>32nd<\/td>/);
        expect(html).toContain('<span class="fw-bold">1.9</span> deflections');
        expect(html).toContain('<span class="fw-bold">3.1</span> contested shots (1.3 threes)');
        const def = html.match(/<table[^>]*id="play-types-defense-table"[\s\S]*?<\/table>/)![0];
        expect(def.match(/<tr data-play-type=/g)).toHaveLength(7);
        expect(def).toContain('PPP allowed');
        const pos = html.match(/<table[^>]*id="matchups-position-table"[\s\S]*?<\/table>/)![0];
        expect(pos.match(/data-position="(\w+)"/g)).toEqual(['data-position="G"', 'data-position="F"', 'data-position="C"', 'data-position="TOTAL"']);
        expect(pos).toContain('44.4%');
        const top = html.match(/<table[^>]*id="matchups-top-table"[\s\S]*?<\/table>/)![0];
        expect(top).toContain('<a href="/nba/players/203952?season=2026">Andrew Wiggins</a>');
        expect(top.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr>/g)).toHaveLength(8);
        expect(html).not.toMatch(/undefined|NaN|null|n\/a/);
    });
    test('a traded player names the team shown and the one left out', async () => {
        expect(await render(ZU)).toContain('With LAC &middot; 40 GP &middot; his IND games are not included');
    });
    test('failed reads say so, each on its own; no rows say so', async () => {
        const down = await render({ ...MPJ, synergy: null, matchups: null });
        expect(down).toContain('id="play-types-unavailable"');
        expect(down).toContain('id="matchups-unavailable"');
        expect(down).toContain('id="hustle-line"');
        expect(down).not.toContain('play-types-defense-table');
        // one matchup read down: its line says so, and the other read's table still shows
        expect(down).toContain('The players he guarded most are temporarily unavailable.');
        expect(down).toContain('id="matchups-position-table"');
        expect(down).toContain('3,237.6'); // partial possessions keep their decimal
        expect(down).not.toContain('id="matchups-top-table"');
        const rollupDown = await render({ ...MPJ, rollup: null });
        expect(rollupDown).toContain('Matchups by position are temporarily unavailable.');
        expect(rollupDown).toContain('id="matchups-top-table"');
        const none = await render({ synergy: [], hustle: [], rollup: [], matchups: [] });
        expect(none).toContain('id="play-types-empty"');
        expect(none).toContain('id="defense-empty"');
        // a failed Synergy read is not "no defense numbers"
        expect(await render({ synergy: null, hustle: [], rollup: [], matchups: [] })).not.toContain('defense-empty');
        const before = await render({ synergy: MPJ.synergy, hustle: MPJ.hustle }); // 2016-17: no matchup tables
        expect(before).not.toContain('matchups');
        expect(before).not.toContain('defense-empty');
    });
});

describe('the page', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    async function page(on: boolean) {
        const { default: Page } = await import('../src/pages/nba/players/[id].astro');
        return normalize(await container.renderToString(Page, { params: { id: String(PID) }, request: new Request(`https://gameonpaper.com/nba/players/${PID}?season=2026`), locals: locals(on) as unknown as App.Locals }));
    }
    test("off: byte for byte the NBA byte-identity capture (main's page), no read", async () => {
        // a Windows checkout may write the capture with CRLF; the render is LF
        const snap = readFileSync(new URL('./nba/__byte_identity__/player.html', import.meta.url)).toString().replace(/\r\n/g, '\n');
        expect(await page(false)).toBe(snap);
        expect(Object.values(reads).every((f) => f.mock.calls.length === 0)).toBe(true);
    });
    test('on: both panels and their links in "On this page", and nothing else changes', async () => {
        const [off, on] = [await page(false), await page(true)];
        const links = '<a href="#play-types" class="ms-2">Play types</a><a href="#defense" class="ms-2">Defense</a>';
        expect(on).toContain(links);
        const panels = on.match(/<section id="play-types"[\s\S]*?<\/section>\s*<section id="defense"[\s\S]*?<\/section>/)![0];
        expect(panels).toContain('id="play-types-table"');
        expect(panels).toContain('id="matchups-top-table"');
        expect(on.indexOf(panels)).toBeLessThan(on.indexOf('id="ranks"'));
        expect(on.replace(panels, '').replace(links, '')).toBe(off.replace(/(<\/nav>)(\s*)/, '$1$2'));
    });
});
