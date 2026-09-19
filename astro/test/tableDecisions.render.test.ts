/**
 * The render-level guards for the table-reconciliation decisions (#264 review).
 *
 * Each block below is the assertion for one decision, taken from the rendered
 * page rather than from component source, and each one goes red if the change
 * it guards is reverted:
 *
 *  T2  the Production table's overall "Yards" row is the sum of the pass and
 *      rush "Yards" rows right under it, in BOTH twins.
 *  F3  the Binion box is gated to the cfb in both twins, so promoting
 *      `game-page-v2` adds no section to an NFL game page.
 *  F4  both Binion twins round through one shared guard.
 *  F5  `TraditionalTeamStats` and `PenaltyBreakdown` are rendered by v2 (#252)
 *      and by neither classic page.
 *  F6  the v2 Team Stats tables are in the SERVED html -- the panel used to be
 *      `client:only`, so no SSR-level check could see any of it.
 *
 * The fixtures are the real, offline `usage-*` processed games shared with #264.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { metricDecimalPoints } from '../src/utils/misc';
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

// Both pages are rendered through `retrieveProcessedGame`, the route's own
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

/** A whole game page, from the route's own processed game. Fresh per call: both twins mutate it. */
async function renderPage(twin: 'classic' | 'v2', league: Lg): Promise<{ g: any, html: string }> {
    const { retrieveProcessedGame } = await import('../src/resources/python');
    const g: any = await retrieveProcessedGame(FIXTURES[league].id, 30, league);
    const Page = twin === 'classic'
        ? (await import('../src/components/game/classic/GamePage.astro')).default
        : (await import('../src/components/game/GamePage.astro')).default;
    const html = await container.renderToString(Page, {
        props: { id: String(FIXTURES[league].id), game: g, league },
        request: new Request(`https://gameonpaper.com/game/${FIXTURES[league].id}`),
        locals: locals(league),
    });
    return { g, html };
}

/** Distinguishing markup of the sections whose presence is under test. */
const BINION = 'Concept from Robert Binion';
const TRADITIONAL = 'Traditional Stats';
const PENALTIES = 'Accepted penalties only.';
/** The eight team-metric tables, by the heading each one leads with. */
const METRIC_TITLES = ['Expected Points', 'Production', 'Rushing', 'Explosiveness', 'Situational', 'Drives', 'Defensive', 'Turnovers'];

for (const league of Object.keys(FIXTURES) as Lg[]) {
    describe(`[${league}] the Production total is the sum of the rows under it`, () => {
        for (const twin of ['classic', 'v2'] as const) {
            test(`${twin}: the overall Yards row equals rush + pass`, async () => {
                const { g, html } = await renderPage(twin, league);
                const table = tableWithHeading(html, 'Production');
                expect(table, `the ${twin} page renders a Production table`).toBeTruthy();
                const body = parseTable(table!).rows.slice(1);
                // scrimmage_plays, then the overall Yards row
                const [label, ...cells] = body[1];
                expect(label, 'the second row is the overall Yards row').toBe('Yards');
                const teams: any[] = g.advBoxScore.team;
                expect(cells).toHaveLength(teams.length);
                teams.forEach((row, t) => {
                    expect(cells[t], `team ${row.pos_team} total yards`)
                        .toBe(String(row.pass_yards + row.rush_yards));
                });
                // ...and the assertion has teeth: on this fixture the payload's
                // own off_yards (ESPN's per-play statYardage) is a different
                // number, so a revert to it fails here.
                expect(teams.some((row) => row.off_yards !== row.pass_yards + row.rush_yards),
                    'the fixture disagrees with off_yards on at least one team').toBe(true);
                // ESPN's total is kept, as the tooltip the other numeral cells use
                expect(table).toContain(`title="ESPN: ${teams[0].off_yards}"`);
            }, 60_000);
        }
    });

    describe(`[${league}] the Binion box is gated the same way in both twins`, () => {
        // The classic gate is the public behaviour; v2 now matches it, so
        // promoting game-page-v2 changes nothing a reader sees.
        test('classic renders it for the cfb only', async () => {
            const { html } = await renderPage('classic', league);
            expect(html.includes(BINION)).toBe(league === 'cfb');
        }, 60_000);

        test('v2 renders it for the cfb only', async () => {
            const { html } = await renderPage('v2', league);
            expect(html.includes(BINION)).toBe(league === 'cfb');
        }, 60_000);
    });

    describe(`[${league}] the v2 Team Stats panel is server-rendered`, () => {
        test('all eight metric tables are in the served html', async () => {
            const { html } = await renderPage('v2', league);
            for (const title of METRIC_TITLES) {
                expect(tableWithHeading(html, title), `the served html carries the "${title}" table`).toBeTruthy();
            }
        }, 60_000);

        test('the period selector is still there, hydrating over the rendered table', async () => {
            const { html } = await renderPage('v2', league);
            expect(html).toContain('id="span-stats"');
            expect(html).not.toContain('client:only');
        }, 60_000);
    });

    describe(`[${league}] the #252 sections are rendered by v2 and by neither classic page`, () => {
        test('v2 renders TraditionalTeamStats and PenaltyBreakdown', async () => {
            const { html } = await renderPage('v2', league);
            expect(html, 'Traditional Stats').toContain(TRADITIONAL);
            expect(html, 'Penalties').toContain(PENALTIES);
        }, 60_000);

        test('classic renders neither', async () => {
            const { html } = await renderPage('classic', league);
            expect(html).not.toContain(TRADITIONAL);
            expect(html).not.toContain(PENALTIES);
        }, 60_000);
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
});
