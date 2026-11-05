// BB-G17: play-style archetype chips behind 'bball-play-styles'. The pure step (each chip is the producer's archetype,
// runner-up and margin; a side the season predates is no chip; college takes its most-minutes team row), the reads (NBA
// players and teams in nba_stats, college players in mbb / wbb, no WNBA read, no team read outside the NBA), the page-side
// steps (the flag gates the read; a failed read keeps the page and is never cached), the chips and both pages: flag off is
// byte for byte the NBA byte-identity captures. On sdv-db's committed producer output (fixtures/README.md:
// play-styles.json.gz). Every read is mocked.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows, seasonPlayerRows } from './nba/rows';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = Record<string, any>;
const PS = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/play-styles.json.gz', import.meta.url))).toString()) as Record<'nbaPlayers' | 'nbaTeams' | 'mbbPlayers', Row[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const styles = vi.hoisted(() => ({ player: vi.fn(), team: vi.fn() }));
vi.mock('../src/resources/playStyles', async (orig) => ({
    ...(await orig<typeof import('../src/resources/playStyles')>()),
    retrievePlayerPlayStyle: (...a: unknown[]) => styles.player(...a),
    retrieveTeamPlayStyle: (...a: unknown[]) => styles.team(...a),
}));
const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
// the pages' other flagged reads, as byteIdentity.render.test.ts mocks them
vi.mock('../src/resources/shotQuality', () => ({ retrieveGameShotQuality: async () => [], retrieveTeamShotQuality: async () => [], retrievePlayerShotQuality: async () => [] }));
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: async () => [] }));
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: async () => ({ rates: [], strength: null, games: [], gameRates: [] }),
}));
const oracle = fx('nba/league_context');
const shots = fx('nba/shots') as any[];
const byPlayer = fx('nba/player_games') as Record<string, any[]>;
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
const state: { players: () => any[] } = { players: seasonPlayerRows };
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => state.players(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
    retrievePlayerGameRows: async (_s: number, id: number) => (byPlayer[String(id)] ?? []).map((g) => ({
        season: 2026, person_id: id, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
}));

import PlayStyleChips from '../src/components/nba/PlayStyleChips.astro';
import { NBA_READ_TIMEOUT_MS } from '../src/resources/nbaGames';
import { PLAYER_PLAY_STYLE_LEAGUES } from '../src/resources/playStyles';
import { prepareBasketballPlayer } from '../src/routes/basketball/player';
import { prepareBasketballTeam } from '../src/routes/basketball/team';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { leagueSource } from '../src/utils/league';
import { playerPlayStyles, teamPlayStyles } from '../src/utils/playStyles';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, Michael Porter Jr., a Net in seasonPlayerRows()
const NETS = 1610612751;
const OFF = { 'bball-playoff-picture': false, 'bball-team-season': false, 'bball-poe': false, 'bball-impact': false, 'bball-play-styles': false };
const locals = (on: boolean) => ({ preview: true, flagOverrides: { ...OFF, 'bball-play-styles': on } });
// the fixtures are 2024-25 (NBA) and 2025-26 (MBB); the page fixtures are 2025-26, so the page tests show his 2024-25 row
const PORTER = PS.nbaPlayers.find((r) => r.player_id === PID)!;
const BKN = PS.nbaTeams.find((r) => r.team_id === NETS)!;

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // as byteIdentity.render.test.ts: the season picker reads the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    for (const f of [styles.player, styles.team, sdv.rows, sdv.from]) f.mockReset();
    styles.player.mockResolvedValue([PORTER]);
    styles.team.mockResolvedValue([BKN]);
    state.players = seasonPlayerRows;
});

function fakeAstro(on: boolean, path: string, id: number) {
    const cache: unknown[] = [];
    return { astro: { params: { id: String(id) }, url: new URL(`https://gameonpaper.com${path}/${id}?season=2026`), locals: locals(on), cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }

describe('the fixtures (sdv-db #200, the producer output)', () => {
    test('every row has an archetype and a runner-up that differs from it, with a non-negative margin', () => {
        for (const [rows, sides] of [[PS.nbaPlayers, ['off_', 'def_']], [PS.nbaTeams, ['def_']], [PS.mbbPlayers, ['']]] as const) {
            for (const r of rows) for (const p of sides) {
                expect(typeof r[`${p}archetype`]).toBe('string');
                expect(r[`${p}second_archetype`]).not.toBe(r[`${p}archetype`]);
                expect(r[`${p}margin`]).toBeGreaterThanOrEqual(0);
            }
        }
        expect([PS.nbaPlayers.length, PS.nbaTeams.length, PS.mbbPlayers.length]).toEqual([318, 30, 42]);
    });
    test('the team table carries defense only: no team offense archetype', () => {
        for (const r of PS.nbaTeams) expect(Object.keys(r).filter((k) => k.startsWith('off_'))).toEqual([]);
        expect(new Set(PS.nbaTeams.map((r) => r.def_archetype))).toEqual(new Set(['forces turnovers', 'allows paint points', 'allows transition', 'allows threes']));
    });
});

describe('the chips', () => {
    test("NBA players: offense then defense, each the producer's archetype, runner-up and margin, for all 318 rows", () => {
        for (const r of PS.nbaPlayers) {
            expect(playerPlayStyles([r], false)).toEqual([
                { side: 'off', archetype: r.off_archetype, second: r.off_second_archetype, margin: r.off_margin },
                { side: 'def', archetype: r.def_archetype, second: r.def_second_archetype, margin: r.def_margin },
            ]);
        }
    });
    test('a side the season predates is no chip (NBA defense starts in 2017-18)', () => {
        const r = { ...PORTER, def_archetype: null, def_second_archetype: null, def_margin: null };
        expect(playerPlayStyles([r], false).map((c) => c.side)).toEqual(['off']);
    });
    test('NBA teams: one defensive chip per team, for all 30', () => {
        for (const r of PS.nbaTeams) expect(teamPlayStyles([r])).toEqual([{ side: 'def', archetype: r.def_archetype, second: r.def_second_archetype, margin: r.def_margin }]);
    });
    test("college: one style chip from the team row with the most minutes", () => {
        for (const r of PS.mbbPlayers) expect(playerPlayStyles([r], true)).toEqual([{ side: 'style', archetype: r.archetype, second: r.second_archetype, margin: r.margin }]);
        const [a, b] = [...PS.mbbPlayers].sort((x, y) => x.min - y.min).slice(-2); // b has more minutes than a
        expect(playerPlayStyles([a, { ...b, player_id: a.player_id }], true)[0].archetype).toBe(b.archetype);
    });
    test('no row (the table empty before the backfill, a player below the minutes gate) is no chip', () => {
        expect(playerPlayStyles([], false)).toEqual([]);
        expect(playerPlayStyles([], true)).toEqual([]);
        expect(teamPlayStyles([])).toEqual([]);
    });
});

describe('the reads', () => {
    test('NBA players and teams from nba_stats, college from mbb / wbb; strict, bounded, filtered by season and id, a small limit', async () => {
        const { retrievePlayerPlayStyle, retrieveTeamPlayStyle } = await vi.importActual<typeof import('../src/resources/playStyles')>('../src/resources/playStyles');
        sdv.from.mockResolvedValue([PORTER]);
        expect(await retrievePlayerPlayStyle('nba', 2025, PID)).toEqual([PORTER]);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'player_play_styles', {
            season: '2025', player_id: String(PID), limit: '5',
            select: 'off_archetype,off_second_archetype,off_margin,def_archetype,def_second_archetype,def_margin',
        }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(leagueSource('nba').schema).toBe('nba_stats');
        await retrievePlayerPlayStyle('mbb', 2026, 4706918);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('mbb'), 'player_play_styles', { season: '2026', player_id: '4706918', limit: '5', select: 'min,archetype,second_archetype,margin' }, 21600, true, NBA_READ_TIMEOUT_MS);
        await retrievePlayerPlayStyle('wbb', 2026, 1);
        expect(sdv.from.mock.lastCall![0].schema).toBe('wbb');
        await retrieveTeamPlayStyle(2025, NETS);
        expect(sdv.from).toHaveBeenLastCalledWith(leagueSource('nba'), 'team_play_styles', { season: '2025', team_id: String(NETS), limit: '5', select: 'def_archetype,def_second_archetype,def_margin' }, 21600, true, NBA_READ_TIMEOUT_MS);
        expect(PLAYER_PLAY_STYLE_LEAGUES).toEqual(['nba', 'mbb', 'wbb']);
    });
});

describe('the player page step', () => {
    test("the flag is 'preview'", () => { expect(FLAGS['bball-play-styles']).toBe('preview'); });
    test('off: no read and no playStyles key', async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(false, '/nba/players', PID).astro, 'nba'));
        expect(styles.player).not.toHaveBeenCalled();
        expect('playStyles' in r).toBe(false);
    });
    test('on: one read keyed by his person id, the chips on the page; a failed read is null and never cached', async () => {
        const a = fakeAstro(true, '/nba/players', PID);
        const r = ok(await prepareBasketballPlayer(a.astro, 'nba'));
        expect(styles.player).toHaveBeenCalledWith('nba', 2026, PID);
        expect(r.playStyles).toEqual(playerPlayStyles([PORTER], false));
        expect(a.cache.at(-1)).not.toBe(false);
        styles.player.mockResolvedValueOnce([]);
        expect(ok(await prepareBasketballPlayer(fakeAstro(true, '/nba/players', PID).astro, 'nba')).playStyles).toEqual([]);
        styles.player.mockRejectedValueOnce(new Error('down'));
        const b = fakeAstro(true, '/nba/players', PID);
        expect(ok(await prepareBasketballPlayer(b.astro, 'nba')).playStyles).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
    test('WNBA: no table, so no read and no key, flag on', async () => {
        const r = ok(await prepareBasketballPlayer(fakeAstro(true, '/wnba/players', PID).astro, 'wnba'));
        expect(styles.player).not.toHaveBeenCalled();
        expect('playStyles' in r).toBe(false);
    });
});

describe('the team page step', () => {
    test('off: no read and no playStyles key', async () => {
        state.players = apiSeasonPlayerRows;
        const r = ok(await prepareNbaTeam(fakeAstro(false, '/nba/team', NETS).astro));
        expect(styles.team).not.toHaveBeenCalled();
        expect('playStyles' in r).toBe(false);
    });
    test('on (NBA): one read keyed by the team id, the defensive chip; a failed read is null and never cached', async () => {
        state.players = apiSeasonPlayerRows;
        const a = fakeAstro(true, '/nba/team', NETS);
        const r = ok(await prepareNbaTeam(a.astro));
        expect(styles.team).toHaveBeenCalledWith(2026, NETS);
        expect(r.playStyles).toEqual(teamPlayStyles([BKN]));
        expect(a.cache.at(-1)).not.toBe(false);
        styles.team.mockRejectedValueOnce(new Error('down'));
        const b = fakeAstro(true, '/nba/team', NETS);
        expect(ok(await prepareNbaTeam(b.astro)).playStyles).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
    test('WNBA: no team table, so no read and no key, flag on', async () => {
        state.players = apiSeasonPlayerRows;
        const r = ok(await prepareBasketballTeam(fakeAstro(true, '/wnba/team', NETS).astro, 'wnba'));
        expect(styles.team).not.toHaveBeenCalled();
        expect('playStyles' in r).toBe(false);
    });
});

describe('the chips component', () => {
    const render = (props: Record<string, unknown>) => container.renderToString(PlayStyleChips, { props, locals: { league: 'nba' } as any });
    test('a player: Offense and Defense chips, the runner-up and margin on hover only', async () => {
        const html = await render({ chips: playerPlayStyles([PORTER], false) });
        expect(html).toContain('Offense: <span class="fw-bold">spot-up shooter</span>');
        expect(html).toContain('Defense: <span class="fw-bold">wing defender / screen chaser</span>');
        expect(html).toContain(`runner-up off-ball shooter, margin ${PORTER.off_margin.toFixed(2)}`);
        expect(html).not.toContain('id="play-styles-note"');
        expect(html).not.toContain('&middot;');
        expect(html).not.toMatch(/undefined|NaN|null/);
    });
    test('a team (detail): the defensive chip with its runner-up and margin inline, and the note on reading them', async () => {
        const html = await render({ chips: teamPlayStyles([BKN]), detail: true });
        expect(html).toContain('Defense: <span class="fw-bold">forces turnovers</span>');
        expect(html).toContain(`&middot; runner-up allows transition, margin ${BKN.def_margin.toFixed(2)}`);
        expect(html).toContain('id="play-styles-note"');
        expect(html).not.toContain('Offense');
    });
    test('college: one Style chip', async () => {
        const html = await render({ chips: playerPlayStyles([PS.mbbPlayers[0]], true) });
        expect(html).toContain(`Style: <span class="fw-bold">${PS.mbbPlayers[0].archetype}</span>`);
        expect(html.match(/data-side=/g)).toHaveLength(1);
    });
    test('a failed read says so; no chip renders nothing', async () => {
        expect(await render({ chips: null })).toContain('id="play-styles-unavailable"');
        expect((await render({ chips: [] })).trim()).toBe('');
    });
});

describe('the pages', () => {
    const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
    const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
    const snap = (name: string) => readFileSync(new URL(`./nba/__byte_identity__/${name}.html`, import.meta.url)).toString().replace(/\r\n/g, '\n');
    async function page(kind: 'player' | 'team', on: boolean) {
        const [file, path, id] = kind === 'player' ? ['players/[id].astro', '/nba/players', PID] : ['team/[id].astro', '/nba/team', NETS];
        state.players = kind === 'player' ? seasonPlayerRows : apiSeasonPlayerRows;
        const { default: Page } = await import(/* @vite-ignore */ `../src/pages/nba/${file}`);
        return normalize(await container.renderToString(Page, { params: { id: String(id) }, request: new Request(`https://gameonpaper.com${path}/${id}?season=2026`), locals: locals(on) as unknown as App.Locals }));
    }
    const chipsBlock = (html: string) => html.match(/<div class="small mb-2" id="play-styles">[\s\S]*?<\/div>\s*(?:<p[^>]*id="play-styles-note"[\s\S]*?<\/p>\s*)?<\/div>/)![0];
    for (const kind of ['player', 'team'] as const) {
        test(`${kind}, off: byte for byte the NBA byte-identity capture (main's page), no read`, async () => {
            expect(await page(kind, false)).toBe(snap(kind));
            expect(styles.player).not.toHaveBeenCalled();
            expect(styles.team).not.toHaveBeenCalled();
        });
        test(`${kind}, on: the chips in the header, and nothing else changes`, async () => {
            const [off, on] = [await page(kind, false), await page(kind, true)];
            const block = chipsBlock(on);
            expect(block).toContain(kind === 'player' ? 'Offense: <span class="fw-bold">spot-up shooter</span>' : 'Defense: <span class="fw-bold">forces turnovers</span>');
            expect(on.indexOf(block)).toBeLessThan(on.indexOf('id="nba-season"'));
            expect(on.replace(block, '')).toBe(off);
        });
    }
    test('team, on with no row (before the backfill): the page is the off page', async () => {
        styles.team.mockResolvedValue([]);
        expect(await page('team', true)).toBe(await page('team', false));
    });
});
