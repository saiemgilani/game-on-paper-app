import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatRank, generateColorRampValue, roundNumber } from '../src/utils/misc';
import { FIVE_FACTORS } from '../src/utils/fiveFactors';

// The season team page's Five Factors panel, rendered from the Data API's real
// 2025 team_summaries rows (fixtures/team-summaries-{cfb,nfl}-2025.json). The
// expected cell text is rebuilt here from the raw fixture value, so a formatter
// that drifts from "roundNumber, % for the rates, Own/Opp for a yardline, signed
// margins" goes red.
const fixture = (league: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-summaries-${league}-2025.json`, import.meta.url)).toString()).data;
const rows: Record<string, any[]> = { cfb: fixture('cfb'), nfl: fixture('nfl') };

// `override`, when set, is the whole row list the API returns (`[]` = no row for the team)
const feed: { override: any[] | null; calls: any[] } = { override: null, calls: [] };

vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string, league = 'cfb') =>
        ({ id: String(id), location: league === 'nfl' ? 'Kansas City' : 'Alabama', color: '000000', alternateColor: 'ffffff' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [], record: '0-0' }),
    retrievePlayerSummaries: async () => [],
    retrieveTeamSummaries: async (req: any) => {
        feed.calls.push(req);
        return feed.override ?? rows[req.league].filter((r) => r.team_id === req.team_id);
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => {
    feed.override = null;
    feed.calls = [];
});

async function render(league: 'cfb' | 'nfl', id: string, preview: boolean) {
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/year/[year]/team/[id].astro' : '../src/pages/year/[year]/team/[id].astro');
    return container.renderToString(Page, {
        params: { year: '2025', id },
        request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/year/2025/team/${id}`),
        // the pages never read cfContext; the cast keeps astro check quiet about it
        locals: (preview ? { preview: true } : {}) as App.Locals,
    });
}

const panelOf = (html: string) => html.split('id="five-factors-panel"')[1]?.split('</table>')[0];
/** Each body `<td>`: its class attribute and its text, tags stripped (a `>` inside a quoted
 *  attribute, as in the `(EPA > 0)` hover, is not the tag's end). */
const tds = (panel: string) => [...panel.split('<tbody')[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)]
    .map((m) => ({ cls: m[1].match(/class="([^"]*)"/)?.[1] ?? '', text: m[2].replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '').replace(/\s+/g, ' ').trim() }));

/** The Own/Opp rule TeamMetricsTable prints drive start with, spelled out here rather than imported. */
const yardline = (val: number) => `${val >= 50 ? 'Own' : 'Opp'} ${roundNumber(val >= 50 ? 100 - val : val, 2, 0)}`;

// row label -> [columns, is a rate, decimals, is a yardline], in table order
const EXPECTED: [string, string[], boolean, number, boolean?][] = [
    ['Efficiency', ['success_off', 'success_def', 'success_margin'], true, 1],
    ['Explosiveness', ['explosive_off', 'explosive_def', 'explosive_margin'], true, 1],
    ['Field Position', ['drive_start_ep_off', 'drive_start_ep_def', 'drive_start_ep_margin'], false, 2],
    // off/def print as a yardline; the margin is a signed yards delta to one decimal
    ['Start (yds)', ['start_position_off', 'start_position_def', 'start_position_margin'], false, 1, true],
    ['Finishing Drives', ['pts_per_opp_off', 'pts_per_opp_def', 'pts_per_opp_margin'], false, 2],
    ['Turnovers', ['turnovers_off', 'turnovers_def', 'turnover_margin'], false, 2],
    ['Expected', ['expected_turnovers_off', 'expected_turnovers_def', 'expected_turnover_margin'], false, 2],
    ['Luck (pts)', ['turnover_luck_off', 'turnover_luck_def', 'turnover_luck'], false, 2],
    ['Havoc', ['havoc_off', 'havoc_def', 'havoc_margin'], true, 1],
    ['EPA / Game', ['havoc_EPAgame_off', 'havoc_EPAgame_def', 'havoc_EPAgame_margin'], false, 2],
];
/** Where a row's cells start in `tds()`: five cells a row (label, metric, off/def/margin). */
const at = (label: string) => 5 * EXPECTED.findIndex(([l]) => l === label);

describe.each([
    ['cfb', '333', 134, 'Data shown is from FBS vs FBS games only.'],
    ['nfl', '12', 32, 'Data shown is from regular season games only.'],
] as const)('%s season team page, flag on', (league, id, teamCount, subtitle) => {
    test('30 value cells: the fixture value, its #rank, shaded by rank', async () => {
        const html = await render(league, id, true);
        const panel = panelOf(html);
        expect(panel, 'panel').toBeTruthy();
        expect(panel).toContain('Five Factors');
        expect(panel).toContain(subtitle);
        // the credit line Akshay asked for, with the explainer link
        expect(panel).toContain("Bill Connelly</a>'s");
        expect(panel).toContain('sbnation.com/college-football/2017/10/13/16457830');
        const row = rows[league].find((r) => r.team_id === Number(id));
        const cells = tds(panel);
        expect(cells.length).toBe(EXPECTED.length * 5);
        EXPECTED.forEach(([label, cols, rate, fixed, yards], i) => {
            expect(cells[i * 5].text).toBe(label);
            // the metric column names what the three cells measure; hidden below md
            expect(cells[i * 5 + 1].text).toBe(FIVE_FACTORS[i].metric);
            expect(cells[i * 5 + 1].cls).toContain('d-none d-md-table-cell');
            cols.forEach((k, j) => {
                const v = rate ? row[k] * 100 : row[k];
                const sign = j === 2 && v >= 0 ? '+' : '';
                const shown = yards && j < 2 ? yardline(v) : `${sign}${roundNumber(v, 2, fixed)}${rate ? '%' : ''}`;
                const want = `${shown} #${formatRank(row[`${k}_rank`])}`;
                const cell = cells[i * 5 + 2 + j];
                expect(cell.text, k).toBe(want);
                expect(cell.cls, k).toContain('numeral');
                const ramp = generateColorRampValue(row[`${k}_rank`], teamCount, true);
                if (ramp) expect(cell.cls, k).toContain(ramp);
                else expect(cell.cls, k).not.toContain('hulk-');
            });
        });
    }, 60_000);

    test('the request adds the five-factor columns to the default select', async () => {
        await render(league, id, true);
        const { teamSummaryColumns } = await import('../src/resources/sdv');
        const { fiveFactorColumns } = await import('../src/utils/fiveFactors');
        expect(feed.calls).toHaveLength(1);
        expect(feed.calls[0].columns).toEqual([...teamSummaryColumns(league), ...fiveFactorColumns()]);
    }, 60_000);
});

describe('cfb season team page, Five Factors edge cases', () => {
    test('a tied rank prints the site\'s T- form', async () => {
        // Auburn's turnovers_off_rank is 13.5 in the fixture: averaged ties
        const cells = tds(panelOf(await render('cfb', '2', true)));
        expect(cells[at('Turnovers') + 2].text).toBe('0.82 #T-13');
    }, 60_000);

    test('a good rank is green and a poor one purple', async () => {
        // literals from Alabama's real row, not re-derived with the ramp call the
        // component makes: turnovers_off_rank 12, start_position_off_rank 105
        const cells = tds(panelOf(await render('cfb', '333', true)));
        expect(cells[at('Turnovers') + 2].text).toBe('0.79 #12');
        expect(cells[at('Turnovers') + 2].cls).toContain('hulk-bg-level-9');
        // 71.9 yards to goal is Alabama's own 28, printed as the box score prints it
        expect(cells[at('Start (yds)') + 2].text).toBe('Own 28 #105');
        expect(cells[at('Start (yds)') + 4].text).toBe('-0.3 #69');
        expect(cells[at('Start (yds)') + 2].cls).toContain('hulk-bg-level-2');
    }, 60_000);

    test('no team_summaries row: no panel at all, rather than a table of dashes', async () => {
        feed.override = [];
        const html = await render('cfb', '333', true);
        expect(html).toContain('Alabama'); // the page itself still renders
        expect(html).not.toContain('five-factors-panel');
    }, 60_000);

    test('a null value renders an em dash with no rank and no shading', async () => {
        const row = rows.cfb.find((r) => r.team_id === 333);
        // the rank is left in place: a null value must not be shaded or ranked by it
        feed.override = [{ ...row, pts_per_opp_off: null, turnover_margin: null }];
        const cells = tds(panelOf(await render('cfb', '333', true)));
        for (const cell of [cells[at('Finishing Drives') + 2], cells[at('Turnovers') + 4]]) {
            expect(cell.text).toBe('—');
            expect(cell.cls).not.toContain('hulk-');
        }
    }, 60_000);

    test('flag off: no panel, and the request is exactly the pre-flag one', async () => {
        const html = await render('cfb', '333', false);
        expect(html).not.toContain('five-factors');
        expect(html).not.toContain('Five Factors');
        expect(feed.calls).toHaveLength(1);
        expect(feed.calls[0].columns).toBeUndefined();
        expect(feed.calls[0]).toEqual({ season: 2025, team_id: 333, league: 'cfb' });
    }, 60_000);
});
