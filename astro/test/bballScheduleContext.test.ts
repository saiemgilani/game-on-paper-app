// BB-G53: schedule context and rotation behind 'bball-schedule-context', on real Data API reads (fixtures/README.md:
// schedule-context-*.json.gz on top of game-set-*.json.gz). The joins are checked against the data itself: the line's home
// margin is the schedule's final score, the producer's ATS result agrees with the team's margin plus its spread (so a home /
// away flip fails), every opponent maps to a strength row, and each game's box minutes add up to five players for the game.
// Every read is mocked and fetch throws.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './nba/rows';

vi.stubGlobal('fetch', (input: unknown) => { throw new Error(`unmocked fetch: ${String(input)}`); });
afterAll(() => { vi.unstubAllGlobals(); });

const capture = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const NETS_BLOCK = capture('game-set-nba-2026'); // Brooklyn Nets 2025-26 (stats 1610612751, ESPN 17)
const DUKE_BLOCK = capture('game-set-mbb-2026'); // Duke 2025-26 (ESPN 150)
const NETS_CTX = capture('schedule-context-nba-2026');
const DUKE_CTX = capture('schedule-context-mbb-2026');
// Q21: the Nets' rated pregame projections, sdv-py's nba_pregame_projections(2026) (the rated_priors table sdv-db will serve)
const NETS_PROJ = capture('schedule-context-proj-nba-2026');
const asReads = (c: any) => ({ rates: c.rates, strength: c.strength[0] ?? null, games: [...c.home, ...c.away], gameRates: c.gameRates });
const NETS = 1610612751, NETS_ESPN = 17, DUKE = 150;

const sdv = vi.hoisted(() => ({ calls: [] as string[], fail: new Set<string>() }));
vi.mock('../src/resources/sdv', async (orig) => {
    const real = await orig<typeof import('../src/resources/sdv')>();
    return { ...real, retrieveRowsFrom: async (src: { schema: string }, table: string, q: Record<string, string>, ...rest: unknown[]) => {
        const key = `${src.schema}.${table}`;
        const rows: Record<string, any> = {
            'nba.game_lines': NETS_CTX.lines,
            'nba_stats.team_strength': NETS_CTX.strength,
            'nba.player_box': q.team_id === String(NETS_ESPN) && q.season_type === '2' && NETS_CTX.box,
            'mbb.game_lines': DUKE_CTX.lines,
            'mbb.team_strength': DUKE_CTX.strength,
            'mbb.player_box': q.team_id === String(DUKE) && q.season_type === undefined && DUKE_CTX.box,
            'nba.rated_priors': NETS_PROJ.proj,
            // not served yet for college in this capture: the API's 404 for an unknown table
            'mbb.rated_priors': 'missing',
        };
        if (!(key in rows)) return (real.retrieveRowsFrom as any)(src, table, q, ...rest); // the page's own reads: fetch throws
        sdv.calls.push(key);
        if (q.season !== '2026') throw new Error(`unfiltered ${key}`);
        if (sdv.fail.has(key)) throw new Error(`503 ${key}`);
        if (!rows[key]) throw new Error(`unexpected ${key} ${JSON.stringify(q)}`);
        if (rows[key] === 'missing') throw new real.SDVRequestError(404, key, `{"detail":"unknown table ${key}"}`);
        return rows[key];
    } };
});
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
}));

import BbTeamRotation from '../src/components/nba/BbTeamRotation.astro';
import TeamSeasonBlock from '../src/components/nba/TeamSeasonBlock.astro';
import { retrieveScheduleContext } from '../src/resources/bballScheduleContext';
import { prepareNbaTeam } from '../src/routes/nba/team';
import { REST_CAP, atsRecord, b2bRecord, rotation, scheduleContext, teamAts, teamProj } from '../src/utils/bballScheduleContext';
import { FLAGS } from '../src/utils/features';
import { scheduleRows } from '../src/utils/teamSeason';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { sdv.calls.length = 0; sdv.fail.clear(); block.fn.mockReset(); block.fn.mockResolvedValue(asReads(NETS_BLOCK)); });

const ET = 'America/New_York';
const sched = (c: any, espnId: number) => scheduleRows(asReads(c).games, c.gameRates, espnId);
const listed = (c: any, espnId: number) => new Map<string, boolean>(asReads(c).games.map((g: any) => [String(g.id), Number(g.home_id) === espnId]));
// the oracle day: the tip's Eastern calendar date through Intl (independent of the module's luxon)
const etDay = (iso: string) => Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date(iso))) / 86_400_000;

describe('teamAts', () => {
    test("the producer's home/away result becomes the team's side; the listed home team keeps it on a neutral site", () => {
        const line = { game_id: 1, spread_home_close: -4.5, ats_result: 'away' as const };
        expect(teamAts(line, true)).toEqual({ spread: -4.5, ats: 'L' });
        expect(teamAts(line, false)).toEqual({ spread: 4.5, ats: 'W' });
        expect(teamAts({ ...line, ats_result: 'push' }, false).ats).toBe('P');
        expect(teamAts({ ...line, spread_home_close: 0, ats_result: null }, false)).toEqual({ spread: 0, ats: null });
        expect(teamAts(undefined, true)).toEqual({ spread: null, ats: null });
    });
});

describe('teamProj (Q21)', () => {
    test("the producer's home margin becomes the team's side; a final's result against it is W / L / P", () => {
        const final = { completed: true, teamScore: 100, oppScore: 95 };
        expect(teamProj(3.5, true, final)).toEqual({ proj: 3.5, vsProj: 'W' });
        expect(teamProj(3.5, false, final)).toEqual({ proj: -3.5, vsProj: 'W' });
        expect(teamProj(-7, false, final)).toEqual({ proj: 7, vsProj: 'L' });
        expect(teamProj(5, true, final).vsProj).toBe('P');
        expect(teamProj(5, true, { completed: false, teamScore: null, oppScore: null })).toEqual({ proj: 5, vsProj: null });
        expect(teamProj(undefined, true, final)).toEqual({ proj: null, vsProj: null });
    });
});

describe('the projection, real rows (Nets 2025-26)', () => {
    const rows = sched(NETS_BLOCK, NETS_ESPN);
    test("every rated final gets a result against the projection, recounted from the producer's rows", async () => {
        const r = await retrieveScheduleContext('nba', 2026, NETS_ESPN);
        // the opener has no rating yet: its exp_home_margin is null, so no projection
        expect(r.proj!.size).toBe(NETS_PROJ.proj.filter((p: any) => p.exp_home_margin !== null).length);
        const ctx = scheduleContext(rows, listed(NETS_BLOCK, NETS_ESPN), r, ET);
        const home = listed(NETS_BLOCK, NETS_ESPN);
        const want = { w: 0, l: 0, p: 0 };
        for (const g of rows) {
            const raw = NETS_PROJ.proj.find((p: any) => String(p.game_id) === g.gameId);
            const k = ctx.get(g.gameId)!;
            if (raw?.exp_home_margin == null) { expect([k.proj, k.vsProj]).toEqual([null, null]); continue; }
            const proj = home.get(g.gameId) ? raw.exp_home_margin : -raw.exp_home_margin;
            expect(k.proj).toBeCloseTo(proj, 9);
            const d = g.teamScore! - g.oppScore! - proj;
            want[d > 0 ? 'w' : d < 0 ? 'l' : 'p']++;
        }
        expect(atsRecord(ctx.values(), 'vsProj')).toEqual(want);
        expect(want.w + want.l + want.p).toBe(rows.length - 1);
    });
    test('the table not served yet (404) is no projection, not a failure: no column and the page stays cacheable', async () => {
        const r = await retrieveScheduleContext('mbb', 2026, DUKE);
        expect(r.proj!.size).toBe(0);
        const html = await render(TeamSeasonBlock, { data: asReads(DUKE_BLOCK), season: 2026, espnId: DUKE, teamName: 'Duke', context: r }, 'mbb', `/mbb/team/${DUKE}`);
        expect(html).not.toContain('>Proj</th>');
        expect(html).not.toContain('Against our projection');
    });
});

for (const [lg, c, x, espnId, regulation] of [['nba', NETS_BLOCK, NETS_CTX, NETS_ESPN, 240], ['mbb', DUKE_BLOCK, DUKE_CTX, DUKE, 200]] as const) {
    describe(`${lg}, real reads`, () => {
        const rows = sched(c, espnId);
        const reads = () => retrieveScheduleContext(lg, 2026, espnId);
        test('rest, back-to-backs and three in four from the tip days; trips are runs away from home', async () => {
            const ctx = scheduleContext(rows, listed(c, espnId), await reads(), ET);
            expect(ctx.size).toBe(rows.length);
            rows.forEach((g, i) => {
                const k = ctx.get(g.gameId)!;
                const gap = i === 0 ? Infinity : etDay(g.date) - etDay(rows[i - 1].date) - 1;
                expect(k.rest).toBe(Math.min(Math.max(gap, 0), REST_CAP));
                expect(k.b2b).toBe(gap === 0);
                expect(k.threeInFour).toBe(i > 1 && etDay(g.date) - etDay(rows[i - 2].date) <= 3);
                expect(k.trip === null).toBe(g.venue === 'home');
                if (k.trip && k.trip.game > 1) expect(ctx.get(rows[i - 1].gameId)!.trip).toEqual({ game: k.trip.game - 1, of: k.trip.of });
            });
            const b2b = b2bRecord(rows, ctx);
            // sdv-py BB-D23 counts 13-17 back-to-backs per NBA team in 2025-26; college plays few or none
            if (lg === 'nba') expect(b2b.games).toBeGreaterThanOrEqual(13), expect(b2b.games).toBeLessThanOrEqual(17);
            expect(b2b.w + b2b.l).toBe(b2b.games); // every 2025-26 game is final
        });
        test("the line joins the right game and the producer's ATS result agrees with the team's margin plus its spread", async () => {
            const r = await reads();
            const ctx = scheduleContext(rows, listed(c, espnId), r, ET);
            const home = listed(c, espnId);
            let checked = 0;
            for (const g of rows) {
                const line = x.lines.find((l: any) => String(l.game_id) === g.gameId);
                const k = ctx.get(g.gameId)!;
                if (!line || g.teamScore === null) continue;
                const margin = g.teamScore - g.oppScore!;
                expect(line.home_margin).toBe(home.get(g.gameId) ? margin : -margin);
                const cover = margin + k.spread!;
                expect(k.ats).toBe(cover > 0 ? 'W' : cover < 0 ? 'L' : 'P');
                checked++;
            }
            expect(checked).toBe(rows.length);
            const rec = atsRecord(ctx.values());
            expect(rec.w + rec.l + rec.p).toBe(checked);
        });
        test('every opponent has a strength row, ranked within the league', async () => {
            const r = await reads();
            const ctx = scheduleContext(rows, listed(c, espnId), r, ET);
            for (const g of rows) {
                const opp = ctx.get(g.gameId)!.opp;
                if (lg === 'mbb' && !opp) continue; // a non-Division I opponent has no row
                expect(opp?.rank).toBeGreaterThanOrEqual(1);
                expect(opp!.rank).toBeLessThanOrEqual(x.strength.length);
            }
            if (lg === 'nba') expect(r.strength!.size).toBe(30);
        });
        test("rotation: each game's minutes add to five players for the game, five starts a game, depth by minutes", async () => {
            const rot = rotation(rows, (await reads()).box!);
            expect(rot.games).toHaveLength(rows.filter((g) => g.completed).length);
            rot.games.forEach((g, k) => {
                const sum = rot.players.reduce((a, p) => a + (p.minutes[k] ?? 0), 0);
                const extra = sum - regulation;
                // ESPN's minutes are whole numbers per player: within a few of 5 x (regulation + 5 per overtime)
                expect(Math.abs(extra - 25 * Math.round(extra / 25))).toBeLessThanOrEqual(5);
                expect(rot.players.filter((p) => p.started[k])).toHaveLength(5);
            });
            expect(rot.players.reduce((a, p) => a + p.gs, 0)).toBe(5 * rot.games.length);
            for (let i = 1; i < rot.players.length; i++) expect(rot.players[i - 1].mpg * rot.players[i - 1].gp).toBeGreaterThanOrEqual(rot.players[i].mpg * rot.players[i].gp);
            expect(rot.five!.names).toHaveLength(5);
            expect(rot.five!.starts).toBeLessThanOrEqual(rot.games.length);
        });
    });
}

const fakeAstro = (path: string, id: string, locals: Record<string, unknown>) => {
    const cache = { set: vi.fn() };
    return { astro: { params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals, cache, response: { headers: new Headers() } } as any, cache };
};
const ok = <T,>(r: T) => { if (r && typeof r === 'object' && ('notFound' in r || 'unavailable' in r)) throw new Error(JSON.stringify(r)); return r as Exclude<T, { notFound: true } | { unavailable: true }>; };
const TEAM = `/nba/team/${NETS}?season=2026`;
const LOGS_OFF = { 'bball-game-logs': false, 'bball-game-set': false };

describe('the flag', () => {
    test("'bball-schedule-context' is a preview flag", () => { expect(FLAGS['bball-schedule-context']).toBe('preview'); });
    test('off: none of the three reads, no key', async () => {
        const r = ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS), { preview: true, flagOverrides: { ...LOGS_OFF, 'bball-schedule-context': false } }).astro));
        expect(sdv.calls).toEqual([]);
        expect('scheduleContext' in r).toBe(false);
    });
    test("on but 'bball-team-season' off, or a block with no schedule: no read", async () => {
        ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS), { preview: true, flagOverrides: { ...LOGS_OFF, 'bball-team-season': false } }).astro));
        block.fn.mockResolvedValue({ rates: [], strength: null, games: [], gameRates: [] });
        ok(await prepareNbaTeam(fakeAstro(TEAM, String(NETS), { preview: true, flagOverrides: LOGS_OFF }).astro));
        expect(sdv.calls).toEqual([]);
    });
    test('on: the four reads, by the ESPN id and season; a failed one is null and the page is not cached', async () => {
        const on = fakeAstro(TEAM, String(NETS), { preview: true, flagOverrides: LOGS_OFF });
        const r = ok(await prepareNbaTeam(on.astro));
        expect(sdv.calls.sort()).toEqual(['nba.game_lines', 'nba.player_box', 'nba.rated_priors', 'nba_stats.team_strength']);
        expect(r.scheduleContext!.lines!.size).toBe(NETS_CTX.lines.length);
        expect(on.cache.set.mock.calls.map((c) => c[0])).not.toContain(false);
        sdv.fail.add('nba.game_lines');
        const failed = fakeAstro(TEAM, String(NETS), { preview: true, flagOverrides: LOGS_OFF });
        const f = ok(await prepareNbaTeam(failed.astro));
        expect(f.scheduleContext!.lines).toBeNull();
        expect(f.scheduleContext!.box!.length).toBe(NETS_CTX.box.length);
        expect(failed.cache.set.mock.calls.at(-1)![0]).toBe(false);
        expect(failed.astro.response.headers.get('Cache-Control')).toBe('no-store');
    });
});

const render = (C: any, props: Record<string, unknown>, league: string, path: string) =>
    container.renderToString(C, { props, request: new Request(`https://gameonpaper.com${path}`), locals: { league } as App.Locals });

describe('rendering', () => {
    test('the schedule gains rest, trip, opponent, line and ATS columns and the records line; without context it is unchanged', async () => {
        const props = { data: asReads(NETS_BLOCK), season: 2026, espnId: NETS_ESPN, teamName: 'Brooklyn Nets' };
        const plain = await render(TeamSeasonBlock, props, 'nba', `/nba/team/${NETS}`);
        const html = await render(TeamSeasonBlock, { ...props, context: await retrieveScheduleContext('nba', 2026, NETS_ESPN) }, 'nba', `/nba/team/${NETS}`);
        for (const h of ['Rest', 'Trip', 'Opp', 'Line', 'ATS']) expect(html).toContain(`>${h}</th>`);
        for (const h of ['>Rest</th>', '>ATS</th>', 'season-schedule-context']) expect(plain).not.toContain(h);
        expect(html).toContain('id="season-schedule-context"');
        expect(html).toMatch(/ATS <span class="fw-bold">\d+-\d+/);
        expect(html).toContain('title="Second night of a back-to-back">B2B<');
        // Q21: the projection and the result against it, and the W-L against it on the records line
        for (const h of ['Proj', 'vs Proj']) expect(html).toContain(`>${h}</th>`);
        const vp = atsRecord(scheduleContext(sched(NETS_BLOCK, NETS_ESPN), listed(NETS_BLOCK, NETS_ESPN), await retrieveScheduleContext('nba', 2026, NETS_ESPN), ET).values(), 'vsProj');
        expect(html).toContain(`Against our projection <span class="fw-bold" id="season-schedule-vs-proj">${vp.w}-${vp.l}`);
    });
    test('with the game log on (Q19 on GOP#443), the context columns stay and the per-game rates go', async () => {
        const props = { data: asReads(NETS_BLOCK), season: 2026, espnId: NETS_ESPN, teamName: 'Brooklyn Nets', context: await retrieveScheduleContext('nba', 2026, NETS_ESPN) };
        const html = (await render(TeamSeasonBlock, { ...props, logged: true }, 'nba', `/nba/team/${NETS}`)).split('id="season-schedule"')[1];
        for (const h of ['Rest', 'Trip', 'Opp', 'Line', 'ATS', 'Proj', 'vs Proj']) expect(html).toContain(`>${h}</th>`);
        for (const h of ['ORtg', 'eFG%', 'FT rate']) expect(html).not.toContain(`>${h}</th>`);
        // every body row has one cell per header
        const head = html.split('</thead>')[0].match(/<th /g)!.length;
        for (const tr of html.split('<tbody>')[1].split('</tbody>')[0].split('</tr>').slice(0, -1)) expect(tr.match(/<td /g)!.length).toBe(head);
    });
    test('no line for any game (a season the odds data does not map): the line columns and the ATS record are left out', async () => {
        const ctx = { ...(await retrieveScheduleContext('nba', 2026, NETS_ESPN)), lines: new Map() };
        const html = await render(TeamSeasonBlock, { data: asReads(NETS_BLOCK), season: 2026, espnId: NETS_ESPN, teamName: 'Brooklyn Nets', context: ctx }, 'nba', `/nba/team/${NETS}`);
        expect(html).toContain('>Rest</th>');
        expect(html).not.toContain('>Line</th>');
        expect(html).not.toMatch(/ATS <span/);
    });
    test('rotation, college: one row per player who played, a cell per final game; a failed box read says so', async () => {
        const box = (await retrieveScheduleContext('mbb', 2026, DUKE)).box;
        const html = await render(BbTeamRotation, { data: asReads(DUKE_BLOCK), box, season: 2026, espnId: DUKE }, 'mbb', `/mbb/team/${DUKE}`);
        const rot = rotation(sched(DUKE_BLOCK, DUKE), box!);
        expect(html.match(/<tr data-athlete=/g)).toHaveLength(rot.players.length);
        expect(html.match(/<span style="display:inline-block/g)).toHaveLength(rot.players.length * rot.games.length);
        expect(html).toContain('id="rotation-five"');
        expect(html).toContain('full shade at 40');
        const failed = await render(BbTeamRotation, { data: asReads(DUKE_BLOCK), box: null, season: 2026, espnId: DUKE }, 'mbb', `/mbb/team/${DUKE}`);
        expect(failed).toContain('id="rotation-unavailable"');
    });
});
