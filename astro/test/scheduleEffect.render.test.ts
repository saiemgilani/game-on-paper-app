import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { effectSentence, scheduleEffect, type LedgerRow } from '../src/utils/scheduleEffect';

// B2/B3, 'cfb-schedule-effect': the Schedule Effect panel on real 2025 ledger rows (fixtures/README.md:
// team-adjustment-ledger-2025.json.gz). The season values the panel adds up to are checked against the published
// cfb_team_summaries_2025 net_adj_epa (read 2026-11-26), not against the rows' own column.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/team-adjustment-ledger-2025.json.gz', import.meta.url))).toString());
const rowsOf = (team: string): LedgerRow[] => fixture.rows.filter((r: LedgerRow) => String(r.team_id) === team);
const PUBLISHED = { '99': 0.139188, '61': 0.342839 }; // cfb_team_summaries_2025 net_adj_epa, 6 dp

describe('scheduleEffect on real ledger rows', () => {
    test.each(Object.entries(PUBLISHED))('team %s: raw + schedule is the published season Adj EPA/Play', (team, published) => {
        const e = scheduleEffect(rowsOf(team), fixture.events)!;
        expect(e.raw + e.schedule).toBeCloseTo(published, 6);
        expect(e.adjusted).toBeCloseTo(published, 6);
        expect(e.games).toBe(rowsOf(team).length);
        expect(e.rows.map((r) => r.opponent).every((n) => !/^\d+$/.test(n))).toBe(true); // every opponent named
    });

    test('LSU 2025: the schedule carries most of the value, and the drivers are the three largest schedule parts', () => {
        const e = scheduleEffect(rowsOf('99'), fixture.events)!;
        expect(e.schedule / e.adjusted).toBeGreaterThan(0.8);
        const parts = rowsOf('99').map((r) => Math.abs(r.schedule_contribution)).sort((a, b) => b - a).slice(0, 3);
        expect(e.drivers.map((d) => Math.abs(d.schedule_contribution))).toEqual(parts);
        expect(effectSentence('LSU', e)).toBe(`LSU's schedule adds +${e.schedule.toFixed(3)} EPA/play: raw +${e.raw.toFixed(3)}, adjusted +${e.adjusted.toFixed(3)}.`);
    });

    test('rows that do not add up to their season value, or none, draw nothing', () => {
        const broken = rowsOf('99').map((r, i) => (i === 0 ? { ...r, schedule_contribution: r.schedule_contribution + 0.01 } : r));
        expect(scheduleEffect(broken, fixture.events)).toBeNull();
        expect(scheduleEffect([], fixture.events)).toBeNull();
        expect(scheduleEffect(null)).toBeNull();
    });
});

describe('the ScheduleEffect panel', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create(); });
    const render = async (rows: LedgerRow[]) => {
        const { default: Panel } = await import('../src/components/team/ScheduleEffect.astro');
        return container.renderToString(Panel, { props: { team: 'LSU', rows, events: fixture.events } });
    };

    test('renders the split, three drivers and one table row per game', async () => {
        const html = await render(rowsOf('99'));
        expect(html).toContain('id="schedule-effect"');
        expect(html).toMatch(/LSU(&#39;|')s schedule adds \+0\.123 EPA\/play/);
        expect((html.match(/<li>/g) ?? []).length).toBe(3);
        const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
        expect((body.match(/<tr>/g) ?? []).length).toBe(rowsOf('99').length);
        expect(html).toContain(`Averaged over ${rowsOf('99').length} FBS games`);
    });

    test('no rows, no panel', async () => {
        expect(await render([])).not.toContain('schedule-effect');
    });
});

const ledgerReads: unknown[][] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async () => new Response('{"data":[]}', { status: 200 }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => ({ team: null, events: fixture.events }),
    retrievePlayerSummaries: async () => [],
    retrieveTeamOpponentSplits: async () => null,
    retrieveTeamTendencies: async () => [],
    retrieveTeamAdjustmentLedger: async (...a: unknown[]) => { ledgerReads.push(a); return rowsOf('99'); },
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string) => ({ id, location: 'LSU', name: 'Tigers', abbreviation: 'LSU', color: '461d7c', alternateColor: 'fdd023' }),
}));
const fakeAstro = (flag: boolean) => ({
    params: { year: '2025', id: '99' }, locals: { flagOverrides: { 'cfb-schedule-effect': flag } } as any,
    url: new URL('https://gameonpaper.com/year/2025/team/99'), cache: { set: () => {} },
}) as any;

describe('loadSeasonTeam behind cfb-schedule-effect', () => {
    test('on: one ledger read for the team-season; off or NFL: no read', async () => {
        const { loadSeasonTeam } = await import('../src/routes/seasonTeam');
        ledgerReads.length = 0;
        const on: any = await loadSeasonTeam(fakeAstro(true), 'cfb');
        expect(ledgerReads).toEqual([[2025, '99', 'cfb']]);
        expect(on.ledger).toHaveLength(rowsOf('99').length);
        ledgerReads.length = 0;
        const off: any = await loadSeasonTeam(fakeAstro(false), 'cfb');
        const nfl: any = await loadSeasonTeam(fakeAstro(true), 'nfl');
        expect(ledgerReads).toEqual([]);
        expect(off.ledger).toBeNull();
        expect(nfl.ledger).toBeNull();
    });
});
