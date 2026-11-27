import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { anyCharted, passDirectionTable, type PassPlay } from '../src/utils/passDirection';

// 'team-pass-direction': the Passing Direction panel on Alabama's (333) real pass attempts from the Data API's pbp table
// (fixtures/README.md: pass-plays-cfb-{2025,2026}-333-{off,def}.json.gz). The expected numbers were computed from the
// same files in Python, apart from this code (2026-11-26).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const fixture = (season: number, side: 'off' | 'def'): PassPlay[] =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/pass-plays-cfb-${season}-333-${side}.json.gz`, import.meta.url))).toString()).data;
const plays2026 = { off: fixture(2026, 'off'), def: fixture(2026, 'def') };
const plays2025 = { off: fixture(2025, 'off'), def: fixture(2025, 'def') };
const row = (plays: PassPlay[], key: string) => passDirectionTable(plays).rows.find((r) => r.key === key)!;

describe('passDirectionTable on real pass attempts', () => {
    test('2026 offense: sacks out, charted = depth and direction both present', () => {
        const t = passDirectionTable(plays2026.off);
        expect([plays2026.off.length, t.attempts, t.charted]).toEqual([317, 315, 275]);
        expect(t.coverage).toBeCloseTo(275 / 315, 6);
        expect(t.rows.map((r) => r.key)).toEqual(['all', 'short', 'short-left', 'short-middle', 'short-right', 'deep', 'deep-left', 'deep-middle', 'deep-right']);
        const all = row(plays2026.off, 'all');
        expect([all.attempts, all.completions, all.share]).toEqual([275, 194, 1]);
        expect(all.epa_per_play).toBeCloseTo(0.524065, 5);
        expect(all.success_rate).toBeCloseTo(0.574545, 5);
        expect(all.adot).toBeCloseTo(9.145455, 5);
        const deep = row(plays2026.off, 'deep');
        expect([deep.attempts, deep.completions]).toEqual([44, 26]);
        expect(deep.adot).toBeCloseTo(27.75, 5);
        expect(deep.epa_per_play).toBeCloseTo(1.44928, 4);
        const deepLeft = row(plays2026.off, 'deep-left');
        expect([deepLeft.attempts, deepLeft.completions]).toEqual([21, 12]);
        expect(deepLeft.share).toBeCloseTo(21 / 275, 6);
        expect(deepLeft.adot).toBeCloseTo(26.238095, 5);
    });

    test('every charted attempt lands in exactly one direction cell', () => {
        for (const plays of [plays2026.off, plays2026.def, plays2025.off, plays2025.def]) {
            const t = passDirectionTable(plays);
            const cells = t.rows.filter((r) => r.sub);
            expect(cells.reduce((a, r) => a + r.attempts, 0)).toBe(t.charted);
            expect(row(plays, 'short').attempts + row(plays, 'deep').attempts).toBe(t.charted);
        }
    });

    test('2026 defense: a depth without a direction is not charted', () => {
        const t = passDirectionTable(plays2026.def);
        expect([t.attempts, t.charted]).toEqual([326, 294]);
        expect(plays2026.def.some((p) => p.pass_depth === 'short' && p.pass_direction == null)).toBe(true);
        expect(row(plays2026.def, 'deep').adot).toBeCloseTo(32.730769, 5);
    });

    test('2025 is charted only from Week 9 on', () => {
        const t = passDirectionTable(plays2025.off);
        expect([t.attempts, t.charted]).toEqual([525, 238]);
        expect(row(plays2025.off, 'deep-left').adot).toBeCloseTo(29.571429, 5);
    });

    test('the caption\'s depths: ESPN\'s "deep" is 20+ air yards, "short" anything under, behind the line included', () => {
        const air = (plays: PassPlay[], depth: string) => plays
            .filter((p) => p.sack !== true && p.pass_depth === depth && p.air_yards != null).map((p) => Number(p.air_yards));
        for (const plays of [plays2026.off, plays2026.def, plays2025.off, plays2025.def]) {
            expect(Math.max(...air(plays, 'short'))).toBeLessThan(20);
            expect(Math.min(...air(plays, 'deep'))).toBeGreaterThanOrEqual(20);
            expect(air(plays, 'short').some((y) => y < 0)).toBe(true);
        }
    });

    test('no charted attempt on either side: no panel', () => {
        const uncharted = { off: plays2026.off.map((p) => ({ ...p, pass_direction: null })), def: [] };
        expect(anyCharted(uncharted)).toBe(false);
        expect(anyCharted(plays2026)).toBe(true);
        expect(passDirectionTable([]).coverage).toBeNull();
    });
});

const passReads: unknown[][] = [];
let passAnswer: { off: PassPlay[], def: PassPlay[] } | null = plays2026;
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async () => new Response('{"data":[]}', { status: 200 }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [] }),
    retrievePlayerSummaries: async () => [],
    retrieveTeamOpponentSplits: async () => null,
    retrieveTeamTendencies: async () => [],
    retrieveTeamAdjustmentLedger: async () => [],
    retrieveTeamPassPlays: async (...a: unknown[]) => { passReads.push(a); return passAnswer; },
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id, location: 'Alabama', name: 'Crimson Tide', abbreviation: 'ALA', color: '9e1b32', alternateColor: 'ffffff' }),
}));

describe('the PassDirectionTable panel', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create(); });
    const render = async (plays: { off: PassPlay[], def: PassPlay[] }, season: number, query = '') => {
        const { default: Panel } = await import('../src/components/team/PassDirectionTable.astro');
        return container.renderToString(Panel, { props: { plays, season }, request: new Request(`https://gameonpaper.com/year/${season}/team/333${query}`) });
    };
    const trs = (html: string, side: string) => [...html.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
        .filter((m) => m[1].includes(`data-side="${side}"`))
        .map((m) => ({ hidden: m[1].includes('d-none'), cells: [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]*>/g, '').trim()) }));

    test('both sides render, Offense showing; nine rows each, numbers formatted', async () => {
        const html = await render(plays2026, 2026);
        expect(html).toContain('id="pass-direction-panel"');
        const off = trs(html, 'off');
        const def = trs(html, 'def');
        expect([off.length, def.length]).toEqual([9, 9]);
        expect(off.every((r) => !r.hidden) && def.every((r) => r.hidden)).toBe(true);
        expect(off[0].cells).toEqual(['All', '194/275', '100.0%', '0.52', '57.5%', '9.1']);
        expect(off[5].cells).toEqual(['Deep', '26/44', '16.0%', '1.45', '59.1%', '27.8']);
        expect(off[6].cells[0]).toBe('Left');
        expect(html).toContain('Short = under 20 air yards, throws behind the line included; Deep = 20+.');
    });

    test('a side below 90% charted says why; one at or above does not', async () => {
        const html = await render(plays2026, 2026);
        const lines = [...html.matchAll(/<p data-side="(off|def)"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]);
        expect(lines).toEqual([
            ['off', "Charted: 275 of 315 pass attempts (87.3%). Some games&#39; play text carries no depth or direction."],
            ['def', 'Charted: 294 of 326 pass attempts (90.2%).'],
        ]);
        const html2025 = await render(plays2025, 2025);
        expect(html2025).toContain('Charted: 238 of 525 pass attempts (45.3%). ESPN&#39;s play text carries depth and direction from 2025 Week 9 on.');
    });

    test('?pass_side=def opens on Defense', async () => {
        const html = await render(plays2026, 2026, '?pass_side=def');
        expect(trs(html, 'def').every((r) => !r.hidden)).toBe(true);
        expect(trs(html, 'off').every((r) => r.hidden)).toBe(true);
        expect(html).toMatch(/<option value="def" selected/);
    });
});

const fakeAstro = (flag: boolean, year = '2026') => ({
    params: { year, id: '333' }, locals: { flagOverrides: { 'team-pass-direction': flag } } as any,
    url: new URL(`https://gameonpaper.com/year/${year}/team/333`), cache: { set: () => {} },
}) as any;

describe('loadSeasonTeam behind team-pass-direction', () => {
    test('on: one read for the team-season; off or NFL: no read', async () => {
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        passReads.length = 0;
        passAnswer = plays2026;
        const on: any = await loadSeasonTeam(fakeAstro(true), 'cfb');
        expect(passReads).toEqual([[2026, '333', 'cfb']]);
        expect(on.passPlays.off).toHaveLength(317);
        passReads.length = 0;
        const off: any = await loadSeasonTeam(fakeAstro(false), 'cfb');
        const nfl: any = await loadSeasonTeam(fakeAstro(true), 'nfl');
        expect(passReads).toEqual([]);
        expect(off.passPlays).toBeNull();
        expect(nfl.passPlays).toBeNull();
    });

    test('a season before 2025 reads nothing and stays cacheable', async () => {
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        passReads.length = 0;
        const sets: unknown[] = [];
        const astro = fakeAstro(true, '2024');
        astro.cache = { set: (v: unknown) => sets.push(v) };
        const r: any = await loadSeasonTeam(astro, 'cfb');
        expect(passReads).toEqual([]);
        expect(r.passPlays).toBeNull();
        expect(sets).not.toContain(false);
        const r2025: any = await loadSeasonTeam(fakeAstro(true, '2025'), 'cfb');
        expect(passReads).toEqual([[2025, '333', 'cfb']]);
        expect(r2025.passPlays.off).toHaveLength(317);
    });

    test('a failed read keeps the render out of the cache', async () => {
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        passAnswer = null;
        const sets: unknown[] = [];
        const astro = fakeAstro(true);
        astro.cache = { set: (v: unknown) => sets.push(v) };
        astro.response = { headers: new Headers() };
        const r: any = await loadSeasonTeam(astro, 'cfb');
        expect(r.passPlays).toBeNull();
        expect(sets).toContain(false);
        expect(astro.response.headers.get('Cache-Control')).toBe('no-store');
        passAnswer = plays2026;
    });
});
