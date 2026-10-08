import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatNumber, formatPercent } from '../src/utils/misc';
import { teamSplitColumns } from '../src/utils/teamSplits';

// The season team page's Situational Splits panel, rendered from the Data API's
// real 2025 team_tendencies rows (fixtures/team-tendencies-{cfb-333,nfl-12}-2025.json).
const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`./fixtures/team-tendencies-${name}-2025.json`, import.meta.url)).toString()).data;
const rows: Record<string, any[]> = { cfb: fixture('cfb-333'), nfl: fixture('nfl-12') };

// `override`, when set, is the whole row list the API returns (`[]` = no row for the team)
const feed: { override: any[] | null; calls: any[]; order: string[] } = { override: null, calls: [], order: [] };

vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string, league = 'cfb') =>
        ({ id: String(id), location: league === 'nfl' ? 'Kansas City' : 'Alabama', color: '000000', alternateColor: 'ffffff' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSeasonInformation: async () => ({ team: null, events: [], record: '0-0' }),
    // each player read takes a macrotask, so a tendency read that waits for them starts after one ends
    retrievePlayerSummaries: async () => {
        feed.order.push('player-start');
        await new Promise((r) => setTimeout(r, 0));
        feed.order.push('player-end');
        return [];
    },
    retrieveTeamSummaries: async () => [],
    retrieveTeamTendencies: async (req: any) => {
        feed.order.push('tendency-start');
        feed.calls.push(req);
        return feed.override ?? rows[req.league];
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => {
    feed.override = null;
    feed.calls = [];
    feed.order = [];
});

async function render(league: 'cfb' | 'nfl', id: string, preview: boolean, query = '') {
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/year/[year]/team/[id].astro' : '../src/pages/year/[year]/team/[id].astro');
    return container.renderToString(Page, {
        params: { year: '2025', id },
        request: new Request(`https://gameonpaper.com${league === 'nfl' ? '/nfl' : ''}/year/2025/team/${id}${query}`),
        locals: (preview ? { preview: true } : {}) as App.Locals,
    });
}

const panelOf = (html: string) => html.split('id="team-splits-panel"')[1]?.split('</table>')[0];
/** each body row: its attributes and its cells' class + text, tags stripped */
const trs = (panel: string) => [...panel.split('<tbody')[1].matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({
    attrs: m[1],
    cells: [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({
        cls: c[1].match(/class="([^"]*)"/)?.[1] ?? '',
        text: c[2].replace(/<[^>]*>/g, '').trim(),
    })),
}));
const side = (panel: string, s: 'off' | 'def') => trs(panel).filter((r) => r.attrs.includes(`data-side="${s}"`));

describe.each([
    ['cfb', '333', 18, 'All regular-season and postseason games, FCS opponents included.'],
    ['nfl', '12', 17, 'All regular-season and postseason games.'],
] as const)('%s season team page, flag on', (league, id, count, note) => {
    test('one row per split and side; Offense shows, Defense waits', async () => {
        const panel = panelOf(await render(league, id, true));
        expect(panel, 'panel').toBeTruthy();
        expect(panel).toContain('Situational Splits');
        expect(panel).toContain(note);
        // the team_tendencies population, not the team_summaries one
        expect(panel).not.toContain('Data shown is from');
        const off = side(panel, 'off');
        const def = side(panel, 'def');
        expect(off).toHaveLength(count);
        expect(def).toHaveLength(count);
        expect(off.every((r) => !r.attrs.includes('d-none'))).toBe(true);
        expect(def.every((r) => r.attrs.includes('d-none'))).toBe(true);
        expect(off.map((r) => r.cells[0].text).includes('vs Ranked')).toBe(league === 'cfb');
        expect(panel).toMatch(/<option value="off" selected/);
    }, 60_000);

    test('Overall prints the fixture through formatNumber / formatPercent, numeral cells', async () => {
        const panel = panelOf(await render(league, id, true));
        const row = rows[league][0];
        for (const [s, p] of [['off', ''], ['def', 'def_']] as const) {
            const overall = side(panel, s)[0];
            expect(overall.attrs).toContain('data-split="overall"');
            expect(overall.cells.map((c) => c.text)).toEqual([
                'Overall', formatNumber(row[`${p}plays`], 0), formatPercent(row[`${p}pass_rate`]),
                formatNumber(row[`${p}epa_per_play`], 2), formatPercent(row[`${p}success_rate`]),
            ]);
            expect(overall.cells.slice(1).every((c) => c.cls.includes('numeral'))).toBe(true);
            // no producer rank for split rates yet, so no shading
            expect(overall.cells.some((c) => c.cls.includes('hulk-'))).toBe(false);
        }
    }, 60_000);

    test('one request: the team\'s row, with the split columns', async () => {
        await render(league, id, true);
        expect(feed.calls).toEqual([{ season: 2025, league, columns: teamSplitColumns(league), teamId: Number(id) }]);
    }, 60_000);

    test('the tendency read starts before any player read finishes (no added round trip)', async () => {
        await render(league, id, true);
        expect(feed.order.indexOf('tendency-start')).toBeGreaterThanOrEqual(0);
        expect(feed.order.indexOf('tendency-start')).toBeLessThan(feed.order.indexOf('player-end'));
    }, 60_000);
});

describe('cfb season team page, Situational Splits edge cases', () => {
    test('?side=def opens on Defense', async () => {
        const panel = panelOf(await render('cfb', '333', true, '?side=def'));
        expect(panel).toMatch(/<option value="def" selected/);
        expect(side(panel, 'def').every((r) => !r.attrs.includes('d-none'))).toBe(true);
        expect(side(panel, 'off').every((r) => r.attrs.includes('d-none'))).toBe(true);
    }, 60_000);

    test('no team_tendencies row: no panel', async () => {
        feed.override = [];
        const html = await render('cfb', '333', true);
        expect(html).toContain('Alabama');
        expect(html).not.toContain('team-splits');
    }, 60_000);

    test('flag off: no team_tendencies request and no panel', async () => {
        const html = await render('cfb', '333', false);
        expect(feed.calls).toHaveLength(0);
        expect(html).not.toContain('team-splits-panel');
        expect(html).not.toContain('Situational Splits');
    }, 60_000);
});
