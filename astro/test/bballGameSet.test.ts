// BB-G14: the game-set filter (?games=) on the basketball team and player pages, behind 'bball-game-set'. The sets, the
// summing (never a mean of per-game rates), "All games" equal to the season numbers, the flag gating the reads and the
// markup, on real Data API reads (fixtures/README.md: game-set-*.json.gz). Every read is mocked and fetch throws.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

// no test here may reach the network: an unmocked read would send a failed-auth request (and a 429 lockout)
vi.stubGlobal('fetch', (input: unknown) => { throw new Error(`unmocked fetch: ${String(input)}`); });
afterAll(() => { vi.unstubAllGlobals(); });

const capture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const asReads = (c: any) => ({ rates: c.rates, strength: c.strength[0] ?? null, games: [...c.home, ...c.away], gameRates: c.gameRates });
const NBA = capture('game-set-nba-2026'); // Brooklyn Nets 2025-26 (stats 1610612751, ESPN 17)
const MBB = capture('game-set-mbb-2026'); // Duke 2025-26 (ESPN 150)
const MPJ = capture('game-set-player-nba-2026'); // Michael Porter Jr. 2025-26: shot_player_games + his shot_season_players row
const PID = 1629008;

const block = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: (...a: unknown[]) => block.fn(...a),
}));
const oracle = JSON.parse(readFileSync(new URL('./fixtures/nba/league_context.json', import.meta.url)).toString());
const shots = JSON.parse(readFileSync(new URL('./fixtures/nba/shots.json', import.meta.url)).toString()) as any[];
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
vi.mock('../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
    retrieveLeagueContextRows: async () => [
        ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
        { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
    ],
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
    retrievePlayerShots: async () => [],
    retrievePlayerGameRows: async () => MPJ.games,
    retrievePlayerSeasons: async () => [2025, 2026],
}));

import TeamSeasonBlock from '../src/components/nba/TeamSeasonBlock.astro';
import PlayerGameSet from '../src/components/nba/PlayerGameSet.astro';
import TeamPage from '../src/pages/nba/team/[id].astro';
import PlayerPage from '../src/pages/nba/players/[id].astro';
import { playerGamesFromRows } from '../src/nba/adapters';
import { NETS_TEAM_ID } from '../src/nba/data/teams';
import { prepareNbaPlayer } from '../src/routes/nba/player';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { BB_GAME_SETS, bbGameSetOf, gameSetHref, pickGames, playerGameSet, summedTeamLine, teamGameSet } from '../src/utils/bballGameSet';
import { FLAGS } from '../src/utils/features';
import { scheduleRows } from '../src/utils/teamSeason';

const NETS_ESPN = 17;
const DUKE = 150;
const nets = () => scheduleRows(asReads(NBA).games, NBA.gameRates, NETS_ESPN);
const duke = () => scheduleRows(asReads(MBB).games, MBB.gameRates, DUKE);
const split = (c: any, s: string) => c.rates.find((r: any) => r.split === s);
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { block.fn.mockReset(); block.fn.mockResolvedValue(asReads(NBA)); });

describe('the sets', () => {
    test('an unknown or missing ?games= is all', () => {
        expect(bbGameSetOf('last10')).toBe('last10');
        expect(bbGameSetOf('conf')).toBe('all');
        expect(bbGameSetOf(null)).toBe('all');
    });
    test('last N is the N latest games by date, whatever the input order', () => {
        const games = nets().filter((g) => g.completed).map((g) => ({ ...g, game_id: g.gameId, win: null }));
        const last5 = pickGames(games.toReversed(), 'last5');
        expect(last5.map((g) => g.date)).toEqual(games.map((g) => g.date).toSorted().slice(-5));
    });
    test("each link keeps the page's other params and drops games for all", () => {
        const url = new URL('https://gameonpaper.com/nba/team/1610612751?season=2026&games=wins');
        expect(gameSetHref(url, 'last10', 'x')).toBe('/nba/team/1610612751?season=2026&games=last10#x');
        expect(gameSetHref(url, 'all', 'x')).toBe('/nba/team/1610612751?season=2026#x');
    });
});

describe('team: All / Home / Away are the season numbers', () => {
    for (const [name, c, rows] of [['Nets', NBA, nets], ['Duke', MBB, duke]] as const) {
        test(`${name}: each is the producer's split row, unchanged`, () => {
            for (const s of ['all', 'home', 'away'] as const) {
                const v = teamGameSet(c.rates, rows(), s, 48)!;
                const r = split(c, s);
                expect(v.producer).toBe(true);
                expect(v.line).toEqual({ games: r.games, poss: r.poss, off_rtg: r.off_rtg, def_rtg: r.def_rtg, net_rtg: r.net_rtg, pace: r.pace, off_rtg_pct: r.off_rtg_pct, def_rtg_pct: r.def_rtg_pct, net_rtg_pct: r.net_rtg_pct });
            }
        });
    }
});

describe('team: the other sets sum per-game counts', () => {
    test('the Nets, last 10: 100 x points / possessions over the ten latest finals, never the mean of their ratings', () => {
        const v = teamGameSet(NBA.rates, nets(), 'last10', 48)!;
        const ten = nets().filter((g) => g.completed).slice(-10);
        const poss = ten.reduce((t, g) => t + g.rates!.possessions!, 0);
        const pts = ten.reduce((t, g) => t + g.teamScore!, 0);
        const opp = ten.reduce((t, g) => t + g.oppScore!, 0);
        const min = ten.reduce((t, g) => t + g.rates!.game_minutes!, 0);
        expect(v.producer).toBe(false);
        expect(v.line.games).toBe(10);
        expect(v.line.off_rtg).toBeCloseTo((100 * pts) / poss, 10);
        expect(v.line.def_rtg).toBeCloseTo((100 * opp) / poss, 10);
        expect(v.line.net_rtg).toBeCloseTo((100 * (pts - opp)) / poss, 10);
        expect(v.line.pace).toBeCloseTo((48 * poss) / min, 10);
        // a mean of the ten per-game ratings is a different number on this real stretch
        const mean = ten.reduce((t, g) => t + g.rates!.off_rtg!, 0) / 10;
        expect(Math.abs(v.line.off_rtg! - mean)).toBeGreaterThan(0.01);
        expect(v.line.off_rtg_pct).toBeUndefined();
    });
    test('the Nets: Wins and Losses partition the rated finals, and count the producer record', () => {
        const wins = teamGameSet(NBA.rates, nets(), 'wins', 48)!.line;
        const losses = teamGameSet(NBA.rates, nets(), 'losses', 48)!.line;
        expect(wins.games).toBe(NBA.strength[0].wins); // 20
        expect(losses.games).toBe(NBA.strength[0].losses); // 62
        expect(wins.net_rtg!).toBeGreaterThan(0);
        expect(losses.net_rtg!).toBeLessThan(0);
        const all = summedTeamLine(nets().filter((g) => g.completed), 48);
        expect(wins.poss + losses.poss).toBeCloseTo(all.poss, 6);
    });
    test("the summed basis is the box score's: over every game it runs above the play-by-play possessions (the caption's claim)", () => {
        for (const [c, rows] of [[NBA, nets], [MBB, duke]] as const) {
            const finals = rows().filter((g) => g.completed);
            const summed = summedTeamLine(finals, 48);
            expect(summed.games).toBe(split(c, 'all').games);
            // points agree within 0.2% (final scores vs possession points); possessions are a different count
            const pts = finals.reduce((t, g) => t + g.teamScore!, 0);
            expect(Math.abs(pts - split(c, 'all').pts) / split(c, 'all').pts).toBeLessThan(0.002);
        }
        expect(summedTeamLine(nets().filter((g) => g.completed), 48).poss).toBeGreaterThan(split(NBA, 'all').poss);
    });
    test('a set with no game is not offered, and a link to it renders all', () => {
        const unrated = nets().map((g) => ({ ...g, rates: null }));
        const v = teamGameSet(NBA.rates, unrated, 'last5', 48)!;
        expect(v.sets).toEqual(['all', 'home', 'away']);
        expect(v.set).toBe('all');
        expect(teamGameSet([], nets(), 'all', 48)).toBeNull();
    });
});

describe('player: every set sums his per-game shot counts', () => {
    const games = () => playerGamesFromRows(MPJ.games)!;
    test("All games equals his season row (shot_player_games summed vs shot_season_players)", () => {
        const v = playerGameSet(games(), 'all')!;
        const s = MPJ.season[0];
        expect(v.games).toBe(MPJ.games.length);
        expect(v.line).toMatchObject({ attempts: s.attempts, makes: s.makes, fg3a: s.fg3a, fg3m: s.fg3m });
        expect(v.line.fgPct).toBe(s.makes / s.attempts);
    });
    test('last 5: his five latest games, makes over attempts once', () => {
        const v = playerGameSet(games(), 'last5')!;
        const five = games().slice(-5);
        const a = five.reduce((t, g) => t + g.attempts, 0), m = five.reduce((t, g) => t + g.makes, 0);
        expect(v.games).toBe(5);
        expect(v.line.fgPct).toBe(m / a);
        expect(v.line.fgPct).not.toBe(five.reduce((t, g) => t + g.fgPct!, 0) / 5);
    });
    test('home + away + neutral and wins + losses each partition his games', () => {
        const n = (s: (typeof BB_GAME_SETS)[number]['key']) => playerGameSet(games(), s)!.games;
        const neutral = games().filter((g) => g.venue === 'neutral').length;
        expect(n('home') + n('away') + neutral).toBe(n('all'));
        expect(n('wins') + n('losses')).toBe(n('all'));
    });
});

function fakeAstro(path: string, id: string, locals: Record<string, unknown>) {
    const cache: unknown[] = [];
    return { params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any;
}
const ok = <T,>(r: T) => { if (r && typeof r === 'object' && ('notFound' in r || 'unavailable' in r)) throw new Error(JSON.stringify(r)); return r as Exclude<T, { notFound: true } | { unavailable: true }>; };
const TEAM = `/nba/team/${NETS_TEAM_ID}?season=2026&games=last10`;
const PLAYER = `/nba/players/${PID}?season=2026&games=last5`;
const OFF = { preview: true, flagOverrides: { 'bball-game-set': false } };

describe('the flag', () => {
    test("'bball-game-set' is a preview flag", () => { expect(FLAGS['bball-game-set']).toBe('preview'); });
    test("team, off: the block's read exactly (four arguments), no gameSet key", async () => {
        const r = ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS_TEAM_ID), OFF)));
        expect(block.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, NETS_ESPN);
        expect('gameSet' in r).toBe(false);
    });
    test('team, on: the read adds the counts, ?games= is read', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS_TEAM_ID), { preview: true })));
        expect(block.fn).toHaveBeenCalledWith('nba', 2026, NETS_TEAM_ID, NETS_ESPN, true);
        expect(r.gameSet).toBe('last10');
    });
    test("team, on but 'bball-team-season' off: no read, no set", async () => {
        const r = ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS_TEAM_ID), { preview: true, flagOverrides: { 'bball-team-season': false } })));
        expect(block.fn).not.toHaveBeenCalled();
        expect('gameSet' in r).toBe(false);
    });
    test('player: off, no key; on, the set', async () => {
        expect('gameSet' in ok(await prepareNbaPlayer(fakeAstro(PLAYER, String(PID), OFF)))).toBe(false);
        expect(ok(await prepareNbaPlayer(fakeAstro(PLAYER, String(PID), { preview: true }))).gameSet).toBe('last5');
    });
});

const page = (Page: any, path: string, id: string, locals: Record<string, unknown>) =>
    container.renderToString(Page, { params: { id }, request: new Request(`https://gameonpaper.com${path}`), locals: locals as unknown as App.Locals });

describe('the pages', () => {
    test('off: ?games= changes no byte of the team or the player page', async () => {
        const plain = (p: string) => p.replace(/[?&]games=[a-z0-9]+/, '');
        const t = await page(TeamPage, TEAM, String(NETS_TEAM_ID), OFF);
        expect(t).toBe(await page(TeamPage, plain(TEAM), String(NETS_TEAM_ID), OFF));
        expect(t).toContain('id="season"'); // the BB-G5 block is on
        expect(t).not.toContain('game-set');
        const p = await page(PlayerPage, PLAYER, String(PID), OFF);
        expect(p).toBe(await page(PlayerPage, plain(PLAYER), String(PID), OFF));
        expect(p).not.toContain('game-set');
    });
    test('team, on, last 10: the filtered title, the select keeping ?season=, the summed numbers', async () => {
        const html = await page(TeamPage, TEAM, String(NETS_TEAM_ID), { preview: true });
        const v = teamGameSet(NBA.rates, nets(), 'last10', 48)!;
        const panel = html.split('id="season-game-set"')[1].split('</table>')[0];
        expect(panel).toContain('Team stats (Filtered)');
        expect(panel).toContain(`value="/nba/team/${NETS_TEAM_ID}?season=2026&amp;games=last10#season-game-set" selected`);
        expect(panel).toContain(`value="/nba/team/${NETS_TEAM_ID}?season=2026#season-game-set"`);
        expect(panel).toContain(`>${v.line.off_rtg!.toFixed(1)}<`);
        expect(panel).toContain(`>${v.line.def_rtg!.toFixed(1)}<`);
        expect(panel).toContain('box score (the game page');
        // on the /preview surface the select stays on it (the public URL is where the flag is off)
        expect(panel).toContain(`onchange="window.location.href = (location.pathname.startsWith('/preview/') ? '/preview' : '') + this.value"`);
        expect(panel).not.toMatch(/hulk-bg-level-\d/); // no producer percentile for a summed set
    });
    test("team, on, all: the title unfiltered and the row the splits table's All games row", async () => {
        const html = await container.renderToString(TeamSeasonBlock, {
            props: { data: asReads(NBA), season: 2026, espnId: NETS_ESPN, teamName: 'Brooklyn Nets', gameSet: 'all' },
            request: new Request(`https://gameonpaper.com/nba/team/${NETS_TEAM_ID}?season=2026`), locals: { league: 'nba' } as App.Locals,
        });
        const cells = (table: string) => html.split(`id="${table}"`)[1].split('</tr>')[1].replace(/<[^>]+>/g, '|').split('|').map((s) => s.trim()).filter(Boolean);
        expect(html).toContain('>Team stats<');
        expect(cells('season-game-set-table')).toEqual(cells('season-splits'));
    });
    test('player, on, last 5: his summed line under the header', async () => {
        const html = await page(PlayerPage, PLAYER, String(PID), { preview: true });
        const v = playerGameSet(playerGamesFromRows(MPJ.games)!, 'last5')!;
        const panel = html.split('id="player-game-set"')[1].split('</table>')[0];
        expect(panel).toContain('Shooting (Filtered)');
        expect(panel).toContain(`>${v.line.makes}/${v.line.attempts}<`);
        expect(panel).toContain(`value="/nba/players/${PID}?season=2026&amp;games=last5#player-game-set" selected`);
    });
    test('a college team page (Duke, last 5) renders without a stray value', async () => {
        block.fn.mockResolvedValue(asReads(MBB));
        const html = await container.renderToString(TeamSeasonBlock, {
            props: { data: asReads(MBB), season: 2026, espnId: DUKE, teamName: 'Duke', gameSet: 'last5' },
            request: new Request('https://gameonpaper.com/mbb/team/150?season=2026&games=last5'), locals: { league: 'mbb' } as App.Locals,
        });
        const v = teamGameSet(MBB.rates, duke(), 'last5', 40)!;
        expect(html).toContain(`>${v.line.pace!.toFixed(1)}<`);
        expect(html).toContain('Pace per 40 minutes');
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });
    test('the player component with no games renders nothing', async () => {
        expect((await container.renderToString(PlayerGameSet, { props: { games: [], set: 'all' } })).trim()).toBe('');
    });
});
