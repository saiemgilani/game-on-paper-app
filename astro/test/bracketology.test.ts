// BB-G22: /mbb/bracketology and /wbb/bracketology. The pure steps (the snapshot pick, the bubble, the bracket layout)
// on the 2025-26 men's final snapshot as the Data API served it, and the page's template on the same rows.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';
import BracketologyRoute from '../src/components/routes/BracketologyRoute.astro';
import Header from '../src/components/Header.astro';
import type { BracketologyParams } from '../src/routes/basketball/bracketology';
import type { CollegeSnapshot } from '../src/resources/bracketology';
import { bubbleGroups, collegeSeasonOf, pickSnapshot, projectedField, type Snapshot } from '../src/utils/bracketology';
import { FLAGS } from '../src/utils/features';

const fixture = (): CollegeSnapshot & { snapshot: Snapshot } =>
    JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/bracketology-mbb-2026.json.gz', import.meta.url))).toString());

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

describe('collegeSeasonOf', () => {
    test('August on is next season (END year)', () => {
        expect(collegeSeasonOf(new Date('2026-07-31T12:00:00Z'))).toBe(2026);
        expect(collegeSeasonOf(new Date('2026-08-01T00:00:00Z'))).toBe(2027);
        expect(collegeSeasonOf(new Date('2026-11-03T00:00:00Z'))).toBe(2027);
        expect(collegeSeasonOf(new Date('2027-04-06T00:00:00Z'))).toBe(2027);
    });
});

describe('pickSnapshot', () => {
    const days: Record<number, string> = { 2025: '2025-04-08', 2026: '2026-04-07' };
    const reader = (have: Record<number, string>) => {
        const calls: (number | undefined)[] = [];
        const latest = async (season?: number) => {
            calls.push(season);
            const s = season ?? Math.max(...Object.keys(have).map(Number));
            return have[s] ? { season: s, as_of_date: have[s] } : null;
        };
        return { calls, latest };
    };
    test("the current season's latest day when it has one", async () => {
        const r = reader({ ...days, 2027: '2026-11-03' });
        expect(await pickSnapshot(null, 2027, r.latest)).toEqual({ snapshot: { season: 2027, as_of_date: '2026-11-03' }, season: 2027, fallback: false });
        expect(r.calls).toEqual([2027]);
    });
    test('an empty current season falls back to the latest season with data, flagged', async () => {
        const r = reader(days);
        expect(await pickSnapshot(null, 2027, r.latest)).toEqual({ snapshot: { season: 2026, as_of_date: '2026-04-07' }, season: 2026, fallback: true });
        expect(r.calls).toEqual([2027, undefined]);
    });
    test('?season= for the current season behaves as the default', async () => {
        expect((await pickSnapshot(2027, 2027, reader(days).latest)).fallback).toBe(true);
    });
    test('an explicit past season reads that season and never falls back', async () => {
        expect(await pickSnapshot(2025, 2027, reader(days).latest)).toEqual({ snapshot: { season: 2025, as_of_date: '2025-04-08' }, season: 2025, fallback: false });
        expect(await pickSnapshot(2005, 2027, reader(days).latest)).toEqual({ snapshot: null, season: 2005, fallback: false });
    });
    test('no snapshot anywhere: the current season, empty', async () => {
        expect(await pickSnapshot(null, 2027, reader({}).latest)).toEqual({ snapshot: null, season: 2027, fallback: false });
    });
});

describe('bubbleGroups', () => {
    test("the producer's four labels in bubble order, best at-large rank first", () => {
        const groups = bubbleGroups(fixture().bracket);
        expect(groups.map((g) => g.key)).toEqual(['last_four_byes', 'last_four_in', 'first_four_out', 'next_four_out']);
        for (const g of groups) {
            expect(g.rows).toHaveLength(4);
            const ranks = g.rows.map((r) => r.at_large_rank!);
            expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        }
        // in and out meet at the field's last at-large slot
        expect(groups[1].rows.every((r) => r.bid)).toBe(true);
        expect(groups[2].rows.some((r) => r.bid)).toBe(false);
    });
    test('an empty label is left out, and an unlabelled team is in no group', () => {
        const rows = [
            { bubble: 'first_four_out', at_large_rank: 70 }, { bubble: 'first_four_out', at_large_rank: 69 }, { bubble: null, at_large_rank: 1 },
        ];
        expect(bubbleGroups(rows)).toEqual([{ key: 'first_four_out', label: 'First four out', rows: [rows[1], rows[0]] }]);
        expect(bubbleGroups([])).toEqual([]);
    });
});

describe('projectedField', () => {
    const rows = fixture().bracket;
    const field = projectedField(rows)!;
    test('every bid team appears once: the First Four pairs and 4 regions x 8 games', () => {
        const ids = [
            ...field.firstFour.flat().map((r) => r.team_id),
            ...field.regions.flat(2).filter((u) => u.teams.length === 1).map((u) => u.teams[0].team_id),
        ];
        expect(ids).toHaveLength(68);
        expect(new Set(ids)).toEqual(new Set(rows.filter((r) => r.bid).map((r) => r.team_id)));
        expect(field.regions.flat(2).filter((u) => u.teams.length === 2)).toHaveLength(4);
    });
    test('the First Four: the last four in, then the four lowest auto-bids, each pair on one seed line', () => {
        const lastFourIn = rows.filter((r) => r.bubble === 'last_four_in').map((r) => r.team_id).sort();
        expect(field.firstFour.slice(0, 2).flat().map((r) => r.team_id).sort()).toEqual(lastFourIn);
        expect(field.firstFour.slice(2).flat().every((r) => r.auto_bid)).toBe(true);
        for (const [a, b] of field.firstFour) expect(a.projected_seed).toBe(b.projected_seed);
    });
    test('each region runs 1-16, 8-9, 5-12, 4-13, 6-11, 3-14, 7-10, 2-15, and the lines snake down the S-curve', () => {
        for (const games of field.regions) {
            expect(games.map(([a, b]) => [a.seed, b.seed])).toEqual([[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]]);
        }
        const ones = field.regions.map((g) => g[0][0].teams[0].resume_score);
        const twos = field.regions.map((g) => g[7][0].teams[0].resume_score);
        expect(ones).toEqual([...ones].sort((a, b) => b - a)); // region 1 has the best 1-seed
        expect(twos).toEqual([...twos].sort((a, b) => a - b)); // and the worst 2-seed
    });
    test('null when the field does not fill sixteen lines of four', () => {
        expect(projectedField(rows.filter((r) => r.team_id !== rows.find((x) => x.bid)!.team_id))).toBeNull();
        expect(projectedField([])).toBeNull();
    });
});

const params = (over: Partial<BracketologyParams> = {}): BracketologyParams => {
    const f = fixture();
    return {
        league: 'mbb', seasons: [2025, 2026, 2027], current: 2027, view: 'bracket', conference: null,
        pick: { snapshot: f.snapshot, season: 2026, fallback: true },
        data: { sims: f.sims, bracket: f.bracket, resume: f.resume },
        ...over,
    };
};
const render = (p: BracketologyParams) =>
    container.renderToString(BracketologyRoute, { props: { data: p }, locals: { league: 'mbb', preview: true } as App.Locals });

describe('BracketologyRoute', () => {
    test("the bracket view: last season's labelled fallback, the field on the bracket component, the bubble, the seed table", async () => {
        const html = await render(params());
        expect(html).toContain("Men's College Basketball Bracketology, 2025-26");
        expect(html).toMatch(/id="bracketology-fallback">The 2026-27 season has no projections yet\. This is the 2025-26 season's last snapshot, from April 7, 2026\./);
        const [graphic] = html.split('bracket-table');
        expect([...graphic.matchAll(/bracket-round-name[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['First Four', 'Region 1', 'Region 2', 'Region 3', 'Region 4']);
        expect(graphic.match(/table-bordered/g)).toHaveLength(4 + 32);
        expect(graphic).toContain('--bracket-rounds: 5');
        expect(graphic).not.toContain('Champion');
        for (const label of ['Last four byes', 'Last four in', 'First four out', 'Next four out', 'Seed distribution']) expect(html).toContain(label);
        expect(html).toContain('href="/mbb/team/');
        expect(html).not.toMatch(/hulk-bg-level-[0-3]/); // probabilities are green only
    });
    test('the standings view: one table per conference, the conference select, the projections', async () => {
        const html = await render(params({ view: 'standings', pick: { snapshot: fixture().snapshot, season: 2026, fallback: false } }));
        expect(html).toContain('As of April 7, 2026: games before that day count. 10,000 simulated seasons.');
        expect(html).toContain('All conferences');
        expect(html).toContain('Reg. Season Title');
        expect(html).toContain('<option value="/mbb/bracketology?season=2026&amp;view=standings&amp;conference=');
        expect(html).not.toContain('bracket-round-name');
    });
    test('the team sheets: NET order, percentile shading on the green-to-purple ramp, one number per cell', async () => {
        const html = await render(params({ view: 'resume' }));
        expect(html).toContain('Est. NET');
        expect(html).toMatch(/hulk-bg-level-9/);
        const firstRow = html.split('<tbody>')[1].split('</tr>')[0];
        const cells = [...firstRow.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
        expect(cells.slice(3, 7).every((c) => /^[+-]?\d+(\.\d)?$|^—$/.test(c))).toBe(true);
    });
    test("the current season's label links last season's final snapshot", async () => {
        const html = await render(params({ pick: { snapshot: { season: 2027, as_of_date: '2026-11-03' }, season: 2027, fallback: false } }));
        expect(html).toContain('As of November 3, 2026: games before that day count. 10,000 simulated seasons. Last season: <a href="/mbb/bracketology?season=2026">2025-26\'s final snapshot</a>.');
    });
    test("an old season's nulls (2004-05: 35 teams with no conference name and no title chance) render as dashes", async () => {
        // the shape of /v1/mbb/season_sims?season=2005: conference null, reg_season_title_prob null (a 500 before this)
        const f = fixture();
        const sims = f.sims.map((r, i) => (i < 3 ? { ...r, conference: null, reg_season_title_prob: null, proj_conf_win_pct_rank: null } : r));
        const html = await render(params({ view: 'standings', data: { ...f, sims } }));
        expect(html).toContain('>Other</option>');
        expect(html).not.toContain('NaN');
        expect(html).toMatch(/<td class="text-center numeral">—<\/td>/);
    });
    test('no snapshot: the empty state names the season, with no tables', async () => {
        const html = await render(params({ pick: { snapshot: null, season: 2005, fallback: false }, data: null }));
        expect(html).toContain('There are no projections for 2004-05.');
        expect(html).not.toContain('<table');
    });
});

describe("the 'bball-bracketology' flag", () => {
    test('ships as preview', () => {
        expect(FLAGS['bball-bracketology']).toBe('preview');
    });
    test('the college Header lists Bracketology only with the flag', async () => {
        for (const league of ['mbb', 'wbb'] as const) {
            const on = await container.renderToString(Header, { locals: { league, preview: true } as App.Locals });
            expect(on).toContain(`<a href="/${league}/bracketology" class="nav-link px-2 link-secondary">Bracketology</a>`);
            const off = await container.renderToString(Header, { locals: { league, preview: true, flagOverrides: { 'bball-bracketology': false } } as any });
            expect(off).not.toContain(`/${league}/bracketology"`);
        }
        const nba = await container.renderToString(Header, { locals: { league: 'nba', preview: true } as App.Locals });
        expect(nba).not.toContain(`bracketology"`);
    });
});
