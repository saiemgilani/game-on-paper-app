// BB-G8: the basketball leaderboards behind 'bball-leaderboards-v2', on real Data API captures (fixtures/README.md:
// leaderboards-v2-2026.json.gz). The spec's §4.3 bug list each gets a test that fails if its fix is mutated out:
//   1. an unknown basis falls through silently;
//   2. sorting uses a different value than the one shown;
//   3. percentiles are computed on a different basis than the one shown.
// Plus: the reads' exact queries, the flag, failed / empty reads, impact without percentiles, the qualified filter.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// no network: an unmocked Data API read (vitest's dummy SDV_AUTH_TOKEN) fails auth and locks the IP out, so any fetch
// throws, is recorded, and fails the file (#399's rollingMovers.render.test.ts)
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

type Row = Record<string, any>;
const FX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/leaderboards-v2-2026.json.gz', import.meta.url))).toString()) as Record<string, Row[]>;
// the per-game and per-75 columns (#413 Q25), captured 2026-11-13: 2026 for all four leagues, and WNBA 2024 (not backfilled)
const BX = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/leaderboards-v2-bases-2026.json.gz', import.meta.url))).toString()) as Record<string, Row[]>;

const sdv = vi.hoisted(() => ({ rows: vi.fn(), from: vi.fn() }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: (...a: unknown[]) => sdv.rows(...a),
    retrieveRowsFrom: (...a: unknown[]) => sdv.from(...a),
}));
const shots = vi.hoisted(() => ({ players: vi.fn() }));
vi.mock('../src/resources/nbaShots', async (orig) => ({ ...(await orig<typeof import('../src/resources/nbaShots')>()), retrieveSeasonPlayerRows: (...a: unknown[]) => shots.players(...a) }));

import { retrieveBoard, selectFor, LINEUP_FLOOR, IMPACT_FLOOR, BOARD_CAP } from '../src/resources/leaderboards';
import { prepareLeaderboards } from '../src/routes/basketball/leaderboards';
import BasketballLeaderboardsRoute from '../src/components/routes/BasketballLeaderboardsRoute.astro';
import Header from '../src/components/Header.astro';
import NbaLeadersRoute from '../src/components/routes/NbaLeadersRoute.astro';
import type { NbaLeadersParams } from '../src/routes/nba/leaders';
import { BASES, BOARDS, TEAM_GROUPS, boardSpec, cellOf, IMPACT_QUALIFIED_POSS, isQualified, ncaaName, offeredBases, parseControls, shown, sortRows, srcFor, type Basis, type View } from '../src/utils/leaderboards';
import { FLAGS } from '../src/utils/features';
import { generateColorRampValue, generateMarginalString } from '../src/utils/misc';
import type { BasketballLeague } from '../src/utils/league';

/** What the Data API answers each board's read, from the captures (the API's own filters applied where a read has one). */
function serve(league: string, table: string, q: Record<string, string>): Row[] {
    const key = `${league}:${table}`;
    const t: Record<string, Row[]> = {
        'nba:player_impact': FX.nbaImpact, 'mbb:ncaa_rapm': q.select === 'player_id,player' ? FX.mbbNames : FX.mbbImpact,
        'wnba:team_season_rates': FX.wnbaRates, 'wnba:team_strength': FX.wnbaStrength, 'wnba:team_season_flow': FX.wnbaFlow,
        'mbb:team_season_rates': FX.mbbRates, 'nba:lineup_seasons': FX.nbaLineups, 'mbb:lineup_seasons': FX.mbbLineups,
    };
    if (!t[key]) throw new Error(`no capture for ${key}`);
    return t[key].filter((r) => !q.poss__gte || r.poss >= Number(q.poss__gte));
}
const sourceLeague = (src: { schema: string }) => src.schema.replace('_stats', '');
beforeEach(() => {
    sdv.rows.mockReset(); sdv.from.mockReset(); shots.players.mockReset();
    sdv.rows.mockImplementation(async (lg: string, table: string, q: Record<string, string>) => serve(lg, table, q));
    sdv.from.mockImplementation(async (src: { schema: string }, table: string, q: Record<string, string>) => serve(sourceLeague(src), table, q));
    shots.players.mockImplementation(async () => FX.nbaNames);
});

const locals = (on = true) => ({ preview: true, flagOverrides: { 'bball-leaderboards-v2': on } }) as unknown as App.Locals;
const fakeAstro = (lg: BasketballLeague, query: string, on = true) => {
    const cache = { set: vi.fn() };
    return { params: {}, url: new URL(`https://gameonpaper.com/${lg}/leaderboards${query}`), locals: { ...locals(on) }, cache, response: { headers: new Headers() } } as any;
};
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function board(lg: BasketballLeague, query: string) {
    const A = fakeAstro(lg, query);
    const data = await prepareLeaderboards(A, lg);
    const html = await container.renderToString(BasketballLeaderboardsRoute, { props: { data }, locals: { league: lg, preview: true } as App.Locals });
    return { data, html, A };
}
/** The table's body cells, one array per row (the identity cell first), as text. */
const cells = (html: string) => [...html.matchAll(/<tr[^>]*>\s*(<td[\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').trim()));
const num = (s: string) => (s === '—' ? null : Number(s.replace(/[+,%s]/g, '').replace('−', '-')));
const colIndex = (data: Awaited<ReturnType<typeof board>>['data'], key: string) => 1 + data.spec.cols.findIndex((c) => c.key === key);

describe('the flag', () => {
    test("is 'preview'", () => expect(FLAGS['bball-leaderboards-v2']).toBe('preview'));
    test('off: the page is the site 404 and nothing is read', async () => {
        const { default: Page } = await import('../src/pages/nba/leaderboards.astro');
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/nba/leaderboards'), locals: locals(false) }).catch((e: Error) => e);
        // the container has no /404 route to rewrite to: either a 404 response or the rewrite's own error, never the board
        if (res instanceof Response) {
            expect(res.status).toBe(404);
            expect(await res.text()).not.toContain('id="leaderboards"');
        } else expect(String(res)).toMatch(/404|rewrite/i);
        expect(sdv.rows).not.toHaveBeenCalled();
        expect(sdv.from).not.toHaveBeenCalled();
        expect(shots.players).not.toHaveBeenCalled();
    });
    // Q27: a Header entry and a link from the rolling Leaders page, both behind the flag (the flag-off byte identity
    // of the Header and /nba/leaders is pinned by test/nba/byteIdentity.render.test.ts)
    const withLeague = (lg: BasketballLeague, on: boolean) => ({ ...locals(on), league: lg }) as unknown as App.Locals;
    test.each(['nba', 'wnba', 'mbb', 'wbb'] as const)('%s: the Header links the boards only with the flag on', async (lg) => {
        const on = await container.renderToString(Header, { locals: withLeague(lg, true) });
        const off = await container.renderToString(Header, { locals: withLeague(lg, false) });
        expect(on).toContain(`href="/${lg}/leaderboards"`);
        expect(off).not.toContain('/leaderboards"');
        expect(on.replace(/<li><a href="\/[a-z]+\/leaderboards"[^>]*>Leaderboards<\/a><\/li>/, '')).toBe(off);
    });
    test.each(['nba', 'wbb'] as const)('%s: the rolling Leaders page links the boards, keeping its season, only with the flag on', async (lg) => {
        const data = { season: 2025, seasons: [2026, 2025], current: 2026, q: '?season=2025', boards: null } as unknown as NbaLeadersParams;
        const on = await container.renderToString(NbaLeadersRoute, { props: { data }, locals: withLeague(lg, true) });
        const off = await container.renderToString(NbaLeadersRoute, { props: { data }, locals: withLeague(lg, false) });
        expect(on).toContain(`<a href="/${lg}/leaderboards?season=2025">`);
        expect(off).not.toContain('id="leaderboards-link"');
    });
});

describe('the reads (one strict, season-filtered, capped read per board)', () => {
    test('impact, NBA: player_impact in the games schema, regular season, the floor, most possessions first', async () => {
        await retrieveBoard('nba', 2026, 'impact', 'ratings', 5);
        expect(sdv.from).toHaveBeenCalledTimes(1);
        const [src, table, q, , strict] = sdv.from.mock.calls[0];
        expect([src.schema, table, strict]).toEqual(['nba', 'player_impact', true]);
        expect(q).toMatchObject({ season: '2026', season_type: 'Regular Season', off_poss__gte: String(IMPACT_FLOOR.nba), order: '-off_poss', limit: String(BOARD_CAP) });
        // the deprecated darko_* aliases are never read; no rank columns are asked for (the producer has none yet)
        expect(q.select).not.toMatch(/darko|_rank|_pct/);
    });
    test('impact, MBB: ncaa_rapm, the league estimand', async () => {
        await retrieveBoard('mbb', 2026, 'impact', 'ratings', 5);
        const [lg, table, q] = sdv.rows.mock.calls[0];
        expect([lg, table]).toEqual(['mbb', 'ncaa_rapm']);
        expect(q).toMatchObject({ season: '2026', estimand: 'league', order: '-off_poss', limit: String(BOARD_CAP) });
    });
    test.each(TEAM_GROUPS)('teams, %s: its table, the season, the cap', async (g) => {
        await retrieveBoard('wnba', 2026, 'teams', g, 5);
        const [lg, table, q, , strict] = sdv.rows.mock.calls[0];
        expect([lg, strict]).toEqual(['wnba', true]);
        expect(table).toBe({ ratings: 'team_season_rates', factors: 'team_season_rates', strength: 'team_strength', flow: 'team_season_flow' }[g]);
        expect(q.season).toBe('2026');
        expect(q.limit).toBe('400');
        expect(q.split).toBe(table === 'team_season_rates' ? 'all' : undefined);
    });
    test('lineups: one unit size over the floor, most possessions first; the pros named from the season players', async () => {
        const r = await retrieveBoard('nba', 2026, 'lineups', 'ratings', 3);
        expect(sdv.rows.mock.calls[0].slice(0, 2)).toEqual(['nba', 'lineup_seasons']);
        expect(sdv.rows.mock.calls[0][2]).toMatchObject({ season: '2026', n_players: '3', poss__gte: String(LINEUP_FLOOR.nba), order: '-poss', limit: String(BOARD_CAP) });
        expect(shots.players).toHaveBeenCalledWith(2026, 'nba');
        const named = FX.nbaNames[0];
        expect(r.names.get(String(named.person_id))).toBe(named.player_name);
    });
    test("college lineups are named from ncaa_rapm's stats.ncaa.org ids, title-cased", async () => {
        const r = await retrieveBoard('mbb', 2026, 'lineups', 'ratings', 5);
        const names = sdv.rows.mock.calls.find((c) => c[1] === 'ncaa_rapm')!;
        expect(names[2]).toMatchObject({ season: '2026', estimand: 'league', select: 'player_id,player', off_poss__gte: String(LINEUP_FLOOR.mbb) });
        expect(shots.players).not.toHaveBeenCalled();
        const ids = FX.mbbLineups.flatMap((u) => [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5]).filter((x) => x != null);
        for (const id of ids) expect(r.names.get(String(id))).toMatch(/^[A-Z][a-z'-]/);
        expect(ncaaName('KEYSHAWN.HALL')).toBe('Keyshawn Hall');
    });
    // the Data API answers a select naming a missing column with a 400: every column asked for is one the producer ships
    // (the per-game and per-75 columns from the 2026-11-13 capture, leaderboards-v2-bases-2026.json.gz)
    test('every select names only columns the real tables have', () => {
        const has = (rows: Row[], select: string) => select.split(',').filter((c) => !(c in rows[0]));
        for (const rates of [BX.nbaRates, BX.wnbaRates, BX.mbbRates, BX.wbbRates, BX.wnbaRates2024]) {
            expect(has(rates, selectFor(boardSpec('teams', 'wnba', 'ratings'), ['team_id'], true))).toEqual([]);
            expect(has(rates, selectFor(boardSpec('teams', 'wnba', 'factors'), ['team_id'], true))).toEqual([]);
        }
        expect(has(FX.wnbaStrength, selectFor(boardSpec('teams', 'wnba', 'strength'), ['team_id'], true))).toEqual([]);
        for (const flow of [BX.wnbaFlow, BX.wnbaFlow2024]) expect(has(flow, selectFor(boardSpec('teams', 'wnba', 'flow'), ['team_id'], true))).toEqual([]);
        expect(has(BX.nbaLineups, selectFor(boardSpec('lineups', 'nba', 'ratings'), ['team_id', 'lineup_id'], true))).toEqual([]);
        expect(has(BX.mbbLineups, selectFor(boardSpec('lineups', 'mbb', 'ratings'), ['team_id', 'lineup_id'], true))).toEqual([]);
        expect(has(FX.nbaImpact, selectFor(boardSpec('impact', 'nba', 'ratings'), ['player_id', 'player_name'], false))).toEqual([]);
        expect(has(FX.mbbImpact, selectFor(boardSpec('impact', 'mbb', 'ratings'), ['player_id', 'player', 'team'], false))).toEqual([]);
    });
});

describe('§4.3 bug 1: an unknown basis never falls through silently', () => {
    const sp = (q: string) => new URLSearchParams(q);
    test('a basis that is not one: the board default, and the page says so', async () => {
        const c = parseControls(sp('board=lineups&basis=per48'), 'nba', () => true);
        expect([c.basis, c.basisFallback]).toEqual(['per100', 'unknown']);
        const { html } = await board('nba', '?season=2026&board=lineups&basis=per48');
        expect(html).toContain('id="lb-basis-fallback"');
        expect(html).toContain('That basis is not one of per game, per 75, per 100 or totals, so it shows per 100 possessions.');
        expect(html).toMatch(/data-basis="per100"/);
        expect(html).toMatch(/<option value="[^"]*basis=totals[^"]*">Totals<\/option>/);
        expect(html).toMatch(/<option value="\/nba\/leaderboards\?season=2026&amp;board=lineups"[^>]*selected[^>]*>Per 100 possessions<\/option>/);
    });
    test('a real basis the board ships no column for (lineups per game): named, never shown as all dashes', async () => {
        const c = parseControls(sp('board=lineups&basis=pergame'), 'nba', () => true);
        expect([c.basis, c.basisFallback]).toEqual(['per100', 'pergame']);
        const { html } = await board('nba', '?season=2026&board=lineups&basis=pergame');
        expect(html).toContain('This board has no per game columns, so it shows per 100 possessions.');
        expect(html).not.toMatch(/<option[^>]*>Per game<\/option>/);
    });
    test('no basis asked: no note', () => expect(parseControls(sp('board=teams'), 'wnba', () => true).basisFallback).toBeNull());
    // every offered basis has a producer column on the board: a select option never leads to a table of dashes
    test.each(BOARDS)('%s: every offered basis resolves to a producer column', (b) => {
        for (const g of TEAM_GROUPS) {
            const spec = boardSpec(b, 'nba', g);
            for (const basis of offeredBases(spec)) expect(spec.cols.some((c) => typeof c.src !== 'string' && srcFor(c, basis) != null) || basis === spec.defaultBasis).toBe(true);
            for (const basis of BASES.filter((x) => !offeredBases(spec).includes(x))) expect(parseControls(sp(`board=${b}&group=${g}&basis=${basis}`), 'nba', () => true).basis).toBe(spec.defaultBasis);
        }
    });
});

describe('§4.3 bug 2: the sort uses the number shown', () => {
    const cases: [BasketballLeague, string, string][] = [
        ['nba', '?season=2026&board=lineups&sort=net', 'net'],
        ['nba', '?season=2026&board=lineups&basis=totals&sort=net', 'net'],
        ['nba', '?season=2026&board=lineups&view=percentiles&sort=def', 'def'],
        ['nba', '?season=2026&board=lineups&sort=def', 'def'],
        ['wnba', '?board=teams&group=flow&sort=kills', 'kills'],
        ['wnba', '?board=teams&group=flow&basis=per100&sort=kills', 'kills'],
        ['wnba', '?board=teams&group=flow&basis=totals&sort=kills', 'kills'],
        ['wnba', '?board=teams&view=percentiles&sort=pace', 'pace'],
        ['nba', '?season=2026&board=impact&sort=war', 'war'],
        ['mbb', '?board=impact&qualified=all', 'rapm'],
    ];
    test.each(cases)('%s %s: the sorted column reads best first', async (lg, query, key) => {
        const { data, html } = await board(lg, query);
        const col = data.spec.cols.find((c) => c.key === key)!;
        const shownNums = cells(html).map((r) => num(r[colIndex(data, key)])).filter((v): v is number => v != null);
        expect(shownNums.length).toBeGreaterThan(5);
        const asc = data.controls.view === 'values' && col.lowerBetter === true;
        const ordered = [...shownNums].sort((a, b) => (asc ? a - b : b - a));
        expect(shownNums).toEqual(ordered);
    });
    test('totals sorts by the shown +/-, not by Net: the two orders differ on the real units', async () => {
        const per100 = (await board('nba', '?season=2026&board=lineups&sort=net')).data.rows!.map((r) => r.lineup_id);
        const totals = (await board('nba', '?season=2026&board=lineups&basis=totals&sort=net')).data.rows!.map((r) => r.lineup_id);
        expect(totals).not.toEqual(per100);
        const col = boardSpec('lineups', 'nba', 'ratings').cols.find((c) => c.key === 'net')!;
        expect(sortRows(FX.nbaLineups, col, 'totals', 'values').map((r) => r.lineup_id)).toEqual(
            [...FX.nbaLineups].sort((a, b) => b.plus_minus - a.plus_minus).map((r) => r.lineup_id));
    });
    test('the percentiles view sorts by the percentile it prints, nulls last', () => {
        const col = boardSpec('teams', 'wnba', 'ratings').cols.find((c) => c.key === 'def')!;
        const out = sortRows(FX.wnbaRates, col, 'per100', 'percentiles');
        expect(out.map((r) => shown(r, col, 'per100', 'percentiles'))).toEqual(FX.wnbaRates.map((r) => r.def_rtg_pct).sort((a, b) => b - a));
    });
});

describe('§4.3 bug 3: a percentile is the shown column’s own', () => {
    test('kills: per game, per 100 and totals each read their own column, rank and percentile', () => {
        const col = boardSpec('teams', 'wnba', 'flow').cols.find((c) => c.key === 'kills')!;
        const r = FX.wnbaFlow[0];
        expect(cellOf(r, col, 'pergame')).toEqual({ src: 'kills_pg', value: r.kills_pg, rank: r.kills_pg_rank, pct: r.kills_pg_pct });
        expect(cellOf(r, col, 'per100')).toEqual({ src: 'kills_per_100', value: r.kills_per_100, rank: r.kills_per_100_rank, pct: r.kills_per_100_pct });
        // the producer ranks no season total: no percentile, never the per-game one
        expect(cellOf(r, col, 'totals')).toEqual({ src: 'kills', value: r.kills, rank: null, pct: null });
        // the real rows rank the per-game and per-100 bases differently, so borrowing one for the other would show
        expect(FX.wnbaFlow.some((x) => x.kills_pg_pct !== x.kills_per_100_pct)).toBe(true);
    });
    test("lineups in totals, percentiles: +/- has none (a dash, unshaded), never Net's; eFG% keeps its own", async () => {
        const { data, html } = await board('nba', '?season=2026&board=lineups&basis=totals&view=percentiles');
        expect(data.controls.view).toBe('percentiles');
        const i = colIndex(data, 'net');
        const rows = cells(html);
        expect(rows.length).toBeGreaterThan(5);
        expect(rows.every((r) => r[i] === '—')).toBe(true);
        const e = colIndex(data, 'efg_pct');
        expect(rows.map((r) => num(r[e]))).toEqual(data.rows!.map((r) => Math.round(Number(r.efg_pct_pct))));
        const tds = [...html.matchAll(/<tr[^>]*>\s*(<td[\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td([^>]*)>/g)][i][1]);
        expect(tds.some((a) => a.includes('hulk-bg-level'))).toBe(false);
    });
    test("per 100: a team's Net cell shows the producer's value and is shaded by its own percentile", async () => {
        const { data, html } = await board('wnba', '?board=teams');
        const aces = FX.wnbaRates.find((r) => r.team_id === 1611661319)!; // Las Vegas 2026: +7.6, rank 4, pct 75
        const row = cells(html).find((r) => r[0] === 'Las Vegas Aces')!;
        expect(row[colIndex(data, 'net')]).toBe('+7.6');
        expect(generateColorRampValue(aces.net_rtg_pct, 100)).toBe('hulk-bg-level-8');
        expect(html).toMatch(/<td class="text-center numeral hulk-bg-level-8" title="Rank 4, percentile 75">\+7\.6<\/td>/);
        const pct = await board('wnba', '?board=teams&view=percentiles');
        expect(cells(pct.html).find((r) => r[0] === 'Las Vegas Aces')![colIndex(data, 'net')]).toBe('75');
    });
});

describe('the boards', () => {
    test('impact: values only (no producer percentiles yet); ?view=percentiles says so', async () => {
        const { data, html } = await board('nba', '?season=2026&board=impact&view=percentiles');
        expect(data.pctAvailable).toBe(false);
        expect(html).not.toContain('id="lb-view"');
        expect(html).toContain('The producer publishes no player percentiles yet, so this board shows values.');
        expect(html).not.toContain('hulk-bg-level');
        expect(html).not.toContain('id="lb-basis"'); // one basis: no select
    });
    test("impact: qualified is the board's possessions gate; all shows everyone read", async () => {
        const q = await board('nba', '?season=2026');
        const all = await board('nba', '?season=2026&qualified=all');
        expect(q.data.rows!.every((r) => Number(r.off_poss) >= IMPACT_QUALIFIED_POSS.nba)).toBe(true);
        expect(all.data.rows!.length).toBe(FX.nbaImpact.length);
        expect(q.data.rows!.length).toBe(FX.nbaImpact.filter((r) => r.off_poss >= IMPACT_QUALIFIED_POSS.nba).length);
        expect(cells(q.html)[0][0]).toMatch(/^\S.* [A-Z]{3}/); // the best RAPM first, with the team
        expect(q.data.rows![0].rapm).toBe(Math.max(...q.data.rows!.map((r) => Number(r.rapm))));
    });
    test("lineups and teams: qualified is the producer's rank", async () => {
        const spec = boardSpec('lineups', 'nba', 'ratings');
        for (const r of FX.nbaLineups) expect(isQualified(r, spec, 'nba')).toBe(r.net_rtg_rank != null);
        const { data, html } = await board('mbb', '?board=lineups');
        expect(data.rows!.length).toBe(FX.mbbLineups.filter((r) => r.net_rtg_rank != null).length);
        expect(html).not.toMatch(/>#\d+/); // every player named
    });
    test("teams, strength and flow: #406's and #410's columns", async () => {
        const st = await board('wnba', '?board=teams&group=strength');
        expect(st.data.spec.cols.map((c) => c.key)).toEqual(['games', 'wins', 'adj_off', 'adj_def', 'adj_net', 'sos', 'sov']);
        const fl = await board('wnba', '?board=teams&group=flow');
        expect(fl.data.spec.cols.map((c) => c.key)).toContain('kills');
        expect(offeredBases(fl.data.spec)).toEqual(['pergame', 'per75', 'per100', 'totals']);
        // the 2026-11-05 capture predates kills_per75: the select offers what the rows carry
        expect(fl.data.controls.bases).toEqual(['pergame', 'per100', 'totals']);
        expect(fl.html).toContain('id="lb-basis"');
    });
    test('a failed read: the unavailable line, never cached', async () => {
        sdv.rows.mockRejectedValue(new Error('500'));
        const { html, A } = await board('wnba', '?board=teams');
        expect(html).toContain('id="lb-unavailable"');
        expect(A.cache.set).toHaveBeenCalledWith(false);
        expect(A.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test('an empty season: the empty line, never cached', async () => {
        sdv.rows.mockResolvedValue([]);
        const { html, A } = await board('wnba', '?board=teams');
        expect(html).toContain('id="lb-empty"');
        expect(A.cache.set).toHaveBeenCalledWith(false);
    });
    test('rows: the season window', async () => {
        const { A } = await board('wnba', '?board=teams');
        expect(A.cache.set).toHaveBeenCalledWith(expect.objectContaining({ maxAge: 21600 }));
    });
    test('views and sort keys are whitelisted', () => {
        const c = parseControls(new URLSearchParams('board=nope&view=nope&sort=<script>&unit=7&group=x'), 'nba', () => true);
        expect([c.board, c.view, c.sort, c.unit, c.group]).toEqual(['impact', 'values', 'rapm', 5, 'ratings']);
        const v: View[] = ['values', 'percentiles'];
        expect(v).toContain(c.view);
        const b: Basis = c.basis;
        expect(BASES).toContain(b);
    });
});

describe('per game and per 75 (#413 Q25): producer columns only, hidden where a season has none', () => {
    /** Serve the 2026-11-13 capture: `<league>:<table>` -> rows. */
    const serveBases = (map: Record<string, Row[]>) => sdv.rows.mockImplementation(async (lg: string, table: string) => {
        const rows = map[`${lg}:${table}`];
        if (!rows) throw new Error(`no capture for ${lg}:${table}`);
        return rows;
    });
    const RATES: [BasketballLeague, Row[]][] = [['nba', BX.nbaRates], ['wnba', BX.wnbaRates], ['mbb', BX.mbbRates], ['wbb', BX.wbbRates]];
    test.each(RATES)('%s team ratings, 2026: every basis offered; each cell is its own producer column, rank and percentile', (lg, rows) => {
        const spec = boardSpec('teams', lg, 'ratings');
        expect(offeredBases(spec, rows)).toEqual(['pergame', 'per75', 'per100', 'totals']);
        const r = rows.find((x) => x.plus_minus_per75_rank != null)!;
        const col = (k: string) => spec.cols.find((c) => c.key === k)!;
        for (const [k, basis, src] of [['off', 'pergame', 'pts_pg'], ['def', 'pergame', 'opp_pts_pg'], ['net', 'pergame', 'plus_minus_pg'],
            ['off', 'per75', 'pts_per75'], ['def', 'per75', 'opp_pts_per75'], ['net', 'per75', 'plus_minus_per75']] as const)
            expect(cellOf(r, col(k), basis)).toEqual({ src, value: r[src], rank: r[`${src}_rank`], pct: r[`${src}_pct`] });
        // the season-total margin is a value with no rank, so it is never shaded
        expect(cellOf(r, col('net'), 'totals')).toEqual({ src: 'plus_minus', value: r.plus_minus, rank: null, pct: null });
        // pace makes per game and per 75 rank differently on the real rows: borrowing one basis's percentile would show
        expect(rows.some((x) => x.pts_pg_pct !== x.pts_per75_pct)).toBe(true);
    });
    test("WNBA per 75: the Net cell is the producer's +/- per 75, shaded by its own percentile, best first", async () => {
        serveBases({ 'wnba:team_season_rates': BX.wnbaRates });
        const { data, html } = await board('wnba', '?board=teams&basis=per75&sort=net');
        expect(data.controls.basis).toBe('per75');
        expect(html).toMatch(/<option value="[^"]*basis=per75[^"]*"[^>]*selected[^>]*>Per 75 possessions<\/option>/);
        const aces = BX.wnbaRates.find((r) => r.team_id === 1611661319)!; // Las Vegas 2026: +5.7 per 75, rank 4, pct 75
        expect(cells(html).find((r) => r[0] === 'Las Vegas Aces')![colIndex(data, 'net')]).toBe('+5.7');
        expect(html).toContain(`<td class="text-center numeral ${generateColorRampValue(aces.plus_minus_per75_pct, 100)}" title="Rank 4, percentile 75">+5.7</td>`);
        expect(data.rows!.map((r) => r.team_id)).toEqual([...BX.wnbaRates].filter((r) => r.net_rtg_rank != null).sort((a, b) => b.plus_minus_per75 - a.plus_minus_per75).map((r) => r.team_id));
        const pg = await board('wnba', '?board=teams&basis=pergame&sort=off');
        expect(cells(pg.html).find((r) => r[0] === 'Las Vegas Aces')![colIndex(pg.data, 'off')]).toBe(aces.pts_pg.toFixed(1));
    });
    test('an older season the producer has not backfilled (WNBA 2024): per game and per 75 hidden, and a link to one says so', async () => {
        serveBases({ 'wnba:team_season_rates': BX.wnbaRates2024, 'wnba:team_season_flow': BX.wnbaFlow2024 });
        expect(offeredBases(boardSpec('teams', 'wnba', 'ratings'), BX.wnbaRates2024)).toEqual(['per100', 'totals']);
        const { data, html } = await board('wnba', '?season=2024&board=teams&basis=per75');
        expect([data.controls.basis, data.controls.basisFallback]).toEqual(['per100', 'per75']);
        expect(html).toContain('Per 75 possessions is not available for this season, so it shows per 100 possessions.');
        expect(html).not.toMatch(/<option[^>]*>Per (game|75 possessions)<\/option>/);
        // game flow keeps per game (kills_pg was always there) and drops per 75
        const fl = await board('wnba', '?season=2024&board=teams&group=flow');
        expect(fl.data.controls.bases).toEqual(['pergame', 'per100', 'totals']);
    });
    test('game-flow kills per 75 read kills_per75 with its own rank and percentile; runs and double kills are a dash', async () => {
        serveBases({ 'wnba:team_season_flow': BX.wnbaFlow });
        const spec = boardSpec('teams', 'wnba', 'flow');
        const r = BX.wnbaFlow[0];
        expect(cellOf(r, spec.cols.find((c) => c.key === 'kills')!, 'per75')).toEqual({ src: 'kills_per75', value: r.kills_per75, rank: r.kills_per75_rank, pct: r.kills_per75_pct });
        const { data, html } = await board('wnba', '?board=teams&group=flow&basis=per75&sort=kills');
        expect(data.controls.bases).toEqual(['pergame', 'per75', 'per100', 'totals']);
        const rows = cells(html);
        expect(rows.length).toBeGreaterThan(5);
        for (const k of ['runs', 'opp_runs', 'double_kills']) expect(rows.every((x) => x[colIndex(data, k)] === '—')).toBe(true);
        const kills = rows.map((x) => num(x[colIndex(data, 'kills')])!);
        expect(kills).toEqual([...kills].sort((a, b) => b - a));
    });
    test.each([['nba', BX.nbaLineups], ['mbb', BX.mbbLineups]] as const)('%s lineups: per 75 offered, never per game; a unit the producer does not rank is unshaded', async (lg, rows) => {
        serveBases({ [`${lg}:lineup_seasons`]: rows, [`${lg}:ncaa_rapm`]: [] });
        shots.players.mockResolvedValue([]);
        expect(offeredBases(boardSpec('lineups', lg, 'ratings'), rows)).toEqual(['per75', 'per100', 'totals']);
        // the real captures cover both: NBA 2026's early-season units are all below the producer's rank gate, MBB's are ranked
        expect(rows.every((r) => (r.plus_minus_per75_rank == null) === (lg === 'nba'))).toBe(true);
        const { data, html } = await board(lg, '?season=2026&board=lineups&basis=per75&qualified=all');
        expect(data.controls.basis).toBe('per75');
        const i = colIndex(data, 'net');
        const shownRows = cells(html);
        const tds = [...html.matchAll(/<tr[^>]*>\s*(<td[\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td([^>]*)>/g)][i][1]);
        expect(shownRows.length).toBe(rows.length);
        data.rows!.forEach((r, k) => {
            expect(shownRows[k][i]).toBe(generateMarginalString(r.plus_minus_per75 as number, 1, 1));
            // shaded only from the unit's own producer percentile; no rank, no percentile, no shade
            const want = r.plus_minus_per75_rank == null ? null : generateColorRampValue(r.plus_minus_per75_pct as number, 100);
            expect(tds[k].match(/hulk-bg-level-\d/)?.[0] ?? null).toBe(want);
        });
    });
});

// #463 Q18: Season vs Current impact on the NBA Impact board, on the 2026-11-13 capture (fixtures/README.md:
// leaderboards-current-impact-2026.json.gz): player_impact's reml_rapm trio beside current_impact at the latest as_of
describe('Season vs Current impact (#463 Q18): two producer reads joined by player id, NBA only', () => {
    const CI = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/leaderboards-current-impact-2026.json.gz', import.meta.url))).toString()) as Record<'seasonRows' | 'latest' | 'currentRows', Row[]>;
    const serveCurrent = (current: Row[] = CI.currentRows, latest: Row[] = CI.latest) => sdv.from.mockImplementation(async (_src: unknown, table: string, q: Record<string, string>) =>
        table === 'player_impact' ? CI.seasonRows : q.select === 'as_of' ? latest : current.filter((r) => r.as_of === q.as_of));
    const byId = new Map(CI.currentRows.map((r) => [r.player_id, r]));

    test('the reads: the season rows, the latest as_of, then that date’s rows; current_impact unselected, so a rank it ships arrives', async () => {
        serveCurrent();
        const r = await retrieveBoard('nba', 2026, 'impact', 'ratings', 5, 'current');
        const calls = sdv.from.mock.calls.map(([src, table, q, ttl, strict]) => [src.schema, table, q, ttl, strict]);
        expect(calls).toHaveLength(3);
        expect(calls[0]).toEqual(['nba', 'player_impact', { season: '2026', off_poss__gte: String(IMPACT_FLOOR.nba), order: '-off_poss', limit: String(BOARD_CAP), season_type: 'Regular Season', select: 'player_id,player_name,team_id,team_abbreviation,teams,gp,off_poss,def_poss,o_reml_rapm,d_reml_rapm,reml_rapm' }, 21600, true]);
        expect(calls[1]).toEqual(['nba', 'current_impact', { season: '2026', select: 'as_of', order: '-as_of', limit: '1' }, 21600, true]);
        expect(calls[2]).toEqual(['nba', 'current_impact', { season: '2026', as_of: '2026-04-07', order: '-off_poss', limit: String(BOARD_CAP) }, 21600, true]);
        // the select names only columns the real player_impact rows have (an unknown one is a 400)
        expect(calls[0][2].select.split(',').filter((c: string) => !(c in CI.seasonRows[0]))).toEqual([]);
        expect(r.asOf).toBe('2026-04-07');
        // nothing computed: each row is the season row, plus the current trio of the same player id, copied
        expect(r.rows).toHaveLength(CI.seasonRows.length);
        const joined = r.rows.filter((x) => x.current_impact != null);
        expect(joined).toHaveLength(CI.seasonRows.filter((x) => byId.has(x.player_id)).length);
        for (const x of r.rows) {
            const c = byId.get(x.player_id as number);
            expect([x.o_current_impact, x.d_current_impact, x.current_impact]).toEqual(c ? [c.o_current_impact, c.d_current_impact, c.current_impact] : [undefined, undefined, undefined]);
            expect(x.off_poss).toBe(CI.seasonRows.find((s) => s.player_id === x.player_id)!.off_poss); // the season's sample, never current_impact's
        }
    });
    test('no current rows for the season yet: no third read, the season rows alone', async () => {
        serveCurrent([], []);
        const r = await retrieveBoard('nba', 2027, 'impact', 'ratings', 5, 'current');
        expect(sdv.from).toHaveBeenCalledTimes(2);
        expect(r.asOf).toBeNull();
        expect(r.rows.every((x) => x.current_impact === undefined)).toBe(true);
    });
    test('the control: NBA only, whitelisted; elsewhere the Impact board is unchanged', () => {
        expect(parseControls(new URLSearchParams('impact=current'), 'nba', () => true).impact).toBe('current');
        for (const lg of ['wnba', 'mbb', 'wbb'] as const) expect(parseControls(new URLSearchParams('impact=current'), lg, () => true).impact).toBe('measures');
        expect(parseControls(new URLSearchParams('impact=<x>'), 'nba', () => true).impact).toBe('measures');
        expect(boardSpec('impact', 'wnba', 'ratings', 'current').cols).toBe(boardSpec('impact', 'wnba', 'ratings').cols);
        expect(boardSpec('impact', 'nba', 'ratings', 'current').cols.map((c) => c.key)).toEqual(['gp', 'off_poss', 'def_poss', 'season_o', 'season_d', 'season', 'current_o', 'current_d', 'current']);
    });
    test('the page: the Columns select, best Current impact first, the producer’s values, the as-of date in the caption', async () => {
        serveCurrent();
        const { data, html } = await board('nba', '?season=2026&impact=current');
        expect(html).toContain('NBA leaderboards: Players: Season vs Current impact');
        expect(html).toMatch(/<select id="lb-impact"[\s\S]*?<option value="[^"]*impact=current[^"]*" selected>Season vs Current<\/option>/);
        expect(html).toContain('Current impact is his expected impact going forward, as of Apr 7, from games before that date.');
        expect(html).toContain('Per 100 possessions.');
        expect(data.controls.sort).toBe('current');
        const top = data.rows![0];
        expect(top.player_name).toBe('Nikola Jokić');
        expect(top.current_impact).toBe(Math.max(...data.rows!.map((r) => Number(r.current_impact ?? -Infinity))));
        const row = cells(html)[0];
        expect(row[colIndex(data, 'current')]).toBe(generateMarginalString(Number(top.current_impact), 1, 1));
        expect(row[colIndex(data, 'season')]).toBe(generateMarginalString(Number(top.reml_rapm), 1, 1));
        // qualified: the board's own possessions gate, as on the other impact view
        expect(data.rows!.every((r) => Number(r.off_poss) >= IMPACT_QUALIFIED_POSS.nba)).toBe(true);
        // neither table ships a rank or percentile today: unshaded, and the caption says so
        expect(html).not.toContain('hulk-bg-level');
        expect(html).toContain('Unshaded: the producer publishes no percentiles for this board yet.');
    });
    test("ranks and shading are the producer's own _rank / _pct once current_impact ships them (copied with the trio)", async () => {
        // the capture's rows plus the two columns the producer would add; nothing else changes
        const ranked = CI.currentRows.map((r, i) => ({ ...r, current_impact_rank: i + 1, current_impact_pct: 99 }));
        serveCurrent(ranked);
        const { data, html } = await board('nba', '?season=2026&impact=current');
        expect(data.pctAvailable).toBe(true);
        const top = data.rows![0];
        const cell = [...html.matchAll(/<tr>\s*(<td[\s\S]*?)<\/tr>/g)][0][1].match(/<td[^>]*>/g)![colIndex(data, 'current')];
        expect(cell).toContain(generateColorRampValue(99, 100));
        expect(cell).toContain(`title="Rank ${top.current_impact_rank}, percentile 99"`);
    });
    test('the season’s current impact not built yet: the season column stays, dashes, and the caption says so', async () => {
        serveCurrent([], []);
        const { data, html } = await board('nba', '?season=2026&impact=current&qualified=all');
        expect(data.rows!.length).toBe(CI.seasonRows.length);
        expect(html).toContain('Current impact is his expected impact going forward, not built for this season yet.');
        expect(cells(html)[0][colIndex(data, 'current')]).toBe('—');
    });
    test('WNBA and college: no Columns select on the Impact board', async () => {
        const { html } = await board('mbb', '?impact=current');
        expect(html).not.toContain('id="lb-impact"');
        expect(html).not.toContain('Season vs Current');
    });
});
