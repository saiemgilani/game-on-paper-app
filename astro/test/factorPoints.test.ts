// BB-G58: four-factor point accounting on the team season block and the Lineups tab, behind 'bball-factor-points'.
// Real data only (fixtures/README.md): factor-points.json.gz is sdv-py BB-D42's producer output on the release data
// (the Nets and Duke 2025-26 team_season_rates rows, Minnesota's 2024-25 lineup_seasons units), joined onto BB-G5's
// live team-season capture by split. Gate: the four parts add up to the net rating within 0.1 on every rendered row.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

import TeamSeasonBlock from '../src/components/nba/TeamSeasonBlock.astro';
import LineupsTab from '../src/components/nba/LineupsTab.astro';
import { FLAGS } from '../src/utils/features';
import { FACTOR_POINTS, selectFor, type LineupRow } from '../src/resources/lineups';
import { basesFor, parseBasis, parseLineupSort, sortKeysFor } from '../src/utils/lineups';
import { bballOnly } from './helpers/flags';

const gz = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const FP = gz('factor-points');
const NBA = gz('team-season-nba-2026');
const MBB = gz('team-season-mbb-2026');
// the live capture's split rows, each with the producer's factor columns of the same split
const PRODUCER_COLS = ['lg_rtg', ...['off_', 'def_', ''].flatMap((s) => ['efg', 'tov', 'orb', 'ft'].map((f) => `${s}${f}_pts`))];
const withPoints = (c: any, rows: any[]) => c.rates.map((r: any) => { const p = rows.find((x) => x.split === r.split); return { ...r, ...Object.fromEntries(PRODUCER_COLS.map((k) => [k, p[k]])) }; });
const reads = (c: any, rates: any[]) => ({ rates, strength: null, games: [...c.home, ...c.away], gameRates: c.gameRates });

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const normalize = (html: string) => html.replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');
const block = async (data: unknown, league: string, espnId: number, on: boolean) => normalize(await container.renderToString(TeamSeasonBlock, {
    props: { data, season: 2026, espnId, teamName: 'Team' },
    locals: { league, preview: true, flagOverrides: { ...bballOnly('bball-team-season'), 'bball-factor-points': on } } as unknown as App.Locals,
}));
const num = (s: string) => Number(s.replace('−', '-').replace('+', ''));
const tds = (row: string) => [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

describe('the producer rows', () => {
    test('every split row of both teams: the eight parts and the four sums add up to the net rating', () => {
        for (const rows of [FP.nba, FP.mbb]) {
            expect(rows).toHaveLength(5);
            for (const r of rows) {
                if (r.efg_pts == null) continue; // college clutch: no box counts, no parts
                const eight = ['efg', 'tov', 'orb', 'ft'].reduce((s, f) => s + r[`off_${f}_pts`] + r[`def_${f}_pts`], 0);
                const four = ['efg', 'tov', 'orb', 'ft'].reduce((s, f) => s + r[`${f}_pts`], 0);
                expect(Math.abs(eight - r.net_rtg)).toBeLessThan(0.1);
                expect(Math.abs(four - r.net_rtg)).toBeLessThan(0.1);
            }
        }
    });
    test('the producer rows are the captured teams and season', () => {
        for (const [c, rows] of [[NBA, FP.nba], [MBB, FP.mbb]] as const) {
            for (const r of rows) expect([r.season, r.team_id]).toEqual([c.rates[0].season, c.rates[0].team_id]);
        }
    });
});

describe("'bball-factor-points' on the season block", () => {
    test('is a preview flag', () => { expect(FLAGS['bball-factor-points']).toBe('preview'); });
    test('off, the block is the same with or without the producer columns', async () => {
        expect(await block(reads(NBA, withPoints(NBA, FP.nba)), 'nba', 17, false)).toBe(await block(reads(NBA, NBA.rates), 'nba', 17, false));
    });
    test('on, rows without the columns (before the producer reload): no table', async () => {
        expect(await block(reads(NBA, NBA.rates), 'nba', 17, true)).not.toContain('season-factor-points');
    });
    test.each([['nba', NBA, FP.nba, 17], ['mbb', MBB, FP.mbb, 150]] as const)('on, %s: offense, defense and net by factor; the four nets add up to the net rating within 0.1', async (lg, c, rows, espn) => {
        const html = await block(reads(c, withPoints(c, rows)), lg, espn, true);
        const t = html.split('id="season-factor-points"')[1].split('</table>')[0];
        const all = rows.find((r: any) => r.split === 'all');
        const body = t.split('<tbody>')[1].split('<tr').slice(1);
        expect(body).toHaveLength(5);
        const nets = body.slice(0, 4).map((r) => tds(r).map(num));
        for (const [off, def, n] of nets) expect(Math.abs(off + def - n)).toBeLessThan(0.15); // each cell rounds to 0.1
        expect(Math.abs(nets.reduce((s, r) => s + r[2], 0) - all.net_rtg)).toBeLessThan(0.25);
        expect(num(tds(body[4])[2])).toBeCloseTo(all.net_rtg, 1);
        expect(t).toContain(`(${all.lg_rtg.toFixed(1)})`);
        // one number per cell; only the net rating is shaded (the parts have no percentile)
        expect(t.match(/hulk-bg-level-\d/g)?.length ?? 0).toBeLessThanOrEqual(1);
    });
});

const MIN = FP.units as LineupRow[];
const tab = async (units: LineupRow[], on: boolean) => normalize(await container.renderToString(LineupsTab, {
    props: { data: { unit: 5, basis: 'points', gate: '200', sort: 'poss', dir: 'desc', units, labels: units.map(() => ({ players: [] })) }, season: 2025, current: 2026, basePath: '/nba/team/1610612750', teamName: 'Team' },
    locals: { league: 'nba', preview: true, flagOverrides: { ...bballOnly('bball-lineups'), 'bball-factor-points': on } } as unknown as App.Locals,
}));

describe("'bball-factor-points' on the Lineups tab", () => {
    test('the basis exists only with the flag; its columns are read only for that basis', () => {
        expect(basesFor('nba')).toEqual(['per100', 'totals']);
        expect(basesFor('nba', true)).toEqual(['per100', 'totals', 'points']);
        expect(basesFor('mbb', true)).toEqual(['per100', 'totals', 'zones', 'points']);
        expect(parseBasis('points', 'nba')).toBe('per100');
        expect(parseBasis('points', 'nba', true)).toBe('points');
        for (const k of FACTOR_POINTS) {
            expect(selectFor('nba').split(',')).not.toContain(k);
            expect(selectFor('nba', true).split(',')).toContain(k);
        }
        expect(sortKeysFor('points')).toEqual(['minutes', 'poss', 'net_rtg', ...FACTOR_POINTS]);
        expect(parseLineupSort('ft_pts', 'points')).toBe('ft_pts');
    });
    test("Minnesota's fives over 200 possessions: Net and its four parts, which add up within 0.1 on every unit", async () => {
        const units = MIN.filter((u) => u.n_players === 5 && u.poss >= 200).sort((a, b) => b.poss - a.poss);
        expect(units.length).toBeGreaterThan(3);
        for (const u of units) expect(Math.abs(FACTOR_POINTS.reduce((s, k) => s + (u[k] as number), 0) - (u.net_rtg as number))).toBeLessThan(0.1);
        const html = await tab(units, true);
        expect(html).toContain('<option value="/nba/team/1610612750?season=2025&amp;basis=points&amp;min=200#lineups" selected>Four-factor points</option>');
        const rows = html.split('id="lineups-table"')[1].split('<tbody>')[1].split('</tbody>')[0].split('<tr').slice(1);
        expect(rows).toHaveLength(units.length);
        rows.forEach((r, i) => {
            const [, , n, ...parts] = tds(r);
            expect(num(n)).toBeCloseTo(units[i].net_rtg as number, 1);
            expect(parts.map(num)).toEqual(FACTOR_POINTS.map((k) => Math.round((units[i][k] as number) * 10) / 10));
        });
    });
    test('off, the basis select has no points option', async () => {
        expect(await tab(MIN.slice(0, 2), false)).not.toContain('Four-factor points');
    });
});
