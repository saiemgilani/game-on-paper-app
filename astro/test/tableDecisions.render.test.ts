/**
 * The render-level guards for the table-reconciliation decisions (#264 review).
 *
 * Each block below is the assertion for one decision, taken from the rendered
 * markup rather than from component source, and each one goes red if the change
 * it guards is reverted:
 *
 *  T2  the Production table's overall "Yards" row is the sum of the pass and
 *      rush "Yards" rows right under it, in BOTH twins.
 *  F4  both Binion twins round through one shared guard.
 *
 * Findings 3, 5 and 6 (the Binion league gate, wiring the #252 sections, and
 * server-rendering the v2 Team Stats island) are owned by #270, so nothing here
 * pins them.
 *
 * The fixtures are the real, offline `usage-*` processed games shared with #264.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { metricDecimalPoints, roundNumber } from '../src/utils/misc';
import { withoutUsageSections } from '../src/utils/usage';
import { loadGzJson, locals, parseTable, tableWithHeading } from './helpers/tables';

// The `usage-*` pair, not the older `game-*` pair: those predate the
// 2026-09-14 NFL processor repairs, so their NFL payload carries no parsed
// rush/pass yardage and no `penalized_team` -- neither of which the live
// processor still omits, and both of which these assertions read.
const FIXTURES = {
    cfb: { file: 'usage-cfb-400869270.json.gz', id: 400869270 },
    nfl: { file: 'usage-nfl-401872922.json.gz', id: 401872922 },
} as const;
type Lg = keyof typeof FIXTURES;

// The classic page is rendered through `retrieveProcessedGame`, the route's own
// path, by answering the processor fetch with the fixture for the league in
// the URL.
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const m = String(url).match(/\/(cfb|nfl)\/(\d+)\/process/);
        if (!m) throw new Error(`unexpected fetch in test: ${url}`);
        return new Response(JSON.stringify(loadGzJson(FIXTURES[m[1] as Lg].file)), {
            status: 200, headers: { 'content-type': 'application/json' },
        });
    },
}));

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => null,
    retrieveMatchupHistory: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

/**
 * The rendered Production table of one twin, with the box score rows it was
 * rendered from.
 *
 * classic: the whole page, from the route's own processed game. v2: the
 * `SituationalSection` island, which is what owns the column list there -- the
 * v2 page mounts it `client:only`, so no whole-page render can see inside it.
 */
async function renderProduction(twin: 'classic' | 'v2', league: Lg, heading = 'Production'): Promise<{ teams: any[], box: any, table: string }> {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const g: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
    let html: string;
    let box: any;
    if (twin === 'classic') {
        const Page = (await import('../src/components/game/classic/GamePage.astro')).default;
        html = await container.renderToString(Page, {
            props: { id: String(FIXTURES[league].id), game: g, league },
            request: new Request(`https://gameonpaper.com/game/${FIXTURES[league].id}`),
            locals: locals(league),
        });
        box = g.advBoxScore;
    } else {
        const spans = withoutUsageSections(g.advBoxScoreSpans);
        const Section = (await import('../src/components/game/metrics/SituationalSection.svelte')).default as any;
        html = await container.renderToString(Section, {
            props: { season: g.season.year, advBoxScoreSpans: spans, league, percentiles: [] },
            locals: locals(league),
        });
        // the island opens on the whole game, the `all` span
        box = spans.all;
    }
    const table = tableWithHeading(html, heading);
    expect(table, `the ${twin} twin renders a ${heading} table`).toBeTruthy();
    return { teams: box.team, box, table: table! };
}

/** The Production column list, in the order both twins pass it. */
const OVERALL_YARDS = 1;   // after scrimmage_plays
const PASS_YARDS = 6;      // after passes
const RUSH_YARDS = 11;     // after rushes

for (const league of Object.keys(FIXTURES) as Lg[]) {
    describe(`[${league}] the Production total is the sum of the rows under it`, () => {
        for (const twin of ['classic', 'v2'] as const) {
            test(`${twin}: the overall Yards row equals rush + pass`, async () => {
                const { teams, table } = await renderProduction(twin, league);
                const body = parseTable(table).rows.slice(1);

                // The three rows a reader sees, each labelled "Yards": the
                // overall total and the pass and rush rows under it.
                const row = (i: number, what: string) => {
                    const [label, ...cells] = body[i];
                    expect(label, `row ${i} is the ${what} Yards row`).toBe('Yards');
                    expect(cells, `${what} Yards has one cell per team`).toHaveLength(teams.length);
                    return cells;
                };
                const total = row(OVERALL_YARDS, 'overall');
                const pass = row(PASS_YARDS, 'pass');
                const rush = row(RUSH_YARDS, 'rush');

                teams.forEach((team, t) => {
                    // what is displayed adds up, which is the whole claim the
                    // header makes -- read entirely out of the rendered table
                    expect(Number(total[t]), `team ${team.pos_team}: displayed total = displayed rush + pass`)
                        .toBe(Number(pass[t]) + Number(rush[t]));
                    // ...and it is the payload's own parsed yardage, not a
                    // coincidence of the rendering
                    expect(pass[t], `team ${team.pos_team} pass yards`).toBe(String(team.pass_yards));
                    expect(rush[t], `team ${team.pos_team} rush yards`).toBe(String(team.rush_yards));
                    expect(total[t], `team ${team.pos_team} total yards`)
                        .toBe(String(team.pass_yards + team.rush_yards));
                });
                // ...and the assertion has teeth: on this fixture the payload's
                // own off_yards (ESPN's per-play statYardage) is a different
                // number, so a revert to it fails here.
                expect(teams.some((team) => team.off_yards !== team.pass_yards + team.rush_yards),
                    'the fixture disagrees with off_yards on at least one team').toBe(true);
                // ESPN's total is kept, as the tooltip the other numeral cells use
                expect(table).toContain(`title="ESPN: ${teams[0].off_yards}"`);
            }, 60_000);
        }
    });
}

describe('the Binion box rounds through one guard in both twins', () => {
    test('an explicit 0 decimal places survives; a missing one means 1', () => {
        // `decimalPoints || 1` -- what the v2 twin used to do -- turns the 0 into a 1.
        expect(metricDecimalPoints(0)).toBe(0);
        expect(metricDecimalPoints(2)).toBe(2);
        expect(metricDecimalPoints(undefined)).toBe(1);
        expect(metricDecimalPoints(null)).toBe(1);
    });

    test('both twins render the same numbers from the same box score', async () => {
        const g = loadGzJson(FIXTURES.cfb.file);
        const props = { season: g.season.year, advancedBoxScore: g.advBoxScore, percentiles: [] };
        const [classic, v2] = await Promise.all([
            container.renderToString((await import('../src/components/game/classic/BinionBoxScore.astro')).default, { props, locals: locals('cfb') }),
            container.renderToString((await import('../src/components/game/metrics/BinionBoxScore.svelte')).default as any, { props: { ...props, league: 'cfb' }, locals: locals('cfb') }),
        ]);
        const strip = (h: string) => parseTable(h).rows.slice(1).map((r) => r.join('|'));
        expect(strip(v2)).toEqual(strip(classic));
    }, 60_000);

    test('TeamMetricsTable honours an explicit 0 decimal places in both twins', async () => {
        // CodeRabbit on #269: both twins still read `decimalPoints || 1`, the drift
        // the shared guard exists to stop. A caller asking for 0 places gets 0.
        const g = loadGzJson(FIXTURES.cfb.file);

        const props = {
            title: 'Test', teamKey: 'pos_team', season: g.season.year, columns: ['yards_per_play'],
            teamBoxScores: g.advBoxScore.team, useSuffix: true, decimalPoints: 0,
        };
        const svelteProps = {
            title: 'Test', teamKey: 'pos_team', season: g.season.year, columns: ['yards_per_play'],
            box: { team: g.advBoxScore.team }, useSuffix: true, decimalPoints: 0,
        };
        const [classic, v2] = await Promise.all([
            container.renderToString((await import('../src/components/game/classic/TeamMetricsTable.astro')).default, { props, locals: locals('cfb') }),
            container.renderToString((await import('../src/components/game/metrics/TeamMetricsTable.svelte')).default as any, { props: svelteProps, locals: locals('cfb') }),
        ]);
        for (const html of [classic, v2]) {
            const cells = [...html.matchAll(/<td class="numeral"[^>]*>([^<]*)<\/td>/g)].map((m) => m[1].trim());
            expect(cells.length).toBeGreaterThan(0);
            for (const c of cells) expect(c, html.slice(0, 200)).toMatch(/^-?[\d\.]+$/);
        }
    }, 60_000);
});

// Explainer wave-2 audit (turnover luck F4/F5): the Turnovers table rounded the
// expected-turnover model to whole numbers (BYU-Iowa State read "0 | -0" for an
// expected margin of +0.22, and a luck of 19 the page's own numbers made 20),
// and the Defensive table asked for a `PD` key the processor never emits.
for (const league of Object.keys(FIXTURES) as Lg[]) {
    describe(`[${league}] turnover and defensive rows show what the payload holds`, () => {
        for (const twin of ['classic', 'v2'] as const) {
            test(`${twin}: expected turnovers, margin and luck to two decimals; pass breakups from the payload`, async () => {
                const { box, table } = await renderProduction(twin, league, 'Turnovers');
                const rows = parseTable(table).rows.slice(1);
                const row = (label: string) => rows.find((r) => r[0] === label)?.slice(1);
                const cells = { 'Expected Turnovers': 'expected_turnovers', 'Expected Turnover Margin': 'expected_turnover_margin', 'Turnover Luck (pts)': 'turnover_luck' };
                for (const [label, key] of Object.entries(cells)) {
                    expect(row(label), label).toEqual(box.turnover.map((t: any) => roundNumber(t[key], 2, 2)));
                }
                expect(parseTable(table).rows.flat()).not.toContain('-0');
                // the fixtures have fractional expectations, so whole-number rounding fails here
                expect(box.turnover.some((t: any) => !Number.isInteger(t.expected_turnovers))).toBe(true);

                const def = parseTable((await renderProduction(twin, league, 'Defensive')).table).rows.slice(1);
                const pbu = def.find((r) => r[0] === 'Pass Breakups')?.slice(1);
                expect(pbu).toEqual(box.defensive.map((t: any) => String(t.pass_breakups)));
                expect(box.defensive.some((t: any) => t.pass_breakups > 0), 'the fixture has breakups').toBe(true);
            }, 60_000);
        }
    });
}

describe('roundNumber never prints a negative zero', () => {
    test('a value that rounds to zero reads 0, whatever its sign', () => {
        expect(roundNumber(-0.22, 2, 0)).toBe('0');
        expect(roundNumber(-0.004, 3, 2)).toBe('0.00');
        expect(roundNumber(-0.6, 2, 0)).toBe('-1');
        expect(roundNumber(-0.22, 2, 2)).toBe('-0.22');
    });
});
