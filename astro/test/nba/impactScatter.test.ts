// BB-G10 ('bball-impact-scatter'): the scatter's impact (player) and team views, on real 2025-26 rows
// (fixtures/nba/player_impact_2026_bkn.json, team_strength_2026.json; see fixtures/README.md).
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows } from './rows';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const IMPACT: Record<string, unknown>[] = read('player_impact_2026_bkn');
const STRENGTH: Record<string, unknown>[] = read('team_strength_2026');

const views = vi.hoisted(() => ({ impact: vi.fn(), teams: vi.fn() }));
vi.mock('../../src/resources/scatterViews', () => ({ retrieveSeasonImpact: views.impact, retrieveSeasonTeamStrength: views.teams }));
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => apiSeasonPlayerRows(),
}));

import { describeScatter } from '../../src/nba/charts/scatterChart';
import { AXIS_METRICS, IMPACT_COLUMNS, IMPACT_METRICS, pointValue, SCATTER_METRICS, TEAM_COLUMNS, TEAM_METRICS } from '../../src/nba/scatterMetrics';
import { prepareBasketballScatter, type BasketballScatterParams } from '../../src/routes/basketball/scatter';

const ON = { 'bball-impact-scatter': true };
function fakeAstro(path: string, flagOverrides: Record<string, boolean> = {}) {
    const cache: unknown[] = [];
    return { astro: { params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: { flagOverrides } as any, cache: { set: (v: unknown) => cache.push(v) }, response: { headers: new Headers() } } as any, cache };
}
async function prep(path: string, flags: Record<string, boolean> = ON, league: 'nba' | 'wnba' | 'mbb' = 'nba') {
    const { astro, cache } = fakeAstro(path, flags);
    const r = await prepareBasketballScatter(astro, league);
    if ('unavailable' in r) throw new Error('unexpected unavailable');
    return { r: r as BasketballScatterParams, cache };
}
const r4 = (v: unknown) => Math.round(Number(v) * 1e4) / 1e4;

beforeAll(() => {
    // every Data API read in this file is mocked above: a request that slips through must fail here, never reach the network
    vi.stubGlobal('fetch', () => { throw new Error('unmocked network read'); });
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
    views.impact.mockReset().mockResolvedValue(IMPACT);
    views.teams.mockReset().mockResolvedValue(STRENGTH);
});

describe('prepareBasketballScatter, BB-G10', () => {
    test('flag off: no view, no read, the shooting points as today', async () => {
        const { r } = await prep('/nba/scatter?season=2026', {});
        expect(r.view).toBeUndefined();
        expect(views.impact).not.toHaveBeenCalled();
        expect(views.teams).not.toHaveBeenCalled();
        expect(r.points.every((p) => p.v.length === SCATTER_METRICS.length)).toBe(true);
    });

    test('player view: one season read, each player carries his own player_impact RAPM and SPM, same players as shooting', async () => {
        const off = (await prep('/nba/scatter?season=2026', {})).r.points;
        const { r } = await prep('/nba/scatter?season=2026');
        expect(views.impact).toHaveBeenCalledTimes(1);
        expect(views.impact).toHaveBeenCalledWith('nba', 2026);
        expect(r.view).toEqual({ kind: 'players', failed: false });
        expect(r.points.map((p) => p.person_id)).toEqual(off.map((p) => p.person_id));
        expect(r.points.every((p) => p.v.length === SCATTER_METRICS.length + IMPACT_METRICS.length)).toBe(true);
        // the shooting values are untouched
        expect(r.points.map((p) => p.v.slice(0, SCATTER_METRICS.length))).toEqual(off.map((p) => p.v));
        const byId = new Map(IMPACT.map((row) => [Number(row.player_id), row]));
        const joined = r.points.filter((p) => byId.has(p.person_id));
        expect(joined.length).toBeGreaterThanOrEqual(10); // the Nets' qualified shooters
        for (const p of joined) for (const m of IMPACT_METRICS) expect(pointValue(p, m)).toBe(r4(byId.get(p.person_id)![IMPACT_COLUMNS[m]]));
        // Michael Porter Jr. (1629008), read off the capture: O-RAPM +3.9030, D-RAPM -1.1420
        const mpj = r.points.find((p) => p.person_id === 1629008)!;
        expect([pointValue(mpj, 'oRapm'), pointValue(mpj, 'dRapm')]).toEqual([3.9031, -1.142]);
        // a player with no impact row keeps his shooting values and drops out of an impact plot only
        const missing = r.points.filter((p) => !byId.has(p.person_id));
        expect(missing.length).toBeGreaterThan(0);
        expect(missing.every((p) => IMPACT_METRICS.every((m) => pointValue(p, m) === null))).toBe(true);
    });

    test('the default view is O-RAPM against D-RAPM over the players who have both; medians are those players\' own', async () => {
        const { r } = await prep('/nba/scatter?season=2026');
        const desc = describeScatter(r.points, 'oRapm', 'dRapm');
        const both = IMPACT.filter((row) => r.points.some((p) => p.person_id === Number(row.player_id)));
        const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
        const mx = med(both.map((row) => r4(row.o_rapm))).toFixed(1);
        const my = med(both.map((row) => r4(row.d_rapm))).toFixed(1);
        expect(desc.startsWith(`${both.length} players with 100+ FGA, D-RAPM against O-RAPM; medians ${mx} and ${my}.`)).toBe(true);
    });

    test('team view (?view=teams): every team_strength row as a team, its producer values in the team slots', async () => {
        const { r } = await prep('/nba/scatter?season=2026&view=teams');
        expect(views.teams).toHaveBeenCalledWith('nba', 2026);
        expect(views.impact).not.toHaveBeenCalled();
        expect(r.view).toEqual({ kind: 'teams', failed: false });
        expect(r.points).toHaveLength(30);
        expect(r.points.every((p) => p.v.length === AXIS_METRICS.length)).toBe(true);
        for (const row of STRENGTH) {
            const p = r.points.find((q) => q.team_id === Number(row.team_id))!;
            for (const m of TEAM_METRICS) expect(pointValue(p, m)).toBe(r4(row[TEAM_COLUMNS[m]]));
            for (const m of [...SCATTER_METRICS, ...IMPACT_METRICS]) expect(pointValue(p, m)).toBeNull();
        }
        const nets = r.points.find((p) => p.team_id === 1610612751)!;
        expect(nets).toMatchObject({ name: 'Brooklyn Nets', team: 'BKN', nets: true, headshot: 'https://a.espncdn.com/i/teamlogos/nba/500/17.png' });
        expect(r.points.filter((p) => p.nets)).toHaveLength(1);
        expect(describeScatter(r.points, 'adjOffRtg', 'adjDefRtg', null, 100, 'teams')).toMatch(/^30 teams, Adj\. def rating \(reversed\) against Adj\. off rating; medians /);
    });

    test('a failed player-view read keeps the shooting axes, uncached; a failed team read plots nothing, uncached', async () => {
        views.impact.mockRejectedValue(new Error('down'));
        const p = await prep('/nba/scatter?season=2026');
        expect(p.r.view).toEqual({ kind: 'players', failed: true });
        expect(p.r.points.length).toBeGreaterThan(0);
        expect(p.r.points.every((q) => q.v.length === SCATTER_METRICS.length)).toBe(true);
        expect(p.cache).toContain(false);
        views.teams.mockRejectedValue(new Error('down'));
        const t = await prep('/nba/scatter?season=2026&view=teams');
        expect(t.r.view).toEqual({ kind: 'teams', failed: true });
        expect(t.r.points).toEqual([]);
        expect(t.cache).toContain(false);
    });

    test('WNBA reads its own league; college is unchanged with the flag on', async () => {
        const w = await prep('/wnba/scatter?season=2025', ON, 'wnba');
        expect(w.r.view?.kind).toBe('players');
        expect(views.impact).toHaveBeenCalledWith('wnba', 2025);
        views.impact.mockClear();
        const { astro } = fakeAstro('/mbb/scatter?view=teams', ON);
        await prepareBasketballScatter(astro, 'mbb').catch(() => null);
        expect(views.impact).not.toHaveBeenCalled();
        expect(views.teams).not.toHaveBeenCalled();
    });
});

describe('/nba/scatter render, BB-G10', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = async (url: string, flags: Record<string, boolean>) => {
        const { default: Page } = await import('../../src/pages/nba/scatter.astro');
        return container.renderToString(Page, { request: new Request(`https://gameonpaper.com${url}`), locals: { flagOverrides: { nba: true, ...flags } } as App.Locals });
    };

    test('player view: the view picker, the impact axes first, D-RAPM against O-RAPM selected', async () => {
        const html = await render('/nba/scatter?season=2026', ON);
        expect(html).toContain('id="nba-scatter-view"');
        expect(html).toMatch(/<option value="players" selected[^>]*>Players: impact and shooting/);
        expect(html).toMatch(/<select name="y"[^>]*>\s*<!--\[-->\s*<option value="oRapm"/);
        expect(html).toMatch(/<option value="dRapm" selected[^>]*>D-RAPM/);
        expect(html).toMatch(/<option value="oRapm" selected[^>]*>O-RAPM/);
        expect(html).toContain('D-RAPM against O-RAPM');
        expect(html).toContain('RAPM and SPM are points per 100 possessions');
        expect(html).not.toMatch(/adj_rapm|Adj\. RAPM|BPM|WAR/);
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
    });

    test('team view: the picker on Teams, the team axes, logos, a season change keeps the view', async () => {
        const html = await render('/nba/scatter?season=2026&view=teams', ON);
        expect(html).toMatch(/<option value="teams" selected[^>]*>Teams: ratings and four factors/);
        expect(html).toContain('Adj. def rating (reversed) against Adj. off rating');
        expect(html).toContain('placeholder="team name"');
        expect(html).toContain('view=teams'); // the season picker's links
        expect(html).not.toContain('undefined');
    });

    test('a failed team read says so instead of an empty plot', async () => {
        views.teams.mockRejectedValue(new Error('down'));
        const html = await render('/nba/scatter?season=2026&view=teams', ON);
        expect(html).toContain('The team numbers are temporarily unavailable.');
        expect(html).not.toContain('<desc>');
    });

    test('flag off: no picker, no read', async () => {
        const html = await render('/nba/scatter?season=2026', { 'bball-impact-scatter': false });
        expect(html).not.toContain('nba-scatter-view');
        expect(html).not.toContain('O-RAPM');
        expect(views.impact).not.toHaveBeenCalled();
    });
});
