// BB-G34: the game page's player box views behind 'bball-player-box-views'. Fixtures are real: the team-grid processor
// bodies (fixtures/README.md: team-grid-*.json.gz, with BB-D31's player splits) and each game's sdv-db player_season_stats
// rows (player-box-views-*.json.gz). Every Data API read here is mocked.
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

const api = vi.hoisted(() => ({ calls: [] as { schema: string; table: string; query: Record<string, string> }[], rows: {} as Record<string, any[]>, fail: false }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRowsFrom: async (source: { schema: string }, table: string, query: Record<string, string>) => {
        api.calls.push({ schema: source.schema, table, query });
        if (api.fail) throw new Error('down');
        if (table === 'player_season_stats') return api.rows[query.team_id] ?? [];
        throw new Error(`unexpected table ${table}`);
    },
}));
const sched = vi.fn(), proc = vi.fn(), espn = vi.fn();
vi.mock('../src/resources/nbaGames', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaGames')>()), retrieveNbaSchedule: (...a: unknown[]) => sched(...a), retrieveNbaProcessedGame: (...a: unknown[]) => proc(...a) }));
vi.mock('../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../src/resources/espn')>()), retrieveGamePageGuarded: (...a: unknown[]) => espn(...a) }));

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { fromProcessor, type NbaGame, type NbaProcessorPayload } from '../src/resources/nbaGame';
import { pivotPlayerSeasonRates, retrievePlayerSeasonRates, type PlayerSeasonRate } from '../src/resources/playerSeasonRates';
import { efgPct, expectedPoints, madeAttempted, shader, viewColumns, type BoxCtx } from '../src/utils/playerBoxViews';
import { prepareBasketballGame } from '../src/routes/basketball/game';
import type { BasketballLeague } from '../src/utils/league';

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const ID: Record<BasketballLeague, string> = { nba: '401585607', wnba: '401736325', mbb: '401820775', wbb: '401805076' };
const LEAGUES = Object.keys(ID) as BasketballLeague[];
const P = Object.fromEntries(LEAGUES.map((lg) => [lg, gz(`team-grid-${lg}-${ID[lg]}`).payload])) as Record<BasketballLeague, NbaProcessorPayload>;
const S = Object.fromEntries(LEAGUES.map((lg) => [lg, gz(`player-box-views-${lg}-${ID[lg]}`)])) as Record<BasketballLeague, { season: number; player_season_stats: { home: any[]; away: any[] } }>;
const game = (lg: BasketballLeague, payload = P[lg]): NbaGame => fromProcessor(structuredClone(payload), lg);
const seasonRows = (lg: BasketballLeague) => [...S[lg].player_season_stats.home, ...S[lg].player_season_stats.away];
const rates = (lg: BasketballLeague) => pivotPlayerSeasonRates(seasonRows(lg), lg);
const noSplits = (lg: BasketballLeague) => { const { splits: _, ...old } = structuredClone(P[lg]); return old as NbaProcessorPayload; };

beforeEach(() => { api.calls.length = 0; api.rows = {}; api.fail = false; [sched, proc, espn].forEach((f) => f.mockReset()); });

describe('the processor payload', () => {
    test.each(LEAGUES)('%s: every boxed player who played carries their BB-D31 split, and it agrees with the box', (lg) => {
        const g = game(lg);
        for (const side of [g.home, g.away]) {
            const played = side.players.filter((p) => !p.did_not_play);
            expect(played.length).toBeGreaterThan(4);
            for (const p of played) {
                expect(p.split, p.name).toBeDefined();
                const fg = madeAttempted(p.fg), fg3 = madeAttempted(p.fg3);
                if (fg) expect(p.split!.fgm).toBe(fg[0]);
                if (fg3) { expect(p.split!.fg3m).toBe(fg3[0]); expect(p.split!.fg3a).toBe(fg3[1]); }
                expect(p.split!.rim_fgm!).toBeLessThanOrEqual(p.split!.rim_fga!);
                expect(p.split!.live_tov!).toBeLessThanOrEqual(p.split!.tov!);
            }
            // est_possessions is a minutes share of the team's counted possessions: five players' worth in all
            const est = played.reduce((t, p) => t + (p.split!.est_possessions ?? 0), 0);
            expect(est).toBeCloseTo(5 * side.splits!.possessions!, 6);
        }
    });
    test.each(LEAGUES)('%s: a payload cached before the splits carries none', (lg) => {
        expect(game(lg, noSplits(lg)).home.players.some((p) => 'split' in p)).toBe(false);
    });
});

describe('the season lines', () => {
    test.each(['nba', 'wnba', 'mbb'] as const)('%s: one line per player, games within a season', (lg) => {
        const r = rates(lg);
        expect(r.length).toBeGreaterThan(15);
        for (const a of r) { expect(a.gp).toBeGreaterThan(0); expect(a.min).not.toBeNull(); expect(a.pts).not.toBeNull(); }
    });
    test('wbb: the career lines under the season filter (82 to 107 games) are left out', () => {
        const gp = seasonRows('wbb').filter((r) => r.stat_name === 'gamesPlayed').map((r) => Number(r.value));
        expect(Math.max(...gp)).toBeGreaterThan(45);
        expect(rates('wbb').every((a) => a.gp <= 45)).toBe(true);
        expect(rates('wbb').length).toBeLessThan(new Set(seasonRows('wbb').map((r) => r.athlete_id)).size);
    });
    test('a capped read fails loud; each side is read by season and team in the games schema', async () => {
        api.rows = { 19: S.nba.player_season_stats.home, 28: S.nba.player_season_stats.away };
        expect(await retrievePlayerSeasonRates('nba', 2024, ID.nba, 19, 28)).toEqual(rates('nba'));
        expect(api.calls.map((c) => [c.schema, c.table, c.query.season, c.query.team_id, c.query.limit])).toEqual([['nba', 'player_season_stats', '2024', '19', '5000'], ['nba', 'player_season_stats', '2024', '28', '5000']]);
        api.rows = { 1: Array.from({ length: 5000 }, () => ({ athlete_id: 1, stat_name: 'avgPoints', value: 1 })) };
        await expect(retrievePlayerSeasonRates('nba', 2024, ID.nba, 1, 2)).rejects.toThrow(/cap/);
    });
});

describe('the views', () => {
    const pool = (g: NbaGame, avg: PlayerSeasonRate[] = []): BoxCtx[] => {
        const by = new Map(avg.map((a) => [a.athleteId, a]));
        return [g.home, g.away].flatMap((s) => s.players.filter((p) => !p.did_not_play)).map((p) => ({ p, avg: by.get(p.athlete_id) }));
    };
    test('eFG% from the box pairs; the per-minute expectation from the season line', () => {
        const g = game('nba');
        const p = g.home.players.find((x) => x.fg === '11-16')!; // Banchero, 11-16 with 4-7 from three
        expect(efgPct(p)).toBeCloseTo((11 + 0.5 * 4) / 16, 12);
        const a = rates('nba').find((x) => x.athleteId === p.athlete_id)!;
        expect(expectedPoints({ p, avg: a })).toBeCloseTo((a.pts! / a.min!) * p.minutes!, 12);
        expect(expectedPoints({ p })).toBeNull();
        expect(madeAttempted('--')).toBeNull();
    });
    test('shading: only the better half, strongest at the best; a small sample and a thin pool are not shaded', () => {
        const ctx = pool(game('nba'));
        const pts = viewColumns('basic', { pro: true, split: true }).find((c) => c.label === 'PTS')!;
        const s = shader(pts, ctx);
        const best = ctx.reduce((a, b) => ((b.p.points ?? 0) > (a.p.points ?? 0) ? b : a));
        expect(s(best)).toBeGreaterThan(0.9);
        const worst = ctx.find((c) => c.p.points === 0)!;
        expect(s(worst)).toBeNull();
        const ts = viewColumns('basic', { pro: true, split: true }).find((c) => c.label === 'TS%')!;
        const tiny = ctx.find((c) => (madeAttempted(c.p.fg)?.[1] ?? 0) + 0.44 * (madeAttempted(c.p.ft)?.[1] ?? 0) < 5 && c.p.ts_pct != null)!;
        expect(shader(ts, ctx)(tiny)).toBeNull();
        expect(shader(pts, ctx.slice(0, 3))(ctx[0])).toBeNull();
        // turnover counts rank minutes, so they are never shaded
        expect(viewColumns('basic', { pro: true, split: true }).find((c) => c.label === 'TOV')!.value).toBeUndefined();
        // usage, possessions and unassisted share describe a role, so they are not shaded either
        for (const l of ['USG%', 'Poss', 'Unast%']) expect(viewColumns('advanced', { pro: true, split: true }).find((c) => c.label === l)!.value).toBeUndefined();
    });
    test('college has no plus-minus column; without splits Advanced keeps only the box rates', () => {
        expect(viewColumns('basic', { pro: false, split: true }).map((c) => c.label)).not.toContain('+/-');
        expect(viewColumns('advanced', { pro: true, split: false }).map((c) => c.label)).toEqual(['MIN', 'TS%', 'eFG%', 'USG%']);
    });
});

describe('the page', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = (lg: BasketballLeague, props: { game: NbaGame; playerSeason?: PlayerSeasonRate[] | null }, flag = true) =>
        container.renderToString(NbaGamePage, { props, request: new Request(`https://gameonpaper.com/${lg}/game/${props.game.id}`), locals: { league: lg, preview: true, flagOverrides: { 'bball-player-box-views': flag } } as unknown as App.Locals });
    const views = (html: string) => [...html.matchAll(/class="pbv-view" data-view="(\w+)"/g)].map((m) => m[1]);

    test.each(LEAGUES)('%s: four views, Basic checked, both teams in each; starters, a bench rule, then DNPs', async (lg) => {
        const g = game(lg);
        const html = await render(lg, { game: g, playerSeason: rates(lg) });
        expect(views(html)).toEqual(['basic', 'advanced', 'shooting', 'vsavg']);
        expect(html).toMatch(/<input type="radio" class="btn-check" name="pbv" id="pbv-basic" value="basic" autocomplete="off" checked/);
        for (const id of ['box-away', 'box-home', 'box-away-advanced', 'box-home-shooting', 'box-away-vsavg']) expect(html).toContain(`id="${id}"`);
        expect(html.match(/class="pbv-bench"/g)!.length).toBe(4 * 2);
        const dnp = [g.home, g.away].flatMap((s) => s.players.filter((p) => p.did_not_play));
        for (const p of dnp) expect(html.replaceAll('&#39;', "'")).toContain(p.reason ?? 'DNP');
        expect(html).toContain('pbv-shade'); expect(html).toMatch(/style="--pbv-s:(0\.\d+|1)"/);
        expect(html.includes('>+/-</th>')).toBe(lg === 'nba' || lg === 'wnba');
    });
    test('a Data API final (no splits): no Shooting view, Advanced says why; Vs average without the read is absent', async () => {
        const html = await render('nba', { game: game('nba', noSplits('nba')) });
        expect(views(html)).toEqual(['basic', 'advanced']);
        expect(html).toContain('The possession columns are counted from the play-by-play');
    });
    test('a failed season read: Vs average says the averages are unavailable', async () => {
        const html = await render('mbb', { game: game('mbb'), playerSeason: null });
        expect(views(html)).toContain('vsavg'); expect(html).toContain('Season averages are unavailable right now.');
    });
    test('flag off: today\'s box, no views', async () => {
        const html = await render('nba', { game: game('nba'), playerSeason: rates('nba') }, false);
        expect(html).not.toContain('player-box-views'); expect(html).not.toContain('pbv-');
        expect(html).toContain('id="box-away"'); expect(html).toContain('id="box-home"');
    });
});

describe('prepareBasketballGame', () => {
    const fakeAstro = (lg: BasketballLeague, id: string, locals: Record<string, unknown>) =>
        ({ params: { id }, url: new URL(`https://gameonpaper.com/${lg}/game/${id}`), locals: { ...locals } as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
    const live = (lg: BasketballLeague) => {
        const p = structuredClone(P[lg]);
        p.status = { ...p.status, name: 'STATUS_IN_PROGRESS', completed: false, detail: '2nd Quarter' };
        (p.header.competitions[0] as any).status = { type: { name: 'STATUS_IN_PROGRESS', completed: false, detail: '2nd Quarter' }, period: 2, displayClock: '5:00' };
        return p;
    };
    const flags = { 'bball-impact-box': false, 'bball-game-flow': false, 'bball-garbage-time': false, 'bball-team-grid': false };
    const arrange = (p: NbaProcessorPayload) => { sched.mockResolvedValueOnce(null); espn.mockResolvedValueOnce({ page: { gameId: p.gameId, gamepackageJSON: { header: p.header } }, regressed: false, fetchFailed: false }); proc.mockResolvedValueOnce(p); };
    test.each(LEAGUES)('%s: a live game reads both sides\' season lines and passes them on', async (lg) => {
        const p = live(lg); arrange(p);
        api.rows = { [p.teamInfo.home.id]: S[lg].player_season_stats.home, [p.teamInfo.away.id]: S[lg].player_season_stats.away };
        const r: any = await prepareBasketballGame(fakeAstro(lg, String(p.gameId), { preview: true, flagOverrides: { ...flags, 'bball-player-box-views': true } }), lg);
        expect(api.calls.map((c) => [c.table, c.query.season])).toEqual([['player_season_stats', String(S[lg].season)], ['player_season_stats', String(S[lg].season)]]);
        expect(r.playerSeason).toEqual(rates(lg));
    });
    test('flag off: no read, no playerSeason', async () => {
        const p = live('nba'); arrange(p);
        const r: any = await prepareBasketballGame(fakeAstro('nba', String(p.gameId), { preview: true, flagOverrides: { ...flags, 'bball-player-box-views': false } }), 'nba');
        expect(api.calls).toEqual([]); expect(r).not.toHaveProperty('playerSeason');
    });
    test('a failed read: playerSeason null, the page uncacheable', async () => {
        const p = live('wnba'); arrange(p); api.fail = true;
        const astro = fakeAstro('wnba', String(p.gameId), { preview: true, flagOverrides: { ...flags, 'bball-player-box-views': true } });
        const r: any = await prepareBasketballGame(astro, 'wnba');
        expect(r.playerSeason).toBeNull();
        expect(astro.response.headers.get('Cache-Control') ?? '').toBe('no-store');
    });
});
