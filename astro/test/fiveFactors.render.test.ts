import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatRank, generateColorRampValue, roundNumber } from '../src/utils/misc';

// The season team page's Five Factors panel, rendered from the Data API's real
// 2025 team_summaries rows (fixtures/team-summaries-{cfb,nfl}-2025.json). The
// expected cell text is rebuilt here from the raw fixture value, so a formatter
// that drifts from "roundNumber, % for the rates, signed margins" goes red.
const fixture = (league: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-summaries-${league}-2025.json`, import.meta.url)).toString()).data;
const rows: Record<string, any[]> = { cfb: fixture('cfb'), nfl: fixture('nfl') };

const feed: { override: any | null; calls: any[] } = { override: null, calls: [] };

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
        return feed.override ? [feed.override] : rows[req.league].filter((r) => r.team_id === req.team_id);
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
/** Each body `<td>`: its class attribute and its text, tags stripped. */
const tds = (panel: string) => [...panel.split('<tbody')[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)]
    .map((m) => ({ cls: m[1].match(/class="([^"]*)"/)?.[1] ?? '', text: m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() }));

// row label -> [columns, is a rate, decimals], in table order
const EXPECTED: [string, string[], boolean, number][] = [
    ['Efficiency', ['success_off', 'success_def', 'success_margin'], true, 1],
    ['Explosiveness', ['explosive_off', 'explosive_def', 'explosive_margin'], true, 1],
    ['Field Position', ['start_position_off', 'start_position_def', 'start_position_margin'], false, 1],
    ['Finishing Drives', ['pts_per_opp_off', 'pts_per_opp_def', 'pts_per_opp_margin'], false, 2],
    ['Turnovers', ['turnovers_off', 'turnovers_def', 'turnover_margin'], false, 2],
];

describe.each([
    ['cfb', '333', 134, 'Data shown is from FBS vs FBS games only.'],
    ['nfl', '12', 32, 'Data shown is from regular season games only.'],
] as const)('%s season team page, flag on', (league, id, teamCount, subtitle) => {
    test('15 value cells: the fixture value, its #rank, shaded by rank', async () => {
        const html = await render(league, id, true);
        const panel = panelOf(html);
        expect(panel, 'panel').toBeTruthy();
        expect(panel).toContain('Five Factors');
        expect(panel).toContain(subtitle);
        const row = rows[league].find((r) => r.team_id === Number(id));
        const cells = tds(panel);
        expect(cells.length).toBe(5 * 4);
        EXPECTED.forEach(([label, cols, rate, fixed], i) => {
            expect(cells[i * 4].text).toBe(label);
            cols.forEach((k, j) => {
                const v = rate ? row[k] * 100 : row[k];
                const sign = j === 2 && v >= 0 ? '+' : '';
                const want = `${sign}${roundNumber(v, 2, fixed)}${rate ? '%' : ''} #${formatRank(row[`${k}_rank`])}`;
                const cell = cells[i * 4 + 1 + j];
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
        // Alabama's pts_per_opp_def_rank is 61.5 in the fixture: averaged ties
        const cells = tds(panelOf(await render('cfb', '333', true)));
        expect(cells[3 * 4 + 2].text).toBe('3.97 #T-61');
    }, 60_000);

    test('a null value renders an em dash with no rank and no shading', async () => {
        const row = rows.cfb.find((r) => r.team_id === 333);
        // the rank is left in place: a null value must not be shaded or ranked by it
        feed.override = { ...row, pts_per_opp_off: null, turnover_margin: null };
        const cells = tds(panelOf(await render('cfb', '333', true)));
        for (const cell of [cells[3 * 4 + 1], cells[4 * 4 + 3]]) {
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
