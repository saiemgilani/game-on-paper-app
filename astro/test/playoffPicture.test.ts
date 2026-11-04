// BB-G23: /nba/standings and /wnba/standings. The pure steps (the season, the snapshot pick, the seed groups and the
// play-in, the first round, the divisions, the lottery grid) and the page's template, on real sdv-py producer output:
// sdv-db #186's season_products fixtures (nba_season_sim as of 2026-02-13, the 2026 WNBA final day 2026-09-25), with
// nba_season_standings run on the same schedules to the same day and nba_draft_lottery_odds' NBA table. The Data API
// routes serve these frames with season and as_of_date added (sdv-db season_products.write_snapshot).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import PlayoffPictureRoute from '../src/components/routes/PlayoffPictureRoute.astro';
import Header from '../src/components/Header.astro';
import type { PlayoffPictureParams } from '../src/routes/basketball/playoffPicture';
import { viewsFor } from '../src/routes/basketball/playoffPicture';
import type { ProSnapshot } from '../src/resources/playoffPicture';
import { pickSnapshot, type Snapshot } from '../src/utils/bracketology';
import {
    conferenceTables, divisionTables, joinTeams, lotteryGrid, lotteryTeams, proSeasonOf, projectedBracket, seedGroups, type ProLeague,
} from '../src/utils/playoffPicture';
import { FLAGS } from '../src/utils/features';

const fixture = (league: ProLeague): ProSnapshot & { snapshot: Snapshot } =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/playoff-picture-${league}-2026.json.gz`, import.meta.url))).toString());
const teamsOf = (league: ProLeague) => { const f = fixture(league); return joinTeams(f.sims, f.standings); };

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('proSeasonOf', () => {
    test('NBA: August on is next season (END year)', () => {
        expect(proSeasonOf('nba', new Date('2026-06-20T00:00:00Z'))).toBe(2026);
        expect(proSeasonOf('nba', new Date('2026-08-01T00:00:00Z'))).toBe(2027);
        expect(proSeasonOf('nba', new Date('2026-11-03T00:00:00Z'))).toBe(2027);
    });
    test('WNBA: the calendar year through the Finals, next season from November', () => {
        expect(proSeasonOf('wnba', new Date('2026-09-25T00:00:00Z'))).toBe(2026);
        expect(proSeasonOf('wnba', new Date('2026-10-31T23:00:00Z'))).toBe(2026);
        expect(proSeasonOf('wnba', new Date('2026-11-03T00:00:00Z'))).toBe(2027);
        expect(proSeasonOf('wnba', new Date('2027-03-01T00:00:00Z'))).toBe(2027);
    });
});

describe('the snapshot pick on the pro tables', () => {
    // pickSnapshot is the college page's rule; this pins the case the WNBA page lives in today
    const latest = async (season?: number) => (season == null || season === 2026 ? { season: 2026, as_of_date: '2026-09-25' } : null);
    test("the WNBA in November: 2027 has no snapshot, so the 2026 final day, flagged as a fallback", async () => {
        expect(await pickSnapshot(null, proSeasonOf('wnba', new Date('2026-11-03T00:00:00Z')), latest))
            .toEqual({ snapshot: { season: 2026, as_of_date: '2026-09-25' }, season: 2026, fallback: true });
    });
    test('an explicit season never falls back', async () => {
        expect(await pickSnapshot(2026, 2027, latest)).toEqual({ snapshot: { season: 2026, as_of_date: '2026-09-25' }, season: 2026, fallback: false });
    });
});

describe('seedGroups (the play-in grouping)', () => {
    test('NBA: each conference cut 1-6, 7-10 (the play-in) and 11-15 by official seed', () => {
        for (const c of conferenceTables(teamsOf('nba'))) {
            expect(c.rows.map((r) => r.standing!.seed)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
            const g = seedGroups('nba', c.rows);
            expect(g.map((x) => [x.key, x.rows.map((r) => r.standing!.seed)])).toEqual([
                ['direct', [1, 2, 3, 4, 5, 6]], ['play_in', [7, 8, 9, 10]], ['out', [11, 12, 13, 14, 15]],
            ]);
        }
    });
    test('WNBA: one league table, top 8 in, no play-in group', () => {
        const [table, ...rest] = conferenceTables(teamsOf('wnba'));
        expect(rest).toHaveLength(0);
        expect(table.name).toBe('WNBA');
        const g = seedGroups('wnba', table.rows);
        expect(g.map((x) => x.key)).toEqual(['direct', 'out']);
        expect(g[0].rows).toHaveLength(8);
        expect(g[0].rows.every((r) => r.sim.p_playoffs === 1)).toBe(true); // the final day: the field is set
    });
    test('a day without standings is one unlabelled group in mean-seed order', () => {
        const f = fixture('nba');
        const [east] = conferenceTables(joinTeams(f.sims, []));
        const g = seedGroups('nba', east.rows);
        expect(g).toHaveLength(1);
        expect(g[0].label).toBeNull();
        const means = g[0].rows.map((r) => r.sim.mean_seed!);
        expect(means).toEqual([...means].sort((a, b) => a - b));
    });
});

describe('projectedBracket', () => {
    test('NBA: the play-in (7-8, 9-10), then 1 v the 8 slot, 4-5, 3-6, 2 v the 7 slot', () => {
        const [east] = conferenceTables(teamsOf('nba'));
        const rounds = projectedBracket('nba', east.rows)!;
        expect(rounds.map((r) => r.name)).toEqual(['Play-In', 'First Round']);
        const seeds = rounds.map((r) => r.games.map((g) => g.map((u) => ('team' in u ? u.seed : `${u.seed}*`))));
        expect(seeds).toEqual([[[7, 8], [9, 10]], [[1, '8*'], [4, 5], [3, 6], [2, '7*']]]);
    });
    test('WNBA: the first round only, 1-8, 4-5, 3-6, 2-7', () => {
        const [table] = conferenceTables(teamsOf('wnba'));
        const rounds = projectedBracket('wnba', table.rows)!;
        expect(rounds.map((r) => r.games.map((g) => g.map((u) => u.seed)))).toEqual([[[1, 8], [4, 5], [3, 6], [2, 7]]]);
    });
    test('null when a needed seed is missing or doubled', () => {
        const [east] = conferenceTables(teamsOf('nba'));
        expect(projectedBracket('nba', east.rows.filter((r) => r.standing!.seed !== 9))).toBeNull();
        expect(projectedBracket('nba', east.rows.map((r) => (r.standing!.seed === 3 ? { ...r, standing: { ...r.standing!, seed: 2 } } : r)))).toBeNull();
    });
});

describe('divisions and the lottery', () => {
    test('NBA: six divisions of five, each by official division rank; the WNBA has none', () => {
        const d = divisionTables('nba', teamsOf('nba'));
        expect(d.map((x) => x.name)).toEqual(['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']);
        for (const x of d) expect(x.rows.map((r) => r.standing!.division_rank)).toEqual([1, 2, 3, 4, 5]);
        expect(divisionTables('wnba', teamsOf('wnba'))).toEqual([]);
    });
    test("the lottery teams by average pick, and the NBA's 14 x 14 slot grid", () => {
        const lot = lotteryTeams(teamsOf('nba'));
        const picks = lot.map((t) => t.sim.mean_pick ?? Infinity);
        expect(picks).toEqual([...picks].sort((a, b) => a - b));
        const g = lotteryGrid(fixture('nba').lottery);
        expect(g.picks).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
        expect(g.slots.map((s) => s.chances)).toEqual([140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5]);
        expect(g.slots[0].byPick[0]).toBeCloseTo(0.14, 6);
        expect(lotteryGrid([])).toEqual({ picks: [], slots: [] });
    });
    test('WNBA: the null pick columns order by lottery chance', () => {
        const lot = lotteryTeams(teamsOf('wnba'));
        expect(lot).toHaveLength(7);
        expect(lot.every((t) => t.sim.p_pick_1 == null)).toBe(true);
    });
});

const params = (league: ProLeague, over: Partial<PlayoffPictureParams> = {}): PlayoffPictureParams => {
    const f = fixture(league);
    return {
        league, seasons: [2026, 2027], current: 2027, view: 'standings',
        pick: { snapshot: f.snapshot, season: 2026, fallback: false },
        data: { sims: f.sims, standings: f.standings, lottery: f.lottery },
        ...over,
    };
};
const render = (p: PlayoffPictureParams) =>
    container.renderToString(PlayoffPictureRoute, { props: { data: p }, locals: { league: p.league, preview: true } as App.Locals });
const cellsOf = (row: string) => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

describe('PlayoffPictureRoute', () => {
    test('NBA standings: two conferences, the play-in group, ESPN logos and team links, one number per cell, green-only odds', async () => {
        const html = await render(params('nba'));
        expect(html).toContain('NBA Standings and Playoff Picture, 2025-26');
        expect(html).toContain('As of February 13, 2026: games before that day count. 10,000 simulated seasons.');
        for (const t of ['Eastern Conference', 'Western Conference', 'Playoff spots (1-6)', 'Play-in (7-10)', 'Outside the field', 'Play-In', 'Top 6']) expect(html).toContain(t);
        // Detroit (stats 1610612765) is ESPN 8: its logo and its stats-id team page
        expect(html).toContain('src="https://a.espncdn.com/i/teamlogos/nba/500/8.png"');
        expect(html).toContain('href="/nba/team/1610612765"');
        expect(html).toContain('>Detroit Pistons<');
        // its dark logo by ESPN's abbreviation: nba/500-dark/<id>.png is a 404 for every team
        expect(html).toContain("img.team-logo-8 {\n        content: url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500-dark/det.png&h=120&w=120')");
        expect(html).not.toMatch(/nba\/500-dark\/\d+\.png/);
        expect(html).not.toMatch(/hulk-bg-level-[0-5]\b/); // probabilities are green only
        const firstRow = html.split('<tbody>')[1].split('</tr>')[1];
        const cells = cellsOf(firstRow);
        expect(cells[0]).toMatch(/^1DETDetroit Pistons$/);
        expect(cells.slice(1).filter((c) => !/^(\d+-\d+|\d+\.\d-\d+\.\d|[+-]\d+\.\d|—|(&[gl]t;)?\d+%)$/.test(c))).toEqual([]);
        expect(html).not.toContain('NaN');
    });
    test("WNBA: last season's labelled fallback, one table without play-in columns", async () => {
        const html = await render(params('wnba', { pick: { snapshot: fixture('wnba').snapshot, season: 2026, fallback: true } }));
        expect(html).toMatch(/id="standings-fallback">The 2027 season has no projections yet\. This is the 2026 season's last snapshot, from September 25, 2026\./);
        expect(html).toContain('Playoff spots (1-8)');
        expect(html).not.toContain('Play-in (7-10)');
        expect(html).not.toContain('Top 6');
        expect(html).not.toContain('Eastern Conference');
        // Minnesota (stats 1611661324): 2026 is the last listed season, so its canonical team page
        expect(html).toContain('href="/wnba/team/1611661324"');
    });
    test('the view select: Divisions for the NBA only; every select stays on the /preview surface', async () => {
        expect(viewsFor('nba').map((v) => v.key)).toEqual(['standings', 'seeds', 'divisions', 'bracket', 'lottery']);
        expect(viewsFor('wnba').map((v) => v.key)).toEqual(['standings', 'seeds', 'bracket', 'lottery']);
        const html = await render(params('nba'));
        expect(html).toContain('<option value="/nba/standings?season=2026&amp;view=divisions">Divisions</option>');
        const handlers = [...html.matchAll(/<select id="standings-[a-z]+"[^>]*onchange="([^"]+)"/g)].map((m) => m[1].replace(/&#39;/g, "'"));
        expect(handlers).toHaveLength(2);
        for (const h of handlers) expect(h).toBe("window.location.href = (location.pathname.startsWith('/preview/') ? '/preview' : '') + this.value");
    });
    test('the bracket view: per conference, the play-in and the first round on the bracket component, no champion', async () => {
        const html = await render(params('nba', { view: 'bracket' }));
        // the graphics (md and up); each conference's mobile table follows its graphic and has no round-name headings
        const graphic = html.split('playoff-bracket d-none').slice(1).map((s) => s.split('bracket-table')[0]).join('');
        expect([...graphic.matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['Play-In', 'First Round', 'Play-In', 'First Round']);
        expect(graphic.match(/table-bordered/g)).toHaveLength(2 * (2 + 4));
        expect(graphic).toContain('--bracket-rounds: 2');
        expect(graphic).not.toContain('Champion');
        expect(graphic.match(/Play-in winner/g)).toHaveLength(4);
        const wnba = await render(params('wnba', { view: 'bracket' }));
        expect([...wnba.split('bracket-table')[0].matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['First Round']);
    });
    test('the seed odds and divisions views', async () => {
        const seeds = await render(params('nba', { view: 'seeds' }));
        expect(seeds).toContain('Avg Seed');
        expect(seeds).toContain('<th class="text-center">15</th>');
        const div = await render(params('nba', { view: 'divisions' }));
        for (const d of ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest']) expect(div).toContain(`>${d}</caption>`);
    });
    test('the lottery view: NBA pick odds and the slot grid; the WNBA says not published yet', async () => {
        const html = await render(params('nba', { view: 'lottery' }));
        expect(html).toContain('No. 1 Pick');
        expect(html).toContain('Top 4');
        expect(html).toContain('Lottery odds by slot');
        expect(html).not.toContain('not published yet');
        const wnba = await render(params('wnba', { view: 'lottery' }));
        expect(wnba).toContain('id="lottery-picks-unpublished">Pick odds: not published yet.');
        expect(wnba).toContain('id="lottery-odds-unpublished">Not published yet');
        expect(wnba).not.toContain('No. 1 Pick');
    });
    test("the current season's label links last season's final snapshot", async () => {
        const html = await render(params('nba', { pick: { snapshot: { season: 2027, as_of_date: '2026-11-03' }, season: 2027, fallback: false } }));
        expect(html).toContain('Last season: <a href="/nba/standings?season=2026">2025-26\'s final snapshot</a>.');
    });
    test('no snapshot: the empty state names the season, with no tables', async () => {
        const html = await render(params('nba', { pick: { snapshot: null, season: 2026, fallback: false }, data: null }));
        expect(html).toContain('id="standings-empty">There are no projections for 2025-26.');
        expect(html).not.toContain('<table');
    });
});

describe("the 'bball-playoff-picture' flag", () => {
    test('ships as preview', () => {
        expect(FLAGS['bball-playoff-picture']).toBe('preview');
    });
    test('the pro Header lists Standings only with the flag', async () => {
        for (const league of ['nba', 'wnba'] as const) {
            const on = await container.renderToString(Header, { locals: { league, preview: true } as App.Locals });
            expect(on).toContain(`<a href="/${league}/standings" class="nav-link px-2 link-secondary">Standings</a>`);
            const off = await container.renderToString(Header, { locals: { league, preview: true, flagOverrides: { 'bball-playoff-picture': false } } as any });
            expect(off).not.toContain(`/${league}/standings"`);
        }
        const mbb = await container.renderToString(Header, { locals: { league: 'mbb', preview: true } as App.Locals });
        expect(mbb).not.toContain('/standings"');
    });
});
