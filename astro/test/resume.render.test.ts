import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// The season team page's Record panel, rendered from the two schedule bodies the
// Data API returned for each team-season (fixtures/schedule-*-2025.json). The real
// retrieveTeamSeasonInformation runs; only the fetch layer is faked, so the test
// also counts the schedule requests the page makes.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString());
const bodies: Record<string, any> = { cfb: fixture('schedule-cfb-333-2025.json'), nfl: fixture('schedule-nfl-12-2025.json') };

// `override` replaces a side's body ({ away_id: { data: [] } } drops every away game)
const feed: { league: string; override: Record<string, any>; schedule: string[] } = { league: 'cfb', override: {}, schedule: [] };

vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = String(url);
        const side = /\/(?:espn_)?schedule\?.*\b(home_id|away_id)=/.exec(u)?.[1];
        if (side) feed.schedule.push(u);
        const body = side ? (feed.override[side] ?? bodies[feed.league][side]) : { data: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string, league = 'cfb') =>
        ({ id: String(id), location: league === 'nfl' ? 'Kansas City' : 'Alabama', color: '000000', alternateColor: 'ffffff' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSummaries: async () => [],
    retrieveTeamSummaries: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => {
    feed.override = {};
    feed.schedule = [];
});

async function render(league: 'cfb' | 'nfl', id: string, preview: boolean) {
    feed.league = league;
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/year/[year]/team/[id].astro' : '../src/pages/year/[year]/team/[id].astro');
    return container.renderToString(Page, {
        params: { year: '2025', id },
        request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/year/2025/team/${id}`),
        locals: (preview ? { preview: true } : {}) as App.Locals,
    });
}

const panelOf = (html: string) => html.split('id="record-splits-panel"')[1]?.split('</table>')[0];
const strip = (s: string) => s.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '').replace(/\s+/g, ' ').trim();
const ths = (panel: string) => [...panel.split('<thead')[1].split('</thead>')[0].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g)]
    .map((m) => ({ cls: m[1].match(/class="([^"]*)"/)?.[1] ?? '', text: strip(m[2]) }));
/** Each body row: its class, and its cells' class, inner HTML and text. */
const trs = (panel: string) => [...panel.split('<tbody')[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((r) => ({
    cls: r[1].match(/class="([^"]*)"/)?.[1] ?? '',
    cells: [...r[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({ cls: m[1].match(/class="([^"]*)"/)?.[1] ?? '', html: m[2], text: strip(m[2]) })),
}));
const rowOf = (rows: ReturnType<typeof trs>, label: string) => rows.find((r) => r.cells[0].text === label)!;

// a record, a percentage, a signed margin: one number per cell
const SHAPES = [/^\d+-\d+(-\d+)?$/, /^\d+\.\d%$/, /^[+-]\d+\.\d$/];

describe.each([
    ['cfb', '333', ['Home', 'Away', 'Neutral site', 'Conference', 'One-score', 'vs FBS', 'vs Ranked', 'Overall'], ['11-4', '73.3%', '+10.3']],
    ['nfl', '12', ['Home', 'Away', 'Neutral site', 'Division', 'One-score', 'Overall'], ['6-11', '35.3%', '+2.0']],
] as const)('%s season team page, flag on', (league, id, labels, overall) => {
    test('a Record section in the team table shape', async () => {
        const panel = panelOf(await render(league, id, true));
        expect(panel, 'panel').toBeTruthy();
        expect(panel).toContain('Record');
        expect(panel).toContain('All completed games, postseason included.');
        // the season tables' population line would be wrong here: every game counts
        expect(panel).not.toContain('Data shown is from');
        expect(ths(panel).map((t) => t.text)).toEqual(['', 'Record', 'Win %', 'Avg Margin']);
        const rows = trs(panel);
        expect(rows.map((r) => r.cells[0].text)).toEqual([...labels]);
        for (const r of rows) {
            expect(r.cells, r.cells[0].text).toHaveLength(4);
            expect(r.cells[0].cls).toBe('text-left text-nowrap');
            r.cells.slice(1).forEach((c, j) => {
                expect(c.cls, `${r.cells[0].text} ${j}`).toBe('numeral text-center');
                expect(c.text, `${r.cells[0].text} ${j}`).toMatch(SHAPES[j]);
            });
        }
        // Overall closes the table as its total row
        const total = rowOf(rows, 'Overall');
        expect(total.cls).toBe('table-secondary');
        expect(total.cells[0].html).toContain('<strong>Overall</strong>');
        expect(total.cells.slice(1).map((c) => c.text)).toEqual([...overall]);
        expect(rowOf(rows, 'One-score').cells[0].html).toContain('title="Final margin of 8 points or fewer"');
    }, 60_000);

    test('no extra request: the page still makes its two schedule reads', async () => {
        await render(league, id, true);
        expect(feed.schedule).toHaveLength(2);
        expect(feed.schedule.some((u) => u.includes(`home_id=${id}`))).toBe(true);
        expect(feed.schedule.some((u) => u.includes(`away_id=${id}`))).toBe(true);
    }, 60_000);
});

describe('cfb Record section edge cases', () => {
    test('the real rows: Alabama 5-3 vs ranked, 0-2 on neutral sites', async () => {
        const rows = trs(panelOf(await render('cfb', '333', true)));
        expect(rowOf(rows, 'vs Ranked').cells[1].text).toBe('5-3');
        expect(rowOf(rows, 'Neutral site').cells[1].text).toBe('0-2');
        expect(rowOf(rows, 'Neutral site').cells[2].text).toBe('0.0%');
    }, 60_000);

    test('a split with no games is left out', async () => {
        // the SEC title game and the Rose Bowl are the only neutral-site games
        const off = (side: string) => ({ data: bodies.cfb[side].data.filter((g: any) => !g.neutral_site) });
        feed.override = { home_id: off('home_id'), away_id: off('away_id') };
        const labels = trs(panelOf(await render('cfb', '333', true))).map((r) => r.cells[0].text);
        expect(labels).not.toContain('Neutral site');
        expect(labels).toContain('Home');
        expect(labels).toContain('Away');
    }, 60_000);

    test('no completed games yet: no panel at all', async () => {
        const unplayed = (side: string) => ({ data: bodies.cfb[side].data.map((g: any) => ({ ...g, completed: false })) });
        feed.override = { home_id: unplayed('home_id'), away_id: unplayed('away_id') };
        const html = await render('cfb', '333', true);
        expect(html).toContain('Alabama');
        expect(html).not.toContain('record-splits');
    }, 60_000);

    test.each(['home_id', 'away_id'])('a failed %s read (an empty side) is half a schedule: no panel', async (side) => {
        feed.override = { [side]: { data: [] } };
        const html = await render('cfb', '333', true);
        expect(html).toContain('Alabama');
        expect(html).not.toContain('record-splits');
    }, 60_000);

    test('flag off: no panel, and still exactly the two schedule reads', async () => {
        const html = await render('cfb', '333', false);
        expect(html).toContain('Alabama');
        expect(html).not.toContain('record-splits');
        expect(html).not.toContain('All completed games');
        expect(feed.schedule).toHaveLength(2);
        expect(feed.schedule.some((u) => u.includes('home_id=333'))).toBe(true);
        expect(feed.schedule.some((u) => u.includes('away_id=333'))).toBe(true);
    }, 60_000);
});
