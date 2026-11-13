// BB-G30: /nba/cup. The pure steps (the groups in tiebreak order, the wild-card race, the knockout, the odds order), the
// page-side step (the snapshot pick, a failed or empty read as the empty state) and the template, on real sdv-py
// producer output: sdv-db #188's season_products fixture nba_cup_sim(2027, as_of_date=2026-11-03), with
// nba_cup_standings run offline on the same 2026-27 Cup schedule to the same day (sdv-db's own test setup; it equals
// the live call). The Data API routes serve these frames as is (sdv-db season_products.write_snapshot).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const rows = vi.hoisted(() => ({ fn: (_table: string, _q: Record<string, string>): unknown[] => [] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveRows: vi.fn(async (_league: string, table: string, q: Record<string, string>) => rows.fn(table, q)),
}));

import NbaCupRoute from '../src/components/routes/NbaCupRoute.astro';
import PlayoffPictureRoute from '../src/components/routes/PlayoffPictureRoute.astro';
import Header from '../src/components/Header.astro';
import { prepareNbaCup, type NbaCupParams } from '../src/routes/basketball/nbaCup';
import type { CupSnapshot } from '../src/resources/nbaCup';
import { SDVRequestError } from '../src/resources/sdv';
import type { Snapshot } from '../src/utils/bracketology';
import { cupBracket, groupTables, isCupWindow, joinCup, oddsOrder, wildCardRace, type CupTeam } from '../src/utils/nbaCup';
import { FLAGS } from '../src/utils/features';

const fixture = (): CupSnapshot & { snapshot: Snapshot } =>
    JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/nba-cup-2027.json.gz', import.meta.url))).toString());
const teams = () => { const f = fixture(); return joinCup(f.sims, f.standings); };
const ids = (ts: CupTeam[]) => ts.map((t) => t.sim.team_id);

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
beforeEach(() => { rows.fn = () => []; });

describe('the fixture', () => {
    test('one day, 30 teams in both tables, the same Group Play records', () => {
        const f = fixture();
        expect(f.sims).toHaveLength(30);
        expect(f.standings).toHaveLength(30);
        for (const t of teams()) {
            expect(t.standing).not.toBeNull();
            expect([t.standing!.wins, t.standing!.losses, t.standing!.cup_group]).toEqual([t.sim.wins, t.sim.losses, t.sim.cup_group]);
        }
    });
});

describe('groupTables', () => {
    test('six groups, East A-C then West A-C, each 1-5 by the Cup tiebreak rank', () => {
        const g = groupTables(teams());
        expect(g.map((x) => x.name)).toEqual(['East Group A', 'East Group B', 'East Group C', 'West Group A', 'West Group B', 'West Group C']);
        for (const x of g) expect(x.rows.map((r) => r.standing!.group_rank)).toEqual([1, 2, 3, 4, 5]);
        // West Group B: three 0-0 teams split by last season's record (OKC .780, Phoenix .317, Utah .305)
        const westB = g[4].rows;
        expect(ids(westB.slice(1, 4))).toEqual([1610612760, 1610612740, 1610612763]);
        expect(westB.slice(1, 4).every((r) => r.standing!.tiebreak === 'prior_record')).toBe(true);
    });
    test('a day without standings orders each group by the mean simulated rank', () => {
        const [eastA] = groupTables(joinCup(fixture().sims, []));
        const means = eastA.rows.map((r) => r.sim.mean_group_rank!);
        expect(means).toEqual([...means].sort((a, b) => a - b));
    });
});

describe('wildCardRace', () => {
    test('each conference: the 12 non-leaders by conference rank, the runners-up first, one wild-card holder', () => {
        const [east, west] = wildCardRace(teams());
        expect([east.name, west.name]).toEqual(['East', 'West']);
        for (const c of [east, west]) {
            expect(c.rows.map((r) => r.standing!.conference_rank)).toEqual(Array.from({ length: 12 }, (_, i) => i + 4));
            expect(c.rows.slice(0, 3).every((r) => r.standing!.group_rank === 2)).toBe(true);
            expect(c.rows.filter((r) => r.standing!.holds_wild_card)).toEqual([c.rows[0]]);
        }
        expect(east.rows[0].sim.team_id).toBe(1610612738); // Boston, 1-0 +14
        expect(west.rows[0].sim.team_id).toBe(1610612742); // Dallas, 1-0 +5
    });
    test('no standings: an empty race, not an invented order', () => {
        expect(wildCardRace(joinCup(fixture().sims, [])).map((c) => c.rows)).toEqual([[], []]);
    });
});

describe('cupBracket', () => {
    test("the current table's quarterfinals, 1 v 4 and 2 v 3 per conference, later rounds still labelled", () => {
        const b = cupBracket(teams())!;
        expect(b.rounds.map((r) => r.name)).toEqual(['Quarterfinals', 'Semifinals', 'Championship']);
        // each round's number: the chance to reach the next one
        expect(b.rounds.map((r) => r.next)).toEqual(['p_semifinal', 'p_final', 'p_champion']);
        const seat = (u: (typeof b.rounds)[number]['games'][number][number]) => ('team' in u ? [u.seed, u.team.sim.team_id] : u.label);
        expect(b.rounds[0].games.map((g) => g.map(seat))).toEqual([
            [[1, 1610612748], [4, 1610612738]], [[2, 1610612765], [3, 1610612764]],
            [[1, 1610612750], [4, 1610612742]], [[2, 1610612744], [3, 1610612743]],
        ]);
        expect(b.rounds[1].games.map((g) => g.map(seat))).toEqual([['East 1-4 winner', 'East 2-3 winner'], ['West 1-4 winner', 'West 2-3 winner']]);
        expect(b.rounds[2].games.map((g) => g.map(seat))).toEqual([['East winner', 'West winner']]);
        expect(b.champion).toBeNull();
    });
    test('a round the sim has decided (p 1) seats its team; the final day names the champion', () => {
        const ts = teams();
        const set = (id: number, p: Partial<CupTeam['sim']>) => Object.assign(ts.find((t) => t.sim.team_id === id)!.sim, p);
        set(1610612738, { p_semifinal: 1, p_final: 1, p_champion: 1 }); // Boston: through from 4
        set(1610612743, { p_semifinal: 1 }); // Denver
        const b = cupBracket(ts)!;
        const [east, west] = b.rounds[1].games;
        expect('team' in east[0] && [east[0].seed, east[0].team.sim.team_id]).toEqual([4, 1610612738]);
        expect(east[1]).toEqual({ label: 'East 2-3 winner' });
        expect('team' in west[1] && west[1].team.sim.team_id).toBe(1610612743);
        expect('team' in b.rounds[2].games[0][0] && b.rounds[2].games[0][0].team.sim.team_id).toBe(1610612738);
        expect(b.rounds[2].games[0][1]).toEqual({ label: 'West winner' });
        expect(b.champion?.sim.team_id).toBe(1610612738);
    });
    test('null when a conference does not seat knockout seeds 1-4 exactly once', () => {
        const ts = teams();
        ts.find((t) => t.standing!.knockout_seed === 4 && t.sim.conference === 'West')!.standing!.knockout_seed = null;
        expect(cupBracket(ts)).toBeNull();
        expect(cupBracket(joinCup(fixture().sims, []))).toBeNull();
    });
});

describe('oddsOrder', () => {
    test('all 30 by title chance, Detroit first', () => {
        const o = oddsOrder(teams());
        expect(o).toHaveLength(30);
        expect(o[0].sim.team_id).toBe(1610612765);
        const p = o.map((t) => t.sim.p_champion);
        expect(p).toEqual([...p].sort((a, b) => b - a));
    });
});

const astroFor = (url: string) => ({ url: new URL(url), locals: {} as App.Locals, response: { headers: new Headers() } }) as any;

describe('prepareNbaCup', () => {
    const f = fixture();
    const live = (table: string, q: Record<string, string>) => {
        if (q.limit === '1') return q.season == null || q.season === '2027' ? [f.snapshot] : [];
        expect(q).toMatchObject({ season: '2027', as_of_date: '2026-11-03' });
        return table === 'cup_sims' ? f.sims : f.standings;
    };
    test("the current season's latest day; the view from the query; cached for the season window", async () => {
        rows.fn = live;
        const A = astroFor('https://gameonpaper.com/nba/cup?view=odds');
        const r = await prepareNbaCup(A, new Date('2026-11-04T12:00:00Z'));
        expect(r).toMatchObject({ seasons: [2027], current: 2027, failed: false, view: 'odds', pick: { snapshot: f.snapshot, season: 2027, fallback: false } });
        expect(r.data!.sims).toHaveLength(30);
        expect(A.locals.league).toBe('nba');
        expect(A.response.headers.get('Cache-Control')).toBeNull();
    });
    test('a 500 from the routes (not deployed) is the unavailable state, uncached, never a throw', async () => {
        rows.fn = () => { throw new SDVRequestError(500, 'cup_sims', 'Internal Server Error'); };
        const A = astroFor('https://gameonpaper.com/nba/cup');
        const r = await prepareNbaCup(A, new Date('2026-11-04T12:00:00Z'));
        expect(r).toMatchObject({ failed: true, data: null, pick: { snapshot: null, season: 2027 }, view: 'groups' });
        expect(A.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test('outside the Cup window (no rows): the empty state, uncached', async () => {
        const A = astroFor('https://gameonpaper.com/nba/cup?view=nope');
        const r = await prepareNbaCup(A, new Date('2026-10-01T12:00:00Z'));
        expect(r).toMatchObject({ failed: false, data: null, pick: { snapshot: null, season: 2027, fallback: false }, view: 'groups' });
        expect(A.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test('a picked day with no sim rows is the empty state, not an "As of" line over no tables', async () => {
        rows.fn = (_table, q) => (q.limit === '1' ? [f.snapshot] : []);
        const A = astroFor('https://gameonpaper.com/nba/cup');
        const r = await prepareNbaCup(A, new Date('2026-11-04T12:00:00Z'));
        expect(r).toMatchObject({ failed: false, data: null, pick: { snapshot: null, season: 2027, fallback: false } });
        expect(A.response.headers.get('Cache-Control')).toBe('no-store');
    });
    test("next August: 2027-28 has no Cup yet, so 2026-27's last day, flagged as a fallback", async () => {
        rows.fn = live;
        const r = await prepareNbaCup(astroFor('https://gameonpaper.com/nba/cup'), new Date('2027-08-02T12:00:00Z'));
        expect(r).toMatchObject({ seasons: [2027, 2028], current: 2028, pick: { snapshot: f.snapshot, season: 2027, fallback: true } });
    });
});

const params = (over: Partial<NbaCupParams> = {}): NbaCupParams => {
    const f = fixture();
    return { seasons: [2027], current: 2027, view: 'groups', failed: false, pick: { snapshot: f.snapshot, season: 2027, fallback: false }, data: { sims: f.sims, standings: f.standings }, ...over };
};
const render = (p: NbaCupParams) => container.renderToString(NbaCupRoute, { props: { data: p }, locals: { league: 'nba', preview: true } as App.Locals });
const cellsOf = (row: string) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

describe('NbaCupRoute', () => {
    test('groups: a table per conference, six groups in rank order, the tiebreak named, ESPN logos and team links', async () => {
        const html = await render(params());
        expect(html).toContain('NBA Cup Groups, Wild Cards and Knockout, 2026-27');
        expect(html).toContain('As of November 3, 2026: Group Play games before that day count. 10,000 simulated Cups.');
        for (const t of ['Eastern Conference', 'Western Conference', 'Point differential', "Last season&#39;s record"]) expect(html).toContain(t);
        // one table per conference, each group a heading row over its five teams, so the columns line up
        expect(html.match(/<table/g)).toHaveLength(2);
        expect([...html.matchAll(/gt_group_heading fw-bold">([^<]+)</g)].map((m) => m[1])).toEqual(['Group A', 'Group B', 'Group C', 'Group A', 'Group B', 'Group C']);
        // Detroit (stats 1610612765) is ESPN 8: its logo, its stats-id team page and its dark logo by abbreviation
        expect(html).toContain('src="https://a.espncdn.com/i/teamlogos/nba/500/8.png"');
        expect(html).toContain('href="/nba/team/1610612765"');
        expect(html).toContain('nba/500-dark/det.png');
        expect(html).not.toMatch(/nba\/500-dark\/\d+\.png/);
        expect(html).not.toMatch(/hulk-bg-level-[0-5]\b/); // probabilities are green only
        const first = cellsOf(html.split('<tbody>')[1].split('</tr>')[1]);
        expect(first).toEqual(['1DETDetroit Pistons', '1-0', '3', '+16', '110', 'Point differential', '2', '62%', '16%', '78%']);
        expect(html).not.toContain('NaN');
        expect(html).not.toContain('undefined');
        // only one season holds Cup snapshots: no season select
        expect(html).not.toContain('id="cup-season"');
        expect(html).toContain('<option value="/nba/cup?view=odds">Odds</option>');
    });
    test('the wild-card race: runners-up first, the holder marked in each conference', async () => {
        const html = await render(params({ view: 'wildcard' }));
        // bg-secondary, not text-bg-secondary: the vendored Bootstrap has no text-bg-* (white on the white sticky column)
        expect(html.match(/<span class="badge bg-secondary ms-1"[^>]*>WC<\/span>/g)).toHaveLength(2);
        expect(html.match(/Group runners-up/g)).toHaveLength(2);
        const east = html.split('Western Conference')[0];
        const firstTeam = cellsOf(east.split('<tbody>')[1].split('</tr>')[1])[0];
        expect(firstTeam).toBe('4BOSBoston CelticsWC');
    });
    test('the knockout on the bracket component: three rounds, labelled later slots, no champion yet', async () => {
        const html = await render(params({ view: 'bracket' }));
        const graphic = html.split('playoff-bracket d-none')[1].split('bracket-table')[0];
        expect([...graphic.matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['Quarterfinals', 'Semifinals', 'Championship']);
        expect(graphic).toContain('--bracket-rounds: 3');
        expect(graphic.match(/table-bordered/g)).toHaveLength(4 + 2 + 1);
        for (const l of ['East 1-4 winner', 'West 2-3 winner', 'East winner', 'West winner']) expect(graphic).toContain(l);
        expect(graphic).not.toContain('Champion<');
        // a quarterfinal slot is the chance to reach the semifinals: Detroit's p_semifinal .52, not its 18% title chance
        expect(graphic).toMatch(/title="Chance to reach the semifinals"[^>]*>52%</);
        expect(graphic).not.toContain('title="Chance to win the Cup"');
        expect(html).toContain("Each number is the team's chance to reach the next round");
        expect(html).not.toContain('NaN');
    });
    test('a seated later slot is its chance to reach the next round: the final from a semifinal, the Cup from the final', async () => {
        const p = params({ view: 'bracket' });
        const sim = (id: number) => p.data!.sims.find((s) => s.team_id === id)!;
        Object.assign(sim(1610612738), { p_semifinal: 1, p_final: 1, p_champion: 0.6 }); // Boston: through to the final
        Object.assign(sim(1610612743), { p_semifinal: 1, p_final: 0.45 }); // Denver: through to a semifinal
        const html = await render(p);
        const graphic = html.split('playoff-bracket d-none')[1].split('bracket-table')[0];
        const [qf, sf, fin] = graphic.split('bracket-round-name').slice(1);
        expect(qf).toMatch(/title="Chance to reach the semifinals"[^>]*>100%</);
        expect(sf).toMatch(/title="Chance to reach the championship game"[^>]*>100%</);
        expect(sf).toMatch(/title="Chance to reach the championship game"[^>]*>45%</);
        expect(fin).toMatch(/title="Chance to win the Cup"[^>]*>60%</);
        // the phone table carries the same per-round titles
        const phone = html.split('bracket-table')[1];
        expect(phone).toContain('title="Chance to reach the semifinals"');
        expect(phone).toContain('title="Chance to win the Cup"');
    });
    test('the odds view: 30 rows by title chance, one number per cell', async () => {
        const html = await render(params({ view: 'odds' }));
        const body = html.split('<tbody>')[1].split('</tbody>')[0];
        const trs = body.split('</tr>').filter((r) => r.includes('<td'));
        expect(trs).toHaveLength(30);
        expect(cellsOf(trs[0])).toEqual(['DETDetroit Pistons', 'East Group A', '1-0', '+8.1', '62%', '16%', '78%', '52%', '34%', '18%']);
        for (const tr of trs) expect(cellsOf(tr).slice(2).filter((c) => !/^(\d+-\d+|[+-]\d+\.\d|—|(&[gl]t;)?\d+%)$/.test(c))).toEqual([]);
    });
    test('a failed read says the numbers are unavailable, with no tables', async () => {
        const html = await render(params({ failed: true, data: null, pick: { snapshot: null, season: 2027, fallback: false } }));
        expect(html).toContain('id="cup-unavailable">The NBA Cup numbers are not available right now.');
        expect(html).not.toContain('id="cup-empty"');
        expect(html).not.toContain('<table');
    });
    test('no snapshot: the empty state names the season and the window', async () => {
        const html = await render(params({ data: null, pick: { snapshot: null, season: 2027, fallback: false } }));
        expect(html).toContain('id="cup-empty">There are no NBA Cup projections for 2026-27.');
        expect(html).not.toContain('<table');
    });
    test("the fallback names last season's Cup and day", async () => {
        const f = fixture();
        const html = await render(params({ seasons: [2027, 2028], current: 2028, pick: { snapshot: f.snapshot, season: 2027, fallback: true } }));
        expect(html).toContain("id=\"cup-fallback\">The 2027-28 Cup has no projections yet. This is the 2026-27 Cup's last snapshot, from November 3, 2026.");
        expect(html).toContain('id="cup-season"');
    });
});

describe('the Cup window', () => {
    test('November and December by the US Eastern day', () => {
        expect(isCupWindow(new Date('2026-11-01T03:30:00Z'))).toBe(false); // Oct 31, 11:30 pm ET
        expect(isCupWindow(new Date('2026-11-01T05:00:00Z'))).toBe(true);
        expect(isCupWindow(new Date('2026-12-16T12:00:00Z'))).toBe(true);
        expect(isCupWindow(new Date('2027-01-01T04:30:00Z'))).toBe(true); // Dec 31, 11:30 pm ET
        expect(isCupWindow(new Date('2027-01-01T06:00:00Z'))).toBe(false);
        expect(isCupWindow(new Date('2027-03-01T12:00:00Z'))).toBe(false);
    });
});

describe("the 'bball-nba-cup' flag", () => {
    const header = async (day: string, league: 'nba' | 'wnba', flagOverrides: Record<string, boolean> = {}) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(day));
        try {
            return await container.renderToString(Header, { locals: { league, preview: true, flagOverrides } as any });
        } finally {
            vi.useRealTimers();
        }
    };
    test('the NBA Header lists the Cup in the Cup window only, with the flag', async () => {
        const entry = '<a href="/nba/cup" class="nav-link px-2 link-secondary">NBA Cup</a>';
        expect(await header('2026-11-15T12:00:00Z', 'nba')).toContain(entry);
        expect(await header('2026-12-20T12:00:00Z', 'nba')).toContain(entry);
        expect(await header('2027-02-01T12:00:00Z', 'nba')).not.toContain('/nba/cup"');
        expect(await header('2026-10-20T12:00:00Z', 'nba')).not.toContain('/nba/cup"');
        expect(await header('2026-11-15T12:00:00Z', 'nba', { 'bball-nba-cup': false })).not.toContain('/nba/cup"');
        expect(await header('2026-11-15T12:00:00Z', 'wnba')).not.toContain('/cup"');
    });
    test('ships as preview', () => {
        expect(FLAGS['bball-nba-cup']).toBe('preview');
    });
    test('/nba/standings links the Cup only with the flag, and the WNBA never', async () => {
        const data = { league: 'nba', seasons: [2027], current: 2027, view: 'standings', pick: { snapshot: null, season: 2027, fallback: false }, data: null } as const;
        const on = await container.renderToString(PlayoffPictureRoute, { props: { data }, locals: { league: 'nba', preview: true } as App.Locals });
        expect(on).toContain('<a href="/nba/cup">');
        const off = await container.renderToString(PlayoffPictureRoute, { props: { data }, locals: { league: 'nba', preview: true, flagOverrides: { 'bball-nba-cup': false } } as any });
        expect(off).not.toContain('/nba/cup');
        const wnba = await container.renderToString(PlayoffPictureRoute, { props: { data: { ...data, league: 'wnba' } }, locals: { league: 'wnba', preview: true } as App.Locals });
        expect(wnba).not.toContain('/cup"');
    });
});
