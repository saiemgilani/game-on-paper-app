// BB-G15: points over expected behind 'bball-poe'. The pure steps (a game's two team rows, a team-season's shooters), the
// page-side steps (the flag gates each read; the NBA/WNBA game read is the game's day in the scoreboard zone, college's the
// ESPN game id; a failed read keeps the page and is never cached) and the three templates, on real Data API reads
// (fixtures/README.md: shot-quality.json.gz, the reads resources/shotQuality.ts makes). Every read is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead (as rollingMovers.render.test.ts).
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const SQ = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/shot-quality.json.gz', import.meta.url))).toString()) as Record<'nbaTeam' | 'mbbTeam' | 'nbaPlayer' | 'wnbaGameDay' | 'mbbGame', any[]>;
const fx = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString());

const sq = vi.hoisted(() => ({ game: vi.fn(), team: vi.fn(), player: vi.fn() }));
vi.mock('../src/resources/shotQuality', () => ({
    retrieveGameShotQuality: (...a: unknown[]) => sq.game(...a),
    retrieveTeamShotQuality: (...a: unknown[]) => sq.team(...a),
    retrievePlayerShotQuality: (...a: unknown[]) => sq.player(...a),
}));
// BB-G6's Impact panel reads the Data API with 'bball-impact' on (preview): never from a test
vi.mock('../src/resources/playerImpact', () => ({ retrievePlayerImpact: async () => [] }));
// BB-G27's Value panel reads the Data API with 'bball-war' on (preview): never from a test
vi.mock('../src/resources/playerWar', async (orig) => ({ ...(await orig<typeof import('../src/resources/playerWar')>()), retrievePlayerWar: async () => [], retrievePlayerEpv: async () => [] }));
// the pages' other reads, as teamSeason.test.ts and byteIdentity.render.test.ts mock them
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: async () => ({ rates: [], strength: null, games: [], gameRates: [] }),
}));
const oracle = fx('nba/league_context');
const shots = fx('nba/shots') as any[];
const byPlayer = fx('nba/player_games') as Record<string, any[]>;
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrievePlayerGameRows: async (_s: number, id: number) => (byPlayer[String(id)] ?? []).map((g) => ({
        season: 2026, person_id: id, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
}));
const games = vi.hoisted(() => ({ sched: vi.fn(), rows: vi.fn() }));
vi.mock('../src/resources/nbaGames', () => ({ retrieveNbaSchedule: (...a: unknown[]) => games.sched(...a), retrieveNbaGameRows: (...a: unknown[]) => games.rows(...a), retrieveNbaProcessedGame: async () => { throw new Error('no processor in these tests'); } }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: async () => { throw new Error('no ESPN in these tests'); } }));
vi.mock('../src/utils/telemetry', async (orig) => ({ ...(await orig<typeof import('../src/utils/telemetry')>()), gopStorage: { getStore: () => undefined } }));

import NbaShotQuality from '../src/components/nba/game/NbaShotQuality.astro';
import PlayerShotQuality from '../src/components/nba/PlayerShotQuality.astro';
import TeamShotQuality from '../src/components/nba/TeamShotQuality.astro';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { FLAGS } from '../src/utils/features';
import { gameTeams, signed1, teamShooters } from '../src/utils/shotQuality';

const PID = Number(Object.keys(byPlayer)[0]); // 1629008, a Net in apiSeasonPlayerRows()
const WNBA_ID = '401736289'; // LA at SEA, 2025-08-02T02:00Z: a 7 pm PT tip, Aug 1 on the scoreboard (ET) and in stats.wnba.com
const MBB_ID = '401808271'; // Alabama at Tennessee, 2026-02-28
const ON = { preview: true, flagOverrides: { 'bball-team-season': false } };

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => {
    for (const f of [sq.game, sq.team, sq.player, games.sched, games.rows]) f.mockReset();
    sq.team.mockResolvedValue(SQ.nbaTeam);
    sq.player.mockResolvedValue(SQ.nbaPlayer);
});

function fakeAstro(path: string, id: string, locals: Record<string, unknown>) {
    const cache: unknown[] = [];
    const headers = new Headers();
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}/${id}?season=2026`), locals, cache: { set: (v: unknown) => cache.push(v) }, response: { headers } } as any, cache, headers };
}
function ok<T extends object>(r: T | { notFound: true } | { unavailable: true }): T { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as T; }
async function game(league: 'wnba' | 'mbb', id: string, locals: Record<string, unknown> = ON) {
    const api = fx(`${league}/game_${id}_api`);
    games.sched.mockResolvedValueOnce(api.schedule[0]);
    games.rows.mockResolvedValueOnce(api);
    const f = fakeAstro(`/${league}/game`, id, locals);
    return { ...f, r: ok(await prepareBasketballGame(f.astro, league)) as any, api };
}

describe('the captures', () => {
    test("each league's team rows sum their shooters' points (the producer's team row is its players plus unattributed shots)", () => {
        for (const rows of [SQ.nbaTeam, SQ.mbbTeam]) {
            const { team, players } = teamShooters(rows);
            expect(team).not.toBeNull();
            expect(players.length).toBeGreaterThan(5);
            expect(players.reduce((s, p) => s + p.pts, 0)).toBeLessThanOrEqual(team!.pts);
            expect(team!.xpts! / team!.pts).toBeGreaterThan(0.9);
            expect(team!.xpts! / team!.pts).toBeLessThan(1.1);
        }
    });
});

describe('gameTeams / teamShooters', () => {
    test("the WNBA day: the read holds every game of Aug 1, the pick is this game's two teams (stats ids from ESPN's)", () => {
        const api = fx(`wnba/game_${WNBA_ID}_api`);
        const s = api.schedule[0];
        const pair = gameTeams(SQ.wnbaGameDay, 'wnba', Number(s.home_id), Number(s.away_id))!;
        expect(SQ.wnbaGameDay.length).toBeGreaterThan(2);
        // ESPN's SEA (14) and LA (6) are stats.wnba.com's SEA and LAS: five games that day, this one picked
        expect([pair.home.team_tricode, pair.away.team_tricode]).toEqual(['SEA', 'LAS']);
        expect(new Set(SQ.wnbaGameDay.map((r) => r.game_id)).size).toBe(5);
        expect(pair.home.game_id).toBe(pair.away.game_id);
        expect(pair.home.pts + pair.away.pts).toBeLessThanOrEqual(Number(s.home_score) + Number(s.away_score));
    });
    test('college: the game read is the ESPN id, the teams ESPN ids', () => {
        const s = fx(`mbb/game_${MBB_ID}_api`).schedule[0];
        const pair = gameTeams(SQ.mbbGame, 'mbb', Number(s.home_id), Number(s.away_id))!;
        expect(pair.home.team_id).toBe(Number(s.home_id));
        expect(pair.away.team_id).toBe(Number(s.away_id));
    });
    test('a team the day does not name, or no rows, is no pair', () => {
        const s = fx(`wnba/game_${WNBA_ID}_api`).schedule[0];
        expect(gameTeams(SQ.wnbaGameDay, 'wnba', Number(s.home_id), 999999)).toBeNull();
        expect(gameTeams([], 'mbb', 1, 2)).toBeNull();
    });
    test('signed1: one decimal, a true minus, a rounded zero is +0.0, none is a dash', () => {
        expect(signed1(SQ.nbaTeam.find((r) => r.level === 'team')!.poe)).toBe('−465.8'); // the Nets 2025-26
        expect(signed1(-0.04)).toBe('+0.0');
        expect(signed1(28.47)).toBe('+28.5');
        expect(signed1(null)).toBe('—');
    });
    test('shooters run by points over expected, the team row apart', () => {
        const { team, players } = teamShooters(SQ.nbaTeam);
        expect(team!.level).toBe('team');
        expect(players.every((p) => p.level === 'player')).toBe(true);
        const poe = players.map((p) => p.poe as number);
        expect(poe).toEqual([...poe].sort((a, b) => b - a));
    });
});

describe('the flag', () => {
    test("'bball-poe' is a preview flag", () => { expect(FLAGS['bball-poe']).toBe('preview'); });
    test('off: no read on any of the three pages and no poe key, so each is byte for byte today\'s', async () => {
        const g = await game('wnba', WNBA_ID, {});
        const t = ok(await prepareNbaTeam(fakeAstro('/nba/team', String(NETS_TEAM_ID), {}).astro));
        const p = ok(await prepareNbaPlayer(fakeAstro('/nba/players', String(PID), {}).astro));
        for (const r of [g.r, t, p]) expect('poe' in r).toBe(false);
        for (const f of [sq.game, sq.team, sq.player]) expect(f).not.toHaveBeenCalled();
    });
});

describe('the game page', () => {
    test("NBA/WNBA: the read is the scoreboard's day, not UTC's (Aug 1, not Aug 2), and the pair is this game's", async () => {
        sq.game.mockResolvedValueOnce(SQ.wnbaGameDay);
        const { r, cache } = await game('wnba', WNBA_ID);
        expect(sq.game).toHaveBeenCalledWith('wnba', 2025, { date: '2025-08-01' });
        expect(r.poe).toEqual(gameTeams(SQ.wnbaGameDay, 'wnba', Number(r.game.home.team.id), Number(r.game.away.team.id)));
        expect(cache[0]).not.toBe(false);
    });
    test('college: the read is the ESPN game id', async () => {
        sq.game.mockResolvedValueOnce(SQ.mbbGame);
        const { r } = await game('mbb', MBB_ID);
        expect(sq.game).toHaveBeenCalledWith('mbb', 2026, { gameId: MBB_ID });
        expect(r.poe.home.team_id).toBe(Number(r.game.home.team.id));
    });
    test('no pair (a playoff game, the warm-up season) is {} and the page caches as before; a failed read is null, never cached', async () => {
        sq.game.mockResolvedValueOnce([]);
        const a = await game('wnba', WNBA_ID);
        expect(a.r.poe).toEqual({});
        expect(a.cache[0]).not.toBe(false);
        sq.game.mockRejectedValueOnce(new Error('down'));
        const b = await game('wnba', WNBA_ID);
        expect(b.r.poe).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
        expect(b.headers.get('Cache-Control')).toBe('no-store');
    });
    test('the table: both teams, the producer numbers, the model note; nothing for {}, a line for a failed read', async () => {
        sq.game.mockResolvedValueOnce(SQ.wnbaGameDay);
        const { r } = await game('wnba', WNBA_ID);
        const html = await container.renderToString(NbaShotQuality, { props: { game: r.game, poe: r.poe }, locals: { league: 'wnba' } as App.Locals });
        expect(html).toContain('id="poe"');
        for (const side of [r.poe.home, r.poe.away]) {
            expect(html).toContain(side.xpts.toFixed(1));
            expect(html).toContain(`± ${side.poe_se.toFixed(1)}`);
        }
        expect(html).toContain('shot type and the defender are not in the model');
        expect(html).not.toMatch(/undefined|NaN/);
        expect((await container.renderToString(NbaShotQuality, { props: { game: r.game, poe: {} }, locals: { league: 'wnba' } as App.Locals })).trim()).toBe('');
        expect(await container.renderToString(NbaShotQuality, { props: { game: r.game, poe: null }, locals: { league: 'wnba' } as App.Locals })).toContain('id="poe-unavailable"');
    });
});

describe('the team page', () => {
    test("on: one read keyed by the season tables' team id, the rows on the page, cached as before", async () => {
        const { astro, cache } = fakeAstro('/nba/team', String(NETS_TEAM_ID), ON);
        const r = ok(await prepareNbaTeam(astro));
        expect(sq.team).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID);
        expect(r.poe).toEqual(SQ.nbaTeam);
        expect(cache[0]).not.toBe(false);
    });
    test('on, a 404 spends no read; a failed read renders the page with poe null, never cached', async () => {
        expect(await prepareNbaTeam(fakeAstro('/nba/team', '1', ON).astro)).toEqual({ notFound: true });
        expect(sq.team).not.toHaveBeenCalled();
        sq.team.mockRejectedValueOnce(new Error('down'));
        const { astro, cache } = fakeAstro('/nba/team', String(NETS_TEAM_ID), ON);
        const r = ok(await prepareNbaTeam(astro));
        expect(r.poe).toBeNull();
        expect(r.dashboard).not.toBeNull();
        expect(cache.at(-1)).toBe(false);
    });
    test('the section: the team line, every shooter by POE with a player link, the model note', async () => {
        const { team, players } = teamShooters(SQ.nbaTeam);
        const names = new Map(players.map((p) => [p.person_id!, `P${p.person_id}`]));
        const html = await container.renderToString(TeamShotQuality, { props: { rows: SQ.nbaTeam, season: 2026, seasonQuery: '?season=2026', names }, locals: { league: 'nba' } as App.Locals });
        expect(html).toContain('id="poe-line"');
        expect(html).toContain('7,680.8 expected'); // the Nets 2025-26: 7,215 FG points
        const body = html.split('id="poe-players"')[1].split('</table>')[0];
        expect(body.match(/<tr/g)).toHaveLength(players.length + 1);
        expect(body.indexOf(`P${players[0].person_id}`)).toBeLessThan(body.indexOf(`P${players.at(-1)!.person_id}`));
        expect(body).toContain(`/nba/players/${players[0].person_id}?season=2026`);
        expect(html).toContain('Field goals only, no free throws');
        expect(html).not.toMatch(/undefined|NaN/);
    });
    test('the warm-up season (no rows) is no section; a failed read says so', async () => {
        const props = { season: 2026, seasonQuery: '', names: new Map() };
        expect((await container.renderToString(TeamShotQuality, { props: { ...props, rows: [] }, locals: { league: 'mbb' } as App.Locals })).trim()).toBe('');
        expect(await container.renderToString(TeamShotQuality, { props: { ...props, rows: null }, locals: { league: 'mbb' } as App.Locals })).toContain('id="poe-unavailable"');
    });
    test('college: Duke renders the same section', async () => {
        const html = await container.renderToString(TeamShotQuality, { props: { rows: SQ.mbbTeam, season: 2026, seasonQuery: '', names: new Map() }, locals: { league: 'mbb' } as App.Locals });
        expect(html).toContain('id="poe-players"');
        expect(html).not.toMatch(/undefined|NaN/);
    });
});

describe('the player page', () => {
    test('on: one read keyed by his person id, the rows on the page; a failed read is null and never cached', async () => {
        const { astro } = fakeAstro('/nba/players', String(PID), ON);
        const r = ok(await prepareNbaPlayer(astro));
        expect(sq.player).toHaveBeenCalledWith('nba', 2026, PID);
        expect(r.poe).toEqual(SQ.nbaPlayer);
        sq.player.mockRejectedValueOnce(new Error('down'));
        const b = fakeAstro('/nba/players', String(PID), ON);
        expect(ok(await prepareNbaPlayer(b.astro)).poe).toBeNull();
        expect(b.cache.at(-1)).toBe(false);
    });
    test('the line: his points over expected ± its error, shot quality and shot making', async () => {
        const [row] = SQ.nbaPlayer;
        const html = await container.renderToString(PlayerShotQuality, { props: { rows: SQ.nbaPlayer } });
        expect(html).toContain('id="nba-poe"');
        expect(html).toContain(`± ${row.poe_se.toFixed(1)}`);
        expect(html).toContain(row.xpps.toFixed(2));
        expect(html).not.toMatch(/undefined|NaN/);
        expect((await container.renderToString(PlayerShotQuality, { props: { rows: [] } })).trim()).toBe('');
        expect(await container.renderToString(PlayerShotQuality, { props: { rows: null } })).toContain('id="nba-poe-unavailable"');
    });
    test('traded: one line per team, each named', async () => {
        const two = [SQ.nbaPlayer[0], { ...SQ.nbaPlayer[0], team_id: 1, team_tricode: 'XXX', attempts: 1 }];
        const html = await container.renderToString(PlayerShotQuality, { props: { rows: two } });
        expect(html).toContain(`${SQ.nbaPlayer[0].team_tricode}: `);
        expect(html).toContain('XXX: ');
        expect(html).not.toContain('id="nba-poe"');
    });
});
