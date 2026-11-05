// BB-G12 ('bball-rank-neighbors'): football's nearby-rank lists on the basketball team and player pages, on real Data API
// reads (fixtures/README.md, "BB-G12 nearby ranks"): every 2025-26 NBA team_strength row, Duke's D-I top 12 by net rating,
// and the stats.nba.com rank windows around Michael Porter Jr. (1629008) on the four player measures.
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url)).toString()) as Record<string, any>[];
const TEAMS = fixture('nba/rank_neighbors_teams_2026');
const DUKE_TOP = fixture('mbb/rank_neighbors_teams_2026_top12');
const PLAYERS = fixture('nba/rank_neighbors_players_2026');
const NETS = 1610612751;
const MPJ = 1629008;

const reads = vi.hoisted(() => ({ teams: vi.fn(), players: vi.fn() }));
vi.mock('../src/resources/bballNeighbors', async (orig) => ({
    ...(await orig<typeof import('../src/resources/bballNeighbors')>()),
    retrieveTeamRankRows: reads.teams,
    retrievePlayerRankRows: reads.players,
}));
// BB-G5's season block, on with preview: its own tests cover it; here it is an empty read
vi.mock('../src/resources/teamSeason', async (orig) => ({
    ...(await orig<typeof import('../src/resources/teamSeason')>()),
    retrieveTeamSeason: async () => ({ rates: [], strength: null, games: [], gameRates: [] }),
}));
const nba = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());
const oracle = nba('league_context');
const shots = nba('shots') as any[];
const playerGames = nba('player_games') as Record<string, any[]>;
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
    retrievePlayerGameRows: async (_s: number, id: number) => (playerGames[String(id)] ?? []).map((g) => ({
        season: 2026, person_id: id, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
        fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
    })),
    retrievePlayerSeasons: async () => [2025, 2026],
}));

import { prepareBasketballPlayer } from '../src/routes/basketball/player';
import { prepareBasketballTeam } from '../src/routes/basketball/team';
import { bballPlayerNeighborLists, bballTeamNeighborLists } from '../src/utils/bballNeighbors';
import { FLAGS } from '../src/utils/features';
import { formatRank } from '../src/utils/misc';

const ON = { 'bball-rank-neighbors': true, 'bball-team-season': false };
const OFF = { 'bball-rank-neighbors': false, 'bball-team-season': false };
function fakeAstro(path: string, id: string, flagOverrides: Record<string, boolean>) {
    const cache: unknown[] = [];
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: { flagOverrides } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
const ok = <T extends object>(r: T) => { if ('notFound' in r || 'unavailable' in r) throw new Error(JSON.stringify(r)); return r as Exclude<T, { notFound: true } | { unavailable: true }>; };
/** The producer rows a list must hold: every row ranked within five places of the page's own, in rank order. */
const window = (rows: Record<string, any>[], key: string, self: number, metric: string) => {
    const mine = rows.find((r) => r[key] === self)![`${metric}_rank`];
    return rows.filter((r) => r[`${metric}_rank`] != null && Math.abs(r[`${metric}_rank`] - mine) <= 5).sort((a, b) => a[`${metric}_rank`] - b[`${metric}_rank`] || String(a[key]).localeCompare(String(b[key])));
};

beforeAll(() => {
    // every Data API read in this file is mocked above: a request that slips through must fail here, never reach the network
    vi.stubGlobal('fetch', () => { throw new Error('unmocked network read'); });
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
    reads.teams.mockReset().mockResolvedValue(TEAMS);
    reads.players.mockReset().mockResolvedValue(PLAYERS);
});

describe('bballTeamNeighborLists', () => {
    test('the Nets (stats id 1610612751): six lists, each the producer rows within five ranks, the Nets marked', () => {
        const lists = bballTeamNeighborLists(TEAMS, NETS, 'nba', 2026, '');
        expect(lists.map((l) => l.metric)).toEqual(['net_rtg', 'off_rtg', 'def_rtg', 'adj_net_rtg', 'efg_pct', 'opp_efg_pct']);
        for (const l of lists) {
            const want = window(TEAMS, 'team_id', NETS, l.metric);
            expect(l.rows.map((r) => r.key)).toEqual(want.map((r) => String(r.team_id)));
            expect(l.rows.map((r) => r.rank)).toEqual(want.map((r) => formatRank(r[`${l.metric}_rank`])));
            expect(l.rows.filter((r) => r.self).map((r) => r.key)).toEqual([String(NETS)]);
        }
        // net rating: the Nets are 29th of 30 (-10.2), so the list is 24th to 30th
        const net = lists[0];
        expect(net.rows).toHaveLength(7);
        expect(net.rows.find((r) => r.self)).toMatchObject({ rank: '29', label: 'Brooklyn Nets', href: `/nba/team/${NETS}`, teamId: '17', value: '-10.2', team: null });
        expect(lists[4].rows.find((r) => r.self)!.value).toBe('52.0%'); // eFG% .5204, 30th
        expect(lists.every((l) => l.rows.every((r) => r.shade === null || /^hulk-bg-level-\d$/.test(r.shade)))).toBe(true);
    });
    test('college keys by ESPN id: Duke (150) first in net rating, the list running to 6th', () => {
        const net = bballTeamNeighborLists(DUKE_TOP, 150, 'mbb', 2026, '?season=2026')[0];
        expect(net.metric).toBe('net_rtg');
        expect(net.rows.map((r) => r.rank)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(net.rows[0]).toMatchObject({ key: '150', self: true, teamId: '150', href: '/mbb/team/150?season=2026', value: '+27.2' });
    });
    test('a team with no producer rank gets no list', () => {
        expect(bballTeamNeighborLists(TEAMS, 1, 'nba', 2026, '')).toEqual([]);
    });
});

describe('bballPlayerNeighborLists', () => {
    test('Michael Porter Jr.: four lists of eleven, the stats.nba.com ranks around his own, with the team column', () => {
        const lists = bballPlayerNeighborLists(PLAYERS, MPJ, 'nba', 2026, '');
        expect(lists.map((l) => l.metric)).toEqual(['net_rating', 'ts_pct', 'usg_pct', 'pie']);
        const own = PLAYERS.find((p) => p.player_id === MPJ)!;
        expect([own.net_rating_rank, own.ts_pct_rank, own.usg_pct_rank, own.pie_rank]).toEqual([412, 205, 23, 48]);
        for (const l of lists) {
            const want = window(PLAYERS, 'player_id', MPJ, l.metric);
            expect(l.rows).toHaveLength(11);
            expect(l.rows.map((r) => r.key)).toEqual(want.map((r) => String(r.player_id)));
            expect(l.rows.filter((r) => r.self)).toHaveLength(1);
        }
        expect(lists[2].rows.find((r) => r.self)).toMatchObject({ rank: '23', label: 'Michael Porter Jr.', href: `/nba/players/${MPJ}`, teamId: '17', value: '29.2%', team: { label: 'BKN', href: `/nba/team/${NETS}` } });
        expect(lists[0].rows.find((r) => r.self)!.value).toBe('-6.6');
    });
});

describe('the team and player pages with the flag', () => {
    test("'bball-rank-neighbors' is a preview flag", () => { expect(FLAGS['bball-rank-neighbors']).toBe('preview'); });
    test('off: no read and no neighbors key on either page', async () => {
        const t = ok(await prepareBasketballTeam(fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), OFF).astro, 'nba'));
        const p = ok(await prepareBasketballPlayer(fakeAstro(`/nba/players/${MPJ}?season=2026`, String(MPJ), OFF).astro, 'nba'));
        expect('neighbors' in t || 'neighbors' in p).toBe(false);
        expect(reads.teams).not.toHaveBeenCalled();
        expect(reads.players).not.toHaveBeenCalled();
    });
    test('on: one season read per page, the lists built from it', async () => {
        const t = ok(await prepareBasketballTeam(fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), ON).astro, 'nba'));
        expect(reads.teams).toHaveBeenCalledTimes(1);
        expect(reads.teams).toHaveBeenCalledWith('nba', 2026);
        expect(t.neighbors).toEqual(bballTeamNeighborLists(TEAMS, NETS, 'nba', 2026, t.q));
        const p = ok(await prepareBasketballPlayer(fakeAstro(`/nba/players/${MPJ}?season=2026`, String(MPJ), ON).astro, 'nba'));
        expect(reads.players).toHaveBeenCalledWith('nba', 2026);
        expect(p.neighbors).toEqual(bballPlayerNeighborLists(PLAYERS, MPJ, 'nba', 2026, p.q));
    });
    test('on, a failed read: the page renders, the lists are null, nothing is cached', async () => {
        reads.teams.mockRejectedValue(new Error('down'));
        reads.players.mockRejectedValue(new Error('down'));
        const tt = fakeAstro(`/nba/team/${NETS}?season=2026`, String(NETS), ON);
        const t = ok(await prepareBasketballTeam(tt.astro, 'nba'));
        expect(t.neighbors).toBeNull();
        expect(tt.cache.at(-1)).toBe(false);
        const pp = fakeAstro(`/nba/players/${MPJ}?season=2026`, String(MPJ), ON);
        const p = ok(await prepareBasketballPlayer(pp.astro, 'nba'));
        expect(p.neighbors).toBeNull();
        expect(pp.cache.at(-1)).toBe(false);
    });
    test('on, a 404 player spends no read', async () => {
        expect(await prepareBasketballPlayer(fakeAstro('/nba/players/1?season=2026', '1', ON).astro, 'nba')).toEqual({ notFound: true });
        expect(reads.players).not.toHaveBeenCalled();
    });
});

describe('rendered', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = async (file: string, url: string, id: string, flags: Record<string, boolean>) => {
        const { default: Page } = await import(/* @vite-ignore */ `../src/pages/nba/${file}`);
        return container.renderToString(Page, { params: { id }, request: new Request(`https://gameonpaper.com${url}`), locals: { flagOverrides: { nba: true, ...flags } } as App.Locals });
    };
    test('team page: the Nearby ranks section, its link, six tables, the Nets row marked', async () => {
        const html = await render('team/[id].astro', `/nba/team/${NETS}?season=2026`, String(NETS), ON);
        expect(html).toContain('<a href="#nearby-ranks" class="ms-2">Nearby ranks</a>');
        const section = html.split('id="nearby-ranks"')[1].split('</section>')[0];
        expect(section.match(/<table/g)).toHaveLength(6);
        expect(section.match(/data-nb-self="true"/g)).toHaveLength(6);
        expect(section).toContain('aria-current="page"');
        expect(section).toContain('https://a.espncdn.com/i/teamlogos/nba/500/17.png');
        expect(section).not.toContain('undefined');
    });
    test('player page: four tables, the Team column, the stats.nba.com note', async () => {
        const html = await render('players/[id].astro', `/nba/players/${MPJ}?season=2026`, String(MPJ), ON);
        const section = html.split('id="nearby-ranks"')[1].split('</section>')[0];
        expect(section.match(/<table/g)).toHaveLength(4);
        expect(section).toMatch(/NBA.com(&#39;|')s own ranks/);
        expect(section).toContain(`href="/nba/team/${NETS}?season=2026"`); // 2025-26 is not the current season
        expect(section).not.toContain('undefined');
    });
    test('a failed read says the section is unavailable', async () => {
        reads.teams.mockRejectedValue(new Error('down'));
        const html = await render('team/[id].astro', `/nba/team/${NETS}?season=2026`, String(NETS), ON);
        expect(html).toContain('The nearby ranks are temporarily unavailable.');
    });
    test('off: no section and no link', async () => {
        const html = await render('team/[id].astro', `/nba/team/${NETS}?season=2026`, String(NETS), OFF);
        expect(html).not.toContain('nearby-ranks');
    });
});
