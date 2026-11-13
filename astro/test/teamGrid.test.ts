// BB-G32: the game page's team stats grid behind 'bball-team-grid'. Fixtures (fixtures/README.md: team-grid-*.json.gz) are
// real: the offline processor body of one game per league (python/tests' ESPN captures, the pinned sdv-py with BB-D31's
// counted splits) and that season's sdv-db team_season_rates (split all). Every Data API read here is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: [] as any[], tables: {} as Record<string, any[]>, fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'team_season_rates') return api.rows;
        if (table in api.tables) return api.tables[table];
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { fromProcessor, type NbaGame, type NbaProcessorPayload } from '../src/resources/nbaGame';
import { retrieveTeamGridGame, retrieveTeamGridSeason, seasonTeamId, teamGridSeason, type TeamGridGame, type TeamGridSeason } from '../src/resources/teamGrid';
import { accounting, edge } from '../src/utils/teamGrid';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import type { BasketballLeague } from '../src/utils/league';

interface Capture {
    league: BasketballLeague; season: number; payload: NbaProcessorPayload; team_season_rates: Record<string, any>[]
    /** the ESPN game's id map (the pros' schedule_crosswalk row, college's ncaa_team_box contest ids) and the final's counted rows */
    game_map: Record<string, any>[]; team_game_possessions: Record<string, any>[]; situational_team_games: Record<string, any>[]
}
const gz = (name: string): Capture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const G: Record<BasketballLeague, Capture> = {
    nba: gz('team-grid-nba-401585607'), // TOR 96 at ORL 111, 2023-24
    wnba: gz('team-grid-wnba-401736325'), // SEA 80 at ATL 78, 2025
    mbb: gz('team-grid-mbb-401820775'), // NC State 90 at Notre Dame 96 (OT), 2025-26
    wbb: gz('team-grid-wbb-401805076'), // UTEP 87 at Louisiana Tech 91 (OT), 2025-26
};
const LEAGUES = Object.keys(G) as BasketballLeague[];
const SCHEMA: Record<BasketballLeague, string> = { nba: 'nba_stats', wnba: 'wnba_stats', mbb: 'mbb', wbb: 'wbb' };
const game = (lg: BasketballLeague): NbaGame => fromProcessor(structuredClone(G[lg].payload), lg);
const seasonOf = (lg: BasketballLeague, g = game(lg)) => teamGridSeason(G[lg].team_season_rates, seasonTeamId(lg, Number(g.home.team.id)), seasonTeamId(lg, Number(g.away.team.id)));

const PRO = (lg: BasketballLeague) => lg === 'nba' || lg === 'wnba';
/** the final's real rows behind the mocked reads: the id map, then both counted tables */
const finalTables = (lg: BasketballLeague) => ({
    [PRO(lg) ? 'schedule_crosswalk' : 'ncaa_team_box']: G[lg].game_map,
    team_game_possessions: G[lg].team_game_possessions, situational_team_games: G[lg].situational_team_games,
});
/** each side's table team id: the crosswalk's stats id for the pros, the ESPN id in college */
const tableTeam = (lg: BasketballLeague, side: 'home' | 'away') => (PRO(lg) ? Number(G[lg].game_map[0][`${lg}_${side}_team_id`]) : Number(game(lg)[side].team.id));

beforeEach(() => { api.calls.length = 0; api.rows = []; api.tables = {}; api.fail = false; [sched, proc, espn].forEach((f) => f.mockReset()); });

describe('the processor payload', () => {
    test.each(LEAGUES)('%s: each side carries its counted possessions, and a payload without splits carries none', (lg) => {
        const g = game(lg);
        for (const s of ['home', 'away'] as const) expect(g[s].splits?.possessions).toBe(G[lg].payload.splits![s].team!.possessions);
        const { splits: _, ...old } = structuredClone(G[lg].payload);
        const before = fromProcessor(old as NbaProcessorPayload, lg);
        expect(before.home).not.toHaveProperty('splits');
    });
});

describe('the season context', () => {
    test.each(LEAGUES)('%s: both sides found by the season tables\' team id; the league average is possession-weighted', (lg) => {
        const rows = G[lg].team_season_rates;
        const s = seasonOf(lg);
        expect(s.home).not.toBeNull(); expect(s.away).not.toBeNull();
        const poss = rows.reduce((t, r) => t + r.poss, 0);
        expect(s.league!.ppp).toBeCloseTo(rows.reduce((t, r) => t + r.pts, 0) / poss, 12);
        expect(s.league!.efg_pct).toBeCloseTo(rows.reduce((t, r) => t + r.efg_pct * r.poss, 0) / poss, 12);
        const efgs = rows.map((r) => r.efg_pct);
        expect(s.league!.efg_pct!).toBeGreaterThan(Math.min(...efgs)); expect(s.league!.efg_pct!).toBeLessThan(Math.max(...efgs));
    });
    test('the pros map the ESPN id to the stats id; college keys by the ESPN id', () => {
        expect(seasonTeamId('nba', 19)).toBe(1610612753); // ORL
        expect(seasonTeamId('wnba', 20)).toBe(1611661330); // ATL
        expect(seasonTeamId('mbb', 87)).toBe(87);
        expect(seasonTeamId('nba', 999999)).toBeNull();
        expect(teamGridSeason([], 1, 2)).toEqual({ home: null, away: null, league: null });
    });
    test.each(LEAGUES)('%s: one read of the league\'s season schema, split all, season-filtered and capped; at the cap it fails loud', async (lg) => {
        api.rows = G[lg].team_season_rates;
        const g = game(lg);
        const s = await retrieveTeamGridSeason(lg, G[lg].season, g.id, Number(g.home.team.id), Number(g.away.team.id));
        expect(s).toEqual(seasonOf(lg));
        expect(api.calls).toEqual([{ schema: SCHEMA[lg], table: 'team_season_rates', query: expect.objectContaining({ season: String(G[lg].season), split: 'all', limit: '1000' }) }]);
        api.rows = Array.from({ length: 1000 }, () => G[lg].team_season_rates[0]);
        await expect(retrieveTeamGridSeason(lg, G[lg].season, g.id, 1, 2)).rejects.toThrow(/at the 1000 cap/);
    });
});

describe('a final\'s counted rows', () => {
    const GAME_ID: Record<BasketballLeague, string> = { nba: '0022300979', wnba: '1022500214', mbb: '6456375', wbb: '6402602' };
    test.each(LEAGUES)('%s: the ESPN game mapped to the producer\'s id, then both tables by it, each side by the table\'s team id', async (lg) => {
        api.tables = finalTables(lg);
        const g = game(lg);
        const r = await retrieveTeamGridGame(lg, G[lg].season, g.id, Number(g.home.team.id), Number(g.away.team.id));
        const s = String(G[lg].season);
        const map = PRO(lg)
            ? { schema: lg, table: 'schedule_crosswalk', query: expect.objectContaining({ season: s, espn_game_id: g.id, limit: '1' }) }
            : { schema: lg, table: 'ncaa_team_box', query: expect.objectContaining({ season: s, espn_game_id: g.id, select: 'contest_id' }) };
        expect(api.calls).toEqual([map,
            { schema: SCHEMA[lg], table: 'team_game_possessions', query: expect.objectContaining({ season: s, game_id: GAME_ID[lg], split: 'all' }) },
            { schema: SCHEMA[lg], table: 'situational_team_games', query: expect.objectContaining({ season: s, game_id: GAME_ID[lg], limit: '60' }) }]);
        for (const side of ['home', 'away'] as const) {
            const tgp = G[lg].team_game_possessions.find((x) => x.team_id === tableTeam(lg, side))!;
            const all = G[lg].situational_team_games.find((x) => x.team_id === tableTeam(lg, side) && x.family === 'all')!;
            expect(r.poss[side]).toBe(tgp.poss);
            expect(r[side].find((x) => x.family === 'all')).toMatchObject({ poss: all.poss, off_rtg: all.off_rtg, def_rtg: all.def_rtg });
            // every family of the side's, none of the opponent's
            expect(r[side]).toHaveLength(G[lg].situational_team_games.filter((x) => x.team_id === tableTeam(lg, side)).length);
            // one definition: both producer tables count the same possessions
            expect(all.poss).toBe(tgp.poss);
        }
    });
    test('an unmapped game reads nothing past the map and has no rows; a read at the cap fails loud', async () => {
        api.tables = { schedule_crosswalk: [] };
        expect(await retrieveTeamGridGame('nba', 2024, '1', 1, 2)).toEqual({ poss: { home: null, away: null }, home: [], away: [] });
        expect(api.calls.map((c) => c.table)).toEqual(['schedule_crosswalk']);
        api.tables = { ...finalTables('mbb'), situational_team_games: Array.from({ length: 60 }, () => G.mbb.situational_team_games[0]) };
        await expect(retrieveTeamGridGame('mbb', 2026, game('mbb').id, 87, 152)).rejects.toThrow(/at the 60 cap/);
    });
});

describe('the accounting', () => {
    test.each(LEAGUES)('%s: shooting is the eFG% gap on the same shots; the total sums the four and tracks the points against an average offense', (lg) => {
        const g = game(lg), lgAvg = seasonOf(lg, g).league!;
        const books = (['home', 'away'] as const).map((s) => {
            const o = g[s === 'home' ? 'away' : 'home'];
            const a = accounting(g[s], o, g[s].splits!.possessions, lgAvg);
            expect(a.shooting).toBeCloseTo((g[s].rates!.efg_pct! - lgAvg.efg_pct!) * 2 * g[s].box!.field_goals_attempted!, 9);
            expect(a.total).toBeCloseTo(a.shooting! + a.turnovers! + a.rebounding! + a.freeThrows!, 9);
            // the linear prices stay within 4 points of pts - lg PPP x counted possessions on these four games
            expect(Math.abs(a.total! - (g[s].score! - lgAvg.ppp * g[s].splits!.possessions!))).toBeLessThan(4);
            return a.total!;
        });
        // the side the accounting favours is the side that won
        expect(books[0] > books[1]).toBe(g.home.score! > g.away.score!);
    });
    test('a missing count or league average is a dash, never a guess; no free throws leave the row and the total blank', () => {
        const g = game('nba'), lgAvg = seasonOf('nba', g).league!;
        expect(accounting(g.home, g.away, 97, null).total).toBeNull();
        expect(accounting(g.home, g.away, null, lgAvg).turnovers).toBeNull();
        const noFt = { ...g.home, box: { ...g.home.box!, free_throws_attempted: 0, free_throws_made: 0 } };
        const a = accounting(noFt, g.away, 97, lgAvg);
        expect(a.freeThrows).toBeNull(); expect(a.total).toBeNull(); expect(a.shooting).not.toBeNull();
    });
    test('edge: the better side and the gap; a tie tints nobody', () => {
        expect(edge('high', 0.5, 0.45)).toEqual({ side: 'away', gap: expect.closeTo(0.05, 12) });
        expect(edge('low', 0.12, 0.10)).toEqual({ side: 'home', gap: expect.closeTo(0.02, 12) });
        expect(edge('high', 1, 1)).toEqual({ side: null, gap: 0 });
        expect(edge('none', 1, 2)).toBeNull(); expect(edge('high', null, 2)).toBeNull();
    });
});

describe('the page', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = (lg: BasketballLeague, props: { game: NbaGame; season?: TeamGridSeason | null }, flag = true) =>
        container.renderToString(NbaGamePage, { props, request: new Request(`https://gameonpaper.com/${lg}/game/${props.game.id}`), locals: { league: lg, preview: true, flagOverrides: { 'bball-team-grid': flag } } as unknown as App.Locals });
    const plain = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');

    test.each(LEAGUES)('%s: one Team stats panel, both tables side by side at lg, counted possessions, season rows, the accounting', async (lg) => {
        const g = game(lg);
        const html = await render(lg, { game: g, season: seasonOf(lg, g) });
        // both halves of the grid are lg columns, the team box's carrying the nav's #teambox anchor
        expect(html).toMatch(/id="team-grid"[^>]*>\s*<div class="col-12 col-lg-6">/); expect(html).toContain('<div class="col-12 col-lg-6" id="teambox">');
        for (const id of ['factors', 'teambox']) expect(html).toContain(`id="${id}"`);
        const text = plain(html);
        expect(text).toContain('Team stats'); expect(text).not.toMatch(/>\s*Four factors\s*</); // the old panel title is gone
        expect(text).toContain('Possessions (counted)'); expect(text).toContain('Possessions (box estimate)');
        expect(html).toContain('aria-label="Four-factor accounting"');
        expect(html.match(/>season</g)?.length).toBe(7);
        expect(html).toContain('table-success');
        for (const bad of ['NaN', 'undefined', 'null']) expect(text).not.toContain(bad);
        // the counted cells are the processor's own numbers
        expect(text).toContain(String(g.home.splits!.possessions));
    });
    test('the gap is printed in percentage points, beside the tinted better side', async () => {
        const g = game('nba');
        const html = await render('nba', { game: g, season: seasonOf('nba', g) });
        const efgRow = html.match(/<tr[^>]*>\s*<th[^>]*>eFG%<\/th>[\s\S]*?<\/tr>/)![0];
        const gap = Math.abs(g.home.rates!.efg_pct! - g.away.rates!.efg_pct!) * 100;
        expect(efgRow).toContain(`>${gap.toFixed(1)}<`);
        expect(efgRow.match(/table-success/g)?.length).toBe(1);
    });
    test('a failed season read: the grid draws, says so, and has no season rows or accounting; no season read at all says nothing', async () => {
        const g = game('wbb');
        const failed = plain(await render('wbb', { game: g, season: null }));
        expect(failed).toContain('season context is temporarily unavailable');
        expect(failed).not.toContain('Four-factor accounting');
        const none = await render('wbb', { game: g });
        expect(none).not.toContain('>season<'); expect(none).not.toContain('temporarily unavailable');
    });
    test('a game without splits (the Data API path) shows the box estimate only', async () => {
        const g = game('mbb'); delete g.home.splits; delete g.away.splits;
        const text = plain(await render('mbb', { game: g, season: seasonOf('mbb', g) }));
        expect(text).not.toContain('Possessions (counted)');
        expect(text).toContain('Four-factor accounting'); // priced on the box estimate
    });
    test.each(LEAGUES)('%s: a final shows the producer\'s counted possessions and ratings, even with no processor splits', async (lg) => {
        api.tables = finalTables(lg);
        const g = game(lg); delete g.home.splits; delete g.away.splits; // the Data API path
        const fin: TeamGridGame = await retrieveTeamGridGame(lg, G[lg].season, g.id, Number(g.home.team.id), Number(g.away.team.id));
        const html = await render(lg, { game: g, season: { ...seasonOf(lg, g), game: fin } });
        const row = (label: string) => html.match(new RegExp(`<tr[^>]*>\\s*<th[^>]*>${label.replace(/[()]/g, '\\$&')}</th>[\\s\\S]*?</tr>`))![0];
        const all = (side: 'home' | 'away') => fin[side].find((x) => x.family === 'all')!;
        expect(row('Possessions (counted)')).toContain(`>${fin.poss.away}<`); expect(row('Possessions (counted)')).toContain(`>${fin.poss.home}<`);
        expect(row('ORtg')).toContain(`>${all('away').off_rtg!.toFixed(1)}<`); expect(row('ORtg')).toContain(`>${all('home').off_rtg!.toFixed(1)}<`);
        expect(row('DRtg')).toContain(`>${all('home').def_rtg!.toFixed(1)}<`);
        expect(row('ORtg').match(/table-success/g)?.length).toBe(1);
        const text = plain(html);
        expect(text).toContain('ORtg and DRtg are per 100 counted possessions'); expect(text).toContain('TOV% is per play');
        for (const bad of ['NaN', 'undefined', 'null']) expect(text).not.toContain(bad);
    });
    test('flag off: the two panels of today, no grid', async () => {
        const g = game('nba');
        const html = await render('nba', { game: g, season: seasonOf('nba', g) }, false);
        expect(html).not.toContain('id="team-grid"'); expect(html).not.toContain('Possessions (counted)');
        expect(html).toContain('aria-label="Four factors"'); expect(html).toContain('aria-label="Team box score"');
    });
});

describe('prepareBasketballGame', () => {
    const fakeAstro = (lg: BasketballLeague, id: string, locals: Record<string, unknown>) => {
        const cache: unknown[] = [];
        return { astro: { params: { id }, url: new URL(`https://gameonpaper.com/${lg}/game/${id}`), locals: { ...locals } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
    };
    /** the capture as a live game: ESPN and the processor both say in progress */
    const live = (lg: BasketballLeague) => {
        const p = structuredClone(G[lg].payload);
        p.status = { ...p.status, name: 'STATUS_IN_PROGRESS', completed: false, detail: '2nd Quarter' };
        const header = structuredClone(p.header);
        (header.competitions[0] as any).status = { type: { name: 'STATUS_IN_PROGRESS', completed: false, detail: '2nd Quarter' }, period: 2, displayClock: '5:00' };
        p.header = header;
        return p;
    };
    const flags = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false };
    test.each(LEAGUES)('%s: a live game reads the season once (the season and the ESPN ids) and passes it on', async (lg) => {
        const p = live(lg);
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: p.gameId, gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false }); proc.mockResolvedValueOnce(p);
        api.rows = G[lg].team_season_rates;
        const r: any = await prepareBasketballGame(fakeAstro(lg, String(p.gameId), { preview: true, flagOverrides: flags }).astro, lg);
        expect(r.game.status.completed).toBe(false);
        expect(api.calls.map((c) => [c.schema, c.table, c.query.season])).toEqual([[SCHEMA[lg], 'team_season_rates', String(G[lg].season)]]);
        expect(r.season).toEqual(seasonOf(lg, r.game));
    });
    test.each(LEAGUES)('%s: a final also reads its counted rows, mapped from the ESPN game', async (lg) => {
        const p = structuredClone(G[lg].payload);
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: p.gameId, gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false }); proc.mockResolvedValueOnce(p);
        api.rows = G[lg].team_season_rates; api.tables = finalTables(lg);
        const r: any = await prepareBasketballGame(fakeAstro(lg, String(p.gameId), { preview: true, flagOverrides: flags }).astro, lg);
        expect(r.game.status.completed).toBe(true);
        expect(api.calls.map((c) => c.table).sort()).toEqual([PRO(lg) ? 'schedule_crosswalk' : 'ncaa_team_box', 'situational_team_games', 'team_game_possessions', 'team_season_rates'].sort());
        expect(r.season.game.poss).toEqual({ home: expect.any(Number), away: expect.any(Number) });
    });
    test('flag off: a live game reads nothing and carries no season', async () => {
        const p = live('nba');
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: p.gameId, gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false }); proc.mockResolvedValueOnce(p);
        const r: any = await prepareBasketballGame(fakeAstro('nba', String(p.gameId), { preview: true, flagOverrides: { ...flags, 'bball-team-grid': false } }).astro, 'nba');
        expect(api.calls).toEqual([]); expect(r).not.toHaveProperty('season');
    });
    test('a failed read: season null, the page uncacheable', async () => {
        const p = live('mbb');
        sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: p.gameId, gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false }); proc.mockResolvedValueOnce(p);
        api.fail = true;
        const { astro } = fakeAstro('mbb', String(p.gameId), { preview: true, flagOverrides: flags });
        const r: any = await prepareBasketballGame(astro, 'mbb');
        expect(r.season).toBeNull();
        expect(astro.response.headers.get('Cache-Control') ?? '').toBe('no-store');
    });
});
