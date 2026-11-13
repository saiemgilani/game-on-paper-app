// BB-G25 review (Q27): the game page's Situations panel behind 'bball-situational'. The reads' queries and id maps (the
// pros' ESPN game id through schedule_crosswalk to the stats ids, college's through ncaa_team_box to the contest id), the
// route step (off or not final: nothing read; a failed read keeps the page and is never cached) and the template, on live
// captures of two finals (fixtures/README.md: situations-game-2026.json.gz). Every Data API read is mocked.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { expect(fetched).toEqual([]); });

const CAP = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/situations-game-2026.json.gz', import.meta.url))).toString());
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nba/${name}.json`, import.meta.url)).toString());

const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
const g = vi.hoisted(() => ({ sched: vi.fn(), rows: vi.fn(), proc: vi.fn(), espn: vi.fn(), sit: vi.fn() }));
vi.mock('../src/resources/nbaGames', () => ({ retrieveNbaSchedule: (...a: unknown[]) => g.sched(...a), retrieveNbaGameRows: (...a: unknown[]) => g.rows(...a), retrieveNbaProcessedGame: (...a: unknown[]) => g.proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => g.espn(...a) }));

import GameSituations from '../src/components/nba/game/GameSituations.astro';
import { retrieveGameSituational } from '../src/resources/situational';
import { prepareNbaGame } from '../src/routes/nba/game';
import { parseSituation, SITUATION_COLS, situationsFor, type GameSituationsTab } from '../src/utils/situations';

const NETS = '1610612751';
const PISTONS = '1610612765';
const COLS = 'family,split,games,minutes,poss,opp_poss,pts,opp_pts,plus_minus,off_rtg,def_rtg,net_rtg';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { sdv.rows.mockReset(); sdv.from.mockReset(); Object.values(g).forEach((f) => f.mockReset()); });

describe('retrieveGameSituational', () => {
    test('the NBA: the ESPN id maps through schedule_crosswalk to the stats game and team ids, then one game read', async () => {
        sdv.from.mockResolvedValueOnce(CAP.nba.crosswalk);
        sdv.rows.mockResolvedValueOnce(CAP.nba.rows);
        const r = await retrieveGameSituational('nba', 2026, '401809773', '17', '8');
        expect(sdv.from.mock.calls[0][0].schema).toBe('nba');
        expect(sdv.from.mock.calls[0].slice(1, 3)).toEqual(['schedule_crosswalk', { season: '2026', espn_game_id: '401809773', select: 'nba_game_id,nba_home_team_id,nba_away_team_id', limit: '2' }]);
        expect(sdv.rows.mock.calls[0].slice(0, 3)).toEqual(['nba', 'situational_team_games', { season: '2026', game_id: '0022500031', select: `team_id,${COLS}`, limit: '60' }]);
        expect(sdv.rows.mock.calls[0][4]).toBe(true);
        // DET at BKN, Nov 7 2025: 19 splits a side, each side's own team id
        expect([r.home.length, r.away.length]).toEqual([19, 19]);
        expect(r.home.every((x: any) => String(x.team_id) === NETS)).toBe(true);
        expect(r.away.every((x: any) => String(x.team_id) === PISTONS)).toBe(true);
        expect(r.home.find((x) => x.family === 'all')!.pts).toBe(107);
    });
    test('college: the ESPN id maps through ncaa_team_box to the contest id; the rows carry ESPN team ids', async () => {
        sdv.rows.mockResolvedValueOnce(CAP.mbb.teamBox).mockResolvedValueOnce(CAP.mbb.rows);
        const r = await retrieveGameSituational('mbb', 2026, '401856577', '150', '41');
        expect(sdv.rows.mock.calls[0].slice(0, 3)).toEqual(['mbb', 'ncaa_team_box', { season: '2026', espn_game_id: '401856577', select: 'contest_id', limit: '4' }]);
        expect(sdv.rows.mock.calls[1][2]).toMatchObject({ game_id: '6564880' });
        expect(sdv.from).not.toHaveBeenCalled();
        // Duke (home) and UConn: 15 splits each, and in the clutch Duke's points are UConn's allowed
        expect([r.home.length, r.away.length]).toEqual([15, 15]);
        const clutch = (rows: any[]) => rows.find((x) => x.family === 'clutch' && x.split === 'clutch');
        expect(clutch(r.home).pts).toBe(clutch(r.away).opp_pts);
    });
    test('no id pair: no rows, and no game read', async () => {
        sdv.from.mockResolvedValueOnce([]);
        expect(await retrieveGameSituational('wnba', 2025, '401736123', '1', '2')).toEqual({ home: [], away: [] });
        expect(sdv.from.mock.calls[0][2].select).toBe('wnba_game_id,wnba_home_team_id,wnba_away_team_id');
        sdv.rows.mockResolvedValueOnce([]);
        expect(await retrieveGameSituational('wbb', 2026, '401800000', '1', '2')).toEqual({ home: [], away: [] });
        expect(sdv.rows).toHaveBeenCalledTimes(1);
    });
});

describe('the route', () => {
    const api = () => read('game_401766458_api');
    const astro = (locals: any, q = '') => ({ params: { id: '401766458' }, url: new URL(`https://gameonpaper.com/nba/game/401766458${q}`), locals, cache: { set: vi.fn() }, response: { headers: new Headers() } }) as any;
    const final = () => { g.sched.mockResolvedValueOnce(api().schedule[0]); g.rows.mockResolvedValueOnce(api()); };
    test('off: no situational read and no situations key (the prep is today\'s)', async () => {
        final();
        const r = await prepareNbaGame(astro({}));
        expect('game' in r).toBe(true);
        expect('situations' in r).toBe(false);
        expect(sdv.rows).not.toHaveBeenCalled();
        expect(sdv.from).not.toHaveBeenCalled();
    });
    test('on, a final: the ESPN ids and ?situation= go to the read; a failed read keeps the page, null, never cached', async () => {
        final();
        sdv.from.mockResolvedValueOnce(CAP.nba.crosswalk);
        sdv.rows.mockResolvedValueOnce(CAP.nba.rows);
        const r: any = await prepareNbaGame(astro({ preview: true }, '?situation=leading'));
        expect(r.situations.situation.key).toBe('leading');
        expect(sdv.from.mock.calls[0][2]).toMatchObject({ season: String(r.game.season), espn_game_id: '401766458' });
        expect(r.situations.reads).not.toBeNull();
        final();
        sdv.from.mockRejectedValueOnce(new Error('503'));
        const a = astro({ preview: true });
        const bad: any = await prepareNbaGame(a);
        expect('game' in bad).toBe(true);
        expect(bad.situations.reads).toBeNull();
        expect(a.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test("a Data API final with no situational rows yet is held 6 hours, not the final's year; with rows, the year", async () => {
        final();
        sdv.from.mockResolvedValueOnce(CAP.nba.crosswalk);
        sdv.rows.mockResolvedValueOnce([]);
        const empty = astro({ preview: true });
        const r: any = await prepareNbaGame(empty);
        expect(r.situations.reads).toEqual({ home: [], away: [] });
        expect(empty.cache.set.mock.calls.at(-1)[0]).toMatchObject({ maxAge: 6 * 60 * 60 });
        final();
        sdv.from.mockResolvedValueOnce(CAP.nba.crosswalk);
        sdv.rows.mockResolvedValueOnce(CAP.nba.rows);
        const built = astro({ preview: true });
        await prepareNbaGame(built);
        expect(built.cache.set).toHaveBeenCalledTimes(1);
        expect(built.cache.set.mock.calls[0][0]).toMatchObject({ maxAge: 60 * 60 * 24 * 7 * 52, tags: ['game-completed', 'nba'] });
    });
});

describe('GameSituations', () => {
    const game = { id: '401809773', home: { team: { displayName: 'Brooklyn Nets' } }, away: { team: { displayName: 'Detroit Pistons' } } } as any;
    const reads = { home: CAP.nba.rows.filter((r: any) => String(r.team_id) === NETS), away: CAP.nba.rows.filter((r: any) => String(r.team_id) === PISTONS) };
    const tab = (key: string, r: GameSituationsTab['reads'] = reads): GameSituationsTab => {
        const options = situationsFor('nba', 2026);
        return { situation: parseSituation(key, options), options, reads: r };
    };
    const render = (data: GameSituationsTab) => container.renderToString(GameSituations, { props: { game, data }, locals: { league: 'nba' } as App.Locals });
    test('Leading: each team in the situation, then its whole game, the producer columns incl. opp poss, pts and opp pts', async () => {
        const html = await render(tab('leading'));
        const body = html.split('id="game-situations"')[1].split('<tbody>')[1].split('</tbody>')[0];
        expect(body.match(/<tr>/g)).toHaveLength(4);
        for (const h of ['Opp poss', 'Pts', 'Opp pts', 'ORtg', 'DRtg', 'Net', '+/-']) expect(html).toContain(`>${h}</abbr>`);
        expect(SITUATION_COLS).toHaveLength(10);
        // the Nets leading: 32 poss, 35 opp poss, 29 pts, 37 opp pts, ORtg 90.6
        const nets = body.split('<tr>').find((t) => t.includes('Brooklyn Nets') && t.includes('Leading'))!;
        const cells = [...nets.matchAll(/<td class="numeral text-end">([^<]*)<\/td>/g)].map((m) => m[1]);
        expect(cells.slice(2, 7)).toEqual(['32', '35', '29', '37', '90.6']);
        expect(html).toContain('?situation=leading#situations');
        expect(html).toContain('value="/nba/game/401809773#situations"'); // All drops the param
        for (const bad of ['undefined', 'NaN']) expect(html).not.toContain(bad);
    });
    test("Second chance: each team's chance/second_chance row from the producer, then its whole game", async () => {
        const html = await render(tab('second_chance'));
        const body = html.split('id="game-situations"')[1].split('<tbody>')[1].split('</tbody>')[0];
        expect(body.match(/<tr>/g)).toHaveLength(4);
        const own = reads.home.find((r: any) => r.family === 'chance' && r.split === 'second_chance');
        const nets = body.split('<tr>').find((t) => t.includes('Brooklyn Nets') && t.includes('Second chance'))!;
        const cells = [...nets.matchAll(/<td class="numeral text-end">([^<]*)<\/td>/g)].map((m) => m[1]);
        expect(cells.slice(2, 5)).toEqual([String(own.poss), String(own.opp_poss), String(own.pts)]);
        expect(html).toContain('value="/nba/game/401809773?situation=second_chance#situations" selected');
    });
    test('a situation a team had no possession in shows its whole game only; no rows and a failed read say so', async () => {
        const clutch = await render(tab('clutch'));
        expect(clutch.split('id="game-situations"')[1].split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g)).toHaveLength(2); // no clutch row in this game
        expect(await render(tab('all', { home: [], away: [] }))).toContain('id="game-situations-empty"');
        expect(await render(tab('all', null))).toContain('id="game-situations-unavailable"');
    });
});
