/**
 * The Binion box's percentile column, both twins (audit 2026-10-08, lanes A/B).
 *
 *  A1  each game is ranked against its OWN season's ladder; a season without
 *      one falls back to the nearest earlier season, and an outage is not a
 *      missing season.
 *  A2  Yards/Dropback is sportsdataverse's sack-inclusive `yards_per_dropback`,
 *      the basis of the `yardsdropback` ladder; a payload without it shows
 *      `yards_per_pass`, as before. The frontend computes neither.
 *  A4  a team with no red-zone snaps gets a dash, not "0%, 5th %ile" in purple.
 *  A5  a value tied with a run of breakpoints ranks at the run's middle.
 *  A6  the v2 box shows a quarter or half unranked.
 *  A7  before week 4 of a season still being played, a game is ranked against
 *      the previous season's ladder (the current one is a few weeks thin).
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { CURRENT_YEAR } from '../src/utils/constants';
import { boxScorePercentile } from '../src/utils/binionBox';
import { locals, parseTable } from './helpers/tables';

// A ladder per season: 99 rows, `pctile` 0.01-0.99. Red-zone success has the
// shape of the real 2025 ladder around 0.5: breakpoints 55-65 all equal 0.5.
const ladder = (season: number) => Array.from({ length: 99 }, (_, k) => {
    const i = k + 1;
    return {
        season, pctile: i / 100, GEI: i / 20,
        EPAplay: i / 100 - 0.5, EPAdropback: i / 100 - 0.5, EPArush: i / 100 - 0.5,
        success: i / 100, explosive: i / 100, play_stuffed: i / 100, havoc: i / 100, third_down_success: i / 100,
        yardsplay: i / 10, yardsdropback: i / 10,
        red_zone_success: i <= 54 ? i / 200 : i <= 65 ? 0.5 : 0.5 + (i - 65) / 100,
    };
});

const GAME_ID = 401729745; // a 2024 game
const LADDERS: Record<string, any[] | 'outage'> = { '2024': ladder(2024), '2025': ladder(2025), '2026': ladder(2026), '2027': [], '2031': 'outage' };
const percentileRequests: string[] = [];
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = String(url);
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
        if (u.includes(`/cfb/${GAME_ID}/process`)) {
            return new Response(gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString(), { status: 200 });
        }
        if (u.includes('/percentiles?')) {
            percentileRequests.push(u);
            const rows = LADDERS[new URL(u).searchParams.get('season') ?? ''] ?? [];
            return rows === 'outage' ? json({ detail: 'upstream down' }, 503) : json({ count: rows.length, data: rows });
        }
        if (u.includes('sportsdataverse.org')) return json({ data: [] });
        throw new Error(`unexpected fetch in test: ${u}`);
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => { percentileRequests.length = 0; });

const seasonsAsked = () => percentileRequests.map((u) => new URL(u).searchParams.get('season'));

describe('A1: each game is ranked against its own season', () => {
    test('a season with a ladder gets that ladder', async () => {
        const { retrievePercentiles } = await import('../src/resources/sdv');
        const rows = await retrievePercentiles(2024, undefined, undefined, 'cfb');
        expect(rows).toHaveLength(99);
        expect(rows[0].season).toBe(2024);
        expect(seasonsAsked()).toEqual(['2024']);
    });

    test('a season without one yet falls back to the nearest earlier season', async () => {
        // requestSDV answers an empty season as {data: []}, so the old catch-only fallback never ran
        const { retrievePercentiles } = await import('../src/resources/sdv');
        const rows = await retrievePercentiles(2027, undefined, undefined, 'cfb');
        expect(rows[0]?.season).toBe(2026);
        expect(seasonsAsked()).toEqual(['2027', '2026']);
    });

    test('an outage is not a missing season: one request, no walk back through every year', async () => {
        const { retrievePercentiles } = await import('../src/resources/sdv');
        expect(await retrievePercentiles(2031, undefined, undefined, 'cfb')).toEqual([]);
        expect(seasonsAsked()).toEqual(['2031']);
    });

    test('nothing before the lookback floor', async () => {
        const { retrievePercentiles } = await import('../src/resources/sdv');
        expect(await retrievePercentiles(2003, undefined, undefined, 'cfb')).toEqual([]);
        expect(seasonsAsked()).toEqual(['2003']);
    });

    test('nfl asks its own API for the game season', async () => {
        const { retrievePercentiles } = await import('../src/resources/sdv');
        await retrievePercentiles(2025, undefined, undefined, 'nfl');
        expect(percentileRequests[0]).toContain('/v1/nfl/percentiles?season=2025');
    });

    test(`game page asks for the game's season, not 2025`, async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30);
        const Page = (await import('../src/components/game/GamePage.astro')).default;
        const html = await container.renderToString(Page, { props: { id: GAME_ID, game }, request: new Request(`https://gameonpaper.com/game/${GAME_ID}`), locals: locals('cfb') });
        expect(game.season.year).toBe(2024);
        expect(seasonsAsked()).toEqual(['2024']);
    }, 60_000);
});

// One game's box: the home team (2) has no red-zone snaps and comes from a payload
// processed before sportsdataverse emitted `yards_per_dropback`; the away team (1)
// has the lot. Each `yards_per_pass` counts a sack as 0 yards.
const box = {
    team: [
        { pos_team: 1, scrimmage_plays: 60, yards_per_play: 6, passes: 30, pass_yards: 240, sack_yards: -20, yards_per_pass: 8, yards_per_dropback: 220 / 30, EPA_per_play: 0, EPA_passing_per_play: 0, EPA_rushing_per_play: 0, EPA_explosive_rate: 0.1, rushing_stuff_rate: 0.2 },
        { pos_team: 2, scrimmage_plays: 60, yards_per_play: 5, passes: 30, pass_yards: 195, sack_yards: -15, yards_per_pass: 6.5, EPA_per_play: 0, EPA_passing_per_play: 0, EPA_rushing_per_play: 0, EPA_explosive_rate: 0.1, rushing_stuff_rate: 0.2 },
    ],
    situational: [
        { pos_team: 1, EPA_success_rate: 0.45, EPA_success_rate_third: 0.4, EPA_success_rz: 3, EPA_success_rate_rz: 0.5 },
        { pos_team: 2, EPA_success_rate: 0.45, EPA_success_rate_third: 0.4, EPA_success_rz: null, EPA_success_rate_rz: null },
    ],
    defensive: [{ def_pos_team: 1, havoc_total_rate: 0.15 }, { def_pos_team: 2, havoc_total_rate: 0.15 }],
};

async function renderBox(props: Record<string, unknown>, league = 'cfb'): Promise<string> {
    const C = (await import('../src/components/game/metrics/BinionBoxScore.svelte')).default as any;
    return container.renderToString(C, { props: { season: 2025, advancedBoxScore: box, percentiles: ladder(2025), ...props, ...({ league }) }, locals: locals(league) });
}

const cells = (html: string, label: string) => parseTable(html).rows.find((r) => r[0] === label)!.slice(1);
const rowHtml = (html: string, label: string) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?${label}(?:(?!</tr>)[\\s\\S])*?</tr>`))![0];

describe(`Binion box cells`, () => {
    test('A5: a value tied with breakpoints 55-65 is the 60th, not the 65th', async () => {
        expect(cells(await renderBox({}), 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
    });

    test('A5: an untied value keeps its rank', async () => {
        // 0.4 sits on breakpoint 40 alone: 39 below it, one tie, rounds to the 40th
        expect(cells(await renderBox({}), '3rd Down Success Rate')).toEqual(['40% 40th %ile', '40% 40th %ile']);
    });

    test('A4: no red-zone snaps is a dash, unranked and unshaded', async () => {
        const html = await renderBox({});
        expect(cells(html, 'Red Zone Success Rate')[1]).toBe('—');
        const td = rowHtml(html, 'Red Zone Success Rate').match(/<td class="numeral[^>]*>[^<]*—/)![0];
        expect(td).not.toContain('hulk-bg');
    });

    test("A2: Yards/Dropback is the payload's yards_per_dropback, else its yards_per_pass", async () => {
        // away: yards_per_dropback (240 + -20) / 30 = 7.33, ranked 73rd on the yardsdropback
        // ladder; home: none in the payload, so yards_per_pass as before. Not rebuilt from
        // the home team's pass and sack yards, which would read (195 + -15) / 30 = 6.00
        expect(cells(await renderBox({}), 'Yards/Dropback')).toEqual(['7.33 73rd %ile', '6.50 65th %ile']);
    });

    test('no ladder: values only, no percentile, no shading, no caption', async () => {
        const html = await renderBox({ percentiles: [] });
        expect(html).not.toContain('%ile');
        expect(html).not.toContain('hulk-bg');
        expect(html).not.toContain('Cell colors reflect');
        expect(cells(html, 'Yards/Dropback')).toEqual(['7.33', '6.50']);
    });
});

describe('A5: a tie ranks at the mean of its one-based ranks', () => {
    // `success` breakpoint k is k/100 (k = 1..99); `run` flattens breakpoints lo..hi to one value
    const run = (lo: number, hi: number, v: number) =>
        ladder(2025).map((r, k) => (k + 1 >= lo && k + 1 <= hi ? { ...r, success: v } : r));
    const rank = (rows: any[], value: number) => boxScorePercentile(rows, 'EPA_success', value).pctl;

    test('an even-length run (65-72) is the 69th: mean 68.5, rounded up, not 68', () => {
        expect(rank(run(65, 72, 0.65), 0.65)).toBe(69);
    });

    test('an odd-length run (55-65) is its middle, the 60th', () => {
        expect(rank(run(55, 65, 0.55), 0.55)).toBe(60);
    });

    test('a singleton tie at breakpoint k is the kth', () => {
        expect(rank(ladder(2025), 0.4)).toBe(40);
    });

    test('between breakpoints: the count below', () => {
        // 0.405 sits between breakpoints 40 and 41
        expect(rank(ladder(2025), 0.405)).toBe(40);
    });
});

describe('A6: the v2 box ranks the full game only', () => {
    test('a quarter shows its values unranked', async () => {
        const html = await renderBox({ span: 'q1' });
        expect(html).not.toContain('%ile');
        expect(html).not.toContain('hulk-bg');
        expect(html).not.toContain('Cell colors reflect');
        expect(cells(html, 'Red Zone Success Rate')).toEqual(['50%', '—']);
    });

    test('the full game keeps them', async () => {
        const html = await renderBox({ span: 'all' });
        expect(html).toContain('Cell colors reflect');
        expect(cells(html, 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
    });
});

test('nfl: the v2 box ranks against the NFL ladder of the season it is given', async () => {
    const html = await renderBox({ percentiles: ladder(2025) }, 'nfl');
    expect(html).toContain('single-game NFL performances in that stat in 2025');
    expect(cells(html, 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
});

describe('A7: the previous season ranks the first weeks of a season still being played', () => {
    // `current: null` leaves ESPN's flag off the header
    const header = (year: number, week: number, type = 2, current: boolean | null = true) =>
        ({ season: { year, type, ...(current === null ? {} : { current }) }, week });

    test.each([
        ['week 2 of the season being played: the previous season', header(2026, 2), 2025],
        ['week 0 (college)', header(2026, 0), 2025],
        ['week 3, the last thin week', header(2026, 3), 2025],
        ['week 4 on: its own season', header(2026, 4), 2026],
        ['a later week', header(2026, 10), 2026],
        ['the postseason (its weeks restart at 1)', header(2026, 1, 3), 2026],
        ['the preseason', header(2026, 3, 1), 2025],
        ['a back season, even in week 2: its own, complete ladder', header(2024, 2, 2, false), 2024],
        ['no `current` flag: the current year is the season being played', header(CURRENT_YEAR, 2, 2, null), CURRENT_YEAR - 1],
        ['no `current` flag, an earlier year: its own', header(CURRENT_YEAR - 2, 2, 2, null), CURRENT_YEAR - 2],
    ])('%s', async (_, h, expected) => {
        const { percentileSeason } = await import('../src/resources/sdv');
        expect(percentileSeason(h as any)).toBe(expected);
    });

    test(`a week-2 game of the season being played asks for the previous season`, async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = structuredClone(await retrieveProcessedGame(GAME_ID, 30));
        game.season = { ...game.season, year: 2026 };
        game.header.season = { year: 2026, type: 2, current: true };
        game.header.week = 2;
        const Page = (await import('../src/components/game/GamePage.astro')).default;
        const html = await container.renderToString(Page, { props: { id: GAME_ID, game }, request: new Request(`https://gameonpaper.com/game/${GAME_ID}`), locals: locals('cfb') });
        expect(seasonsAsked()).toEqual(['2025']);
    }, 60_000);
});
