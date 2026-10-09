/**
 * The Binion box's percentile column, both twins (audit 2026-10-08, lanes A/B).
 *
 *  A1  each game is ranked against its OWN season's ladder; a season without
 *      one falls back to the nearest earlier season, and an outage is not a
 *      missing season.
 *  A2  Yards/Dropback counts sack yards, the basis of the `yardsdropback` ladder.
 *  A4  a team with no red-zone snaps gets a dash, not "0%, 5th %ile" in purple.
 *  A5  a value tied with a run of breakpoints ranks at the run's middle.
 *  A6  the v2 box shows a quarter or half unranked.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { yardsPerDropback } from '../src/utils/misc';
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
const LADDERS: Record<string, any[] | 'outage'> = { '2024': ladder(2024), '2026': ladder(2026), '2027': [], '2031': 'outage' };
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

    for (const twin of ['classic', 'v2'] as const) {
        test(`${twin} game page asks for the game's season, not 2025`, async () => {
            const { retrieveProcessedGame } = await import('../src/resources/python');
            const game = await retrieveProcessedGame(GAME_ID, 30);
            const Page = (await import(twin === 'classic' ? '../src/components/game/classic/GamePage.astro' : '../src/components/game/GamePage.astro')).default;
            const html = await container.renderToString(Page, { props: { id: GAME_ID, game }, request: new Request(`https://gameonpaper.com/game/${GAME_ID}`), locals: locals('cfb') });
            expect(game.season.year).toBe(2024);
            expect(seasonsAsked()).toEqual(['2024']);
            if (twin === 'classic') expect(html).toContain('performances in that stat in 2024');
        }, 60_000);
    }
});

// One game's box: the home team (2) has no red-zone snaps, a sack-inclusive
// passing line and no `sack_yards`; the away team (1) has the lot.
const box = {
    team: [
        { pos_team: 1, scrimmage_plays: 60, yards_per_play: 6, passes: 30, pass_yards: 240, sack_yards: -20, yards_per_pass: 8, EPA_per_play: 0, EPA_passing_per_play: 0, EPA_rushing_per_play: 0, EPA_explosive_rate: 0.1, rushing_stuff_rate: 0.2 },
        { pos_team: 2, scrimmage_plays: 60, yards_per_play: 5, passes: 30, pass_yards: 195, yards_per_pass: 6.5, EPA_per_play: 0, EPA_passing_per_play: 0, EPA_rushing_per_play: 0, EPA_explosive_rate: 0.1, rushing_stuff_rate: 0.2 },
    ],
    situational: [
        { pos_team: 1, EPA_success_rate: 0.45, EPA_success_rate_third: 0.4, EPA_success_rz: 3, EPA_success_rate_rz: 0.5 },
        { pos_team: 2, EPA_success_rate: 0.45, EPA_success_rate_third: 0.4, EPA_success_rz: null, EPA_success_rate_rz: null },
    ],
    defensive: [{ def_pos_team: 1, havoc_total_rate: 0.15 }, { def_pos_team: 2, havoc_total_rate: 0.15 }],
};

async function renderBox(twin: 'classic' | 'v2', props: Record<string, unknown>, league = 'cfb'): Promise<string> {
    const C = (await import(twin === 'classic' ? '../src/components/game/classic/BinionBoxScore.astro' : '../src/components/game/metrics/BinionBoxScore.svelte')).default as any;
    return container.renderToString(C, { props: { season: 2025, advancedBoxScore: box, percentiles: ladder(2025), ...props, ...(twin === 'v2' ? { league } : {}) }, locals: locals(league) });
}

const cells = (html: string, label: string) => parseTable(html).rows.find((r) => r[0] === label)!.slice(1);
const rowHtml = (html: string, label: string) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?${label}(?:(?!</tr>)[\\s\\S])*?</tr>`))![0];

for (const twin of ['classic', 'v2'] as const) {
    describe(`[${twin}] Binion box cells`, () => {
        test('A5: a value tied with breakpoints 55-65 is the 60th, not the 65th', async () => {
            expect(cells(await renderBox(twin, {}), 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
        });

        test('A5: an untied value keeps its rank', async () => {
            // 0.4 sits on breakpoint 40 alone: 39 below it, one tie, rounds to the 40th
            expect(cells(await renderBox(twin, {}), '3rd Down Success Rate')).toEqual(['40% 40th %ile', '40% 40th %ile']);
        });

        test('A4: no red-zone snaps is a dash, unranked and unshaded', async () => {
            const html = await renderBox(twin, {});
            expect(cells(html, 'Red Zone Success Rate')[1]).toBe('—');
            const td = rowHtml(html, 'Red Zone Success Rate').match(/<td class="numeral[^>]*>[^<]*—/)![0];
            expect(td).not.toContain('hulk-bg');
        });

        test('A2: Yards/Dropback counts the sack yards, and falls back without them', async () => {
            // away: (240 + -20) / 30 = 7.33, ranked 73rd on the yardsdropback ladder; home: no
            // sack_yards in the payload, so the payload's yards_per_pass as before
            expect(cells(await renderBox(twin, {}), 'Yards/Dropback')).toEqual(['7.33 73rd %ile', '6.50 65th %ile']);
        });

        test('no ladder: values only, no percentile, no shading, no caption', async () => {
            const html = await renderBox(twin, { percentiles: [] });
            expect(html).not.toContain('%ile');
            expect(html).not.toContain('hulk-bg');
            expect(html).not.toContain('Cell colors reflect');
            expect(cells(html, 'Yards/Dropback')).toEqual(['7.33', '6.50']);
        });
    });
}

describe('A6: the v2 box ranks the full game only', () => {
    test('a quarter shows its values unranked', async () => {
        const html = await renderBox('v2', { span: 'q1' });
        expect(html).not.toContain('%ile');
        expect(html).not.toContain('hulk-bg');
        expect(html).not.toContain('Cell colors reflect');
        expect(cells(html, 'Red Zone Success Rate')).toEqual(['50%', '—']);
    });

    test('the full game keeps them', async () => {
        const html = await renderBox('v2', { span: 'all' });
        expect(html).toContain('Cell colors reflect');
        expect(cells(html, 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
    });
});

test('nfl: the v2 box ranks against the NFL ladder of the season it is given', async () => {
    const html = await renderBox('v2', { percentiles: ladder(2025) }, 'nfl');
    expect(html).toContain('single-game NFL performances in that stat in 2025');
    expect(cells(html, 'Red Zone Success Rate')[0]).toBe('50% 60th %ile');
});

describe('A2: yardsPerDropback', () => {
    test('sack yards present: (pass yards + sack yards) / dropbacks', () => {
        expect(yardsPerDropback({ passes: 30, pass_yards: 240, sack_yards: -20, yards_per_pass: 8 })).toBeCloseTo(220 / 30, 10);
    });
    test('sack yards arrive negative (yds_sacked), so they are added, not subtracted', () => {
        expect(yardsPerDropback({ passes: 10, pass_yards: 70, sack_yards: -14 })).toBeCloseTo(5.6, 10);
        expect(yardsPerDropback({ passes: 10, pass_yards: 70, sack_yards: 0 })).toBeCloseTo(7, 10);
    });
    test('sack yards absent: the payload yards_per_pass, as before', () => {
        expect(yardsPerDropback({ passes: 30, pass_yards: 240, yards_per_pass: 8 })).toBe(8);
        expect(yardsPerDropback({ passes: 30, pass_yards: 240, sack_yards: null, yards_per_pass: 8 })).toBe(8);
    });
    test('no dropbacks: no sack-inclusive figure, and null when the payload has none either', () => {
        expect(yardsPerDropback({ passes: 0, pass_yards: 0, sack_yards: 0 })).toBeNull();
        expect(yardsPerDropback(undefined)).toBeNull();
    });
});
