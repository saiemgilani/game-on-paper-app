import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { availableMetrics, opponentAverages, opponentBars } from '../src/utils/gameSet';
import { formatMetricValue, pickGameColors, STANDARD_THEME_COLOR } from '../src/utils/misc';

// Results by Opponent ('vs-opponent') on the season team page, rendered from the
// Data API's real 2025 bodies (fixtures/team-opponent-splits-2025.json): both sides
// of team_opponent_splits and the schedule, for Alabama and Kansas City.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/team-opponent-splits-2025.json', import.meta.url)).toString());
const splitsOf = (league: string) => ({ team: fixture[league].team_id.data, opponent: fixture[league].opponent_id.data });
const eventsOf = (league: string) => [...fixture[league].schedule.home_id.data, ...fixture[league].schedule.away_id.data];

// `override`, when set, is what the splits read returns
const feed: { override: any | null; calls: any[] } = { override: null, calls: [] };

vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    retrieveTeamInformation: async (id: string, league = 'cfb') =>
        ({ id: String(id), location: league === 'nfl' ? 'Kansas City' : 'Alabama', color: '9e1b32', alternateColor: 'ffffff' }),
}));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrieveTeamSeasonInformation: async (_season: string, _id: string, league = 'cfb') => ({ team: null, events: eventsOf(league), record: '0-0' }),
    retrievePlayerSummaries: async () => [],
    retrieveTeamSummaries: async () => [],
    retrieveTeamOpponentSplits: async (season: number, id: string, league = 'cfb') => {
        feed.calls.push({ season, id, league });
        return feed.override ?? splitsOf(league);
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
        locals: (preview ? { preview: true } : {}) as App.Locals,
    });
}

// Astro serialises each island prop as a [type, value] pair: 0 = value/object, 1 = array.
const decode = (v: any): any => {
    if (!Array.isArray(v)) return v;
    const [t, x] = v;
    if (t === 1) return x.map(decode);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, w]) => [k, decode(w)]));
    return x;
};
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const islandTag = (html: string) => [...html.matchAll(/<astro-island\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('/OpponentBarChart.svelte"'));
const propsOf = (tag: string) => decode([0, JSON.parse(unescape(tag.match(/\sprops="([^"]*)"/)![1]))]);

describe.each([
    ['cfb', '333', 'Data shown is from every game, FCS opponents and the postseason included.'],
    ['nfl', '12', 'Data shown is from regular season games only.'],
] as const)('%s season team page, flag on', (league, id, subtitle) => {
    test('the panel, and an island handed exactly the bars and averages it draws', async () => {
        const html = await render(league, id, true);
        expect(html).toContain('id="vs-opponent-panel"');
        expect(html).toContain('Results by Opponent');
        expect(html).toContain(subtitle);
        // the dashed line is explained; Margin, being obvious, is not (Akshay on #308)
        expect(html).toContain('The dashed line is the season average, weighted by plays.');
        expect(html).not.toContain('Margin is the team');
        expect(feed.calls).toEqual([{ season: 2025, id, league }]);

        const tag = islandTag(html);
        expect(tag, 'island').toBeTruthy();
        // idle, not visible: a full-page capture never scrolls it into view, so it would stay blank
        expect(tag).toContain('client="idle"');
        const props = propsOf(tag!);
        expect(Object.keys(props).sort()).toEqual(['colors', 'metrics']);
        const splits = splitsOf(league), events = eventsOf(league);
        // one entry per metric the season has, in GAME_METRICS order, each with its own bars and
        // averages; the 2025 bodies predate the pass and rush columns, so per-play EPA and success only
        expect(props.metrics.map((m: any) => m.key)).toEqual(['EPAplay', 'success']);
        expect(props.metrics).toEqual(availableMetrics(splits).map((m) => ({
            key: m.key,
            format: m.format,
            bars: opponentBars(splits, events, m.column),
            avg: opponentAverages(splits, m.column),
        })));
        expect(props.metrics[0].bars).toHaveLength(splits.team.length);
        // one decision per theme: the team (bars) against the theme blue (the line).
        // On white, the mocked crimson and the blue both read and stand apart, so
        // both are kept as they are; dark is whatever the shared rule lifts them to.
        expect(props.colors.light).toEqual({ bar: '#9e1b32', line: STANDARD_THEME_COLOR });
        const { dark } = pickGameColors([null, { color: '9e1b32', alternateColor: 'ffffff' }], { color: STANDARD_THEME_COLOR });
        expect(props.colors.dark).toEqual({ bar: dark.home, line: dark.away });
    }, 60_000);

    test('server-rendered controls: the metric and Raw/Margin selects, and the raw season average', async () => {
        const html = await render(league, id, true);
        const panel = html.split('id="vs-opponent-panel"')[1];
        expect(panel).toMatch(/<select id="vs-opponent-metric"[^>]*class="form-select form-select-sm"/);
        expect(panel).toMatch(/<option value="EPAplay"[^>]*>EPA\/Play<\/option>\s*<option value="success"[^>]*>Success %<\/option>/);
        expect(panel).toMatch(/<option value="raw"[^>]*>Raw<\/option>\s*<option value="margin"[^>]*>Margin<\/option>/);
        const avg = opponentAverages(splitsOf(league), 'epa_per_play').raw;
        expect(panel).toContain(`Season average: ${formatMetricValue(avg, 'num2')}`);
        // the chart's data as a table for screen readers: one row per game, the canvas hidden from them
        expect(panel).toMatch(/<canvas[^>]*aria-hidden="true"/);
        const table = panel.split('<table class="visually-hidden">')[1]?.split('</table>')[0].replace(/<!--[\s\S]*?-->/g, '');
        expect(table, 'table').toBeTruthy();
        expect(table).toContain(`<caption>Off EPA/Play by game. Season average: ${formatMetricValue(avg, 'num2')}</caption>`);
        const bars = opponentBars(splitsOf(league), eventsOf(league), 'epa_per_play');
        const rows = [...table!.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><\/tr>/g)];
        expect(rows.map((r) => r[1])).toEqual(bars.map((b) => b.title));
        expect(rows.map((r) => r[2])).toEqual(bars.map((b) => formatMetricValue(b.raw, 'num2')));
    }, 60_000);
});

describe('Results by Opponent, gates', () => {
    test('flag off: no panel and no team_opponent_splits read', async () => {
        const html = await render('cfb', '333', false);
        expect(html).toContain('Alabama');
        expect(html).not.toContain('vs-opponent');
        expect(html).not.toContain('Results by Opponent');
        expect(feed.calls).toHaveLength(0);
    }, 60_000);

    test('a season with the pass and rush columns: all six metrics in the select', async () => {
        const f = JSON.parse(readFileSync(new URL('./fixtures/team-opponent-splits-2026.json', import.meta.url)).toString());
        feed.override = { team: f.nfl.team_id.data, opponent: f.nfl.opponent_id.data };
        const panel = (await render('nfl', '12', true)).split('id="vs-opponent-panel"')[1];
        const options = [...panel.split('</select>')[0].matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
        expect(options).toEqual([
            ['EPAplay', 'EPA/Play'], ['EPAplay_pass', 'EPA/Dropback'], ['EPAplay_rush', 'EPA/Rush'],
            ['success', 'Success %'], ['success_pass', 'Pass Success %'], ['success_rush', 'Rush Success %'],
        ]);
    }, 60_000);

    test('no rate in any game: no panel', async () => {
        const { team, opponent } = splitsOf('nfl');
        feed.override = { team: team.map((r: any) => ({ ...r, epa_per_play: null, success_rate: null })), opponent };
        const html = await render('nfl', '12', true);
        expect(html).toContain('Kansas City');
        expect(html).not.toContain('vs-opponent-panel');
    }, 60_000);

    test('no games yet: no panel', async () => {
        feed.override = { team: [], opponent: [] };
        const html = await render('nfl', '12', true);
        expect(html).toContain('Kansas City');
        expect(html).not.toContain('vs-opponent-panel');
    }, 60_000);
});
