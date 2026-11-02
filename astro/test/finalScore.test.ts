/**
 * IF-6: the "first time this final score happened" chip. Pure rules, the Data API reads
 * (population + both orientations), and the GameHeader render on both leagues' fixtures.
 */
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { earliestFinal, finalScore, finalScoreFirst, firstFinalLabel } from '../src/utils/finalScore';
import { loadGzJson } from './helpers/tables';

const net = vi.hoisted(() => ({ urls: [] as string[], rows: (_u: URL): any[] => [] }));
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const u = new URL(String(url));
        net.urls.push(u.toString());
        const body = u.pathname.endsWith('/meta') ? { datasets: {} } : { data: net.rows(u) };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

describe('rules', () => {
    test('winner first; a tie is (score, score)', () => {
        expect(finalScore(22, 56)).toEqual([56, 22]);
        expect(finalScore(56, 22)).toEqual([56, 22]);
        expect(finalScore(17, 17)).toEqual([17, 17]);
    });
    test('the earliest row wins; none is null', () => {
        expect(earliestFinal([])).toBeNull();
        expect(earliestFinal([{ game_id: 2, start_date: '2010-09-01T00:00:00Z' }, { game_id: 1, start_date: '2003-09-01T00:00:00Z' }])?.game_id).toBe(1);
    });
    test('first only when this game is the earliest; ids compare as strings', () => {
        expect(finalScoreFirst({ game_id: 401769074, start_date: '2026-01-10' }, '401769074')).toBe(true);
        expect(finalScoreFirst({ game_id: 242902325, start_date: '2004-10-16' }, '401769074')).toBe(false);
        // not in the table yet, or outside the population (FBS vs FCS): never first
        expect(finalScoreFirst(null, '401769074')).toBe(false);
    });
    test('the label states the span', () => {
        expect(firstFinalLabel('cfb', 22, 56)).toBe('First 56-22 final (FBS vs FBS games since 2001)');
        expect(firstFinalLabel('nfl', 39, 34)).toBe('First 39-34 final (since 1999)');
        expect(firstFinalLabel('nba', 100, 90)).toBeNull();
    });
});

describe('retrieveFirstFinal', () => {
    const scheduleReads = () => net.urls.map((s) => new URL(s)).filter((u) => /\/(schedule|espn_schedule)$/.test(u.pathname));

    test('cfb: both orientations, completed FBS vs FBS games only, earliest of the two', async () => {
        net.urls = [];
        net.rows = (u) => u.searchParams.get('home_points') === '41'
            ? [{ game_id: 2, start_date: '2012-09-01T00:00:00.000Z' }]
            : [{ game_id: 1, start_date: '2005-09-01T00:00:00.000Z' }];
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        expect((await retrieveFirstFinal('cfb', 41, 9))?.game_id).toBe(1);
        const reads = scheduleReads();
        expect(reads.map((u) => `${u.searchParams.get('home_points')}-${u.searchParams.get('away_points')}`).sort()).toEqual(['41-9', '9-41']);
        for (const u of reads) {
            expect(u.pathname).toBe('/v1/cfb/schedule');
            expect(u.searchParams.get('completed')).toBe('true');
            expect(u.searchParams.get('fbs_game')).toBe('true');
            expect(u.searchParams.get('order')).toBe('start_date');
            expect(u.searchParams.get('limit')).toBe('1');
        }
    });

    test('nfl: espn_schedule, no FBS filter; a tie is one read', async () => {
        net.urls = [];
        net.rows = () => [];
        const { retrieveFirstFinal } = await import('../src/resources/sdv');
        expect(await retrieveFirstFinal('nfl', 13, 13)).toBeNull();
        const reads = scheduleReads();
        expect(reads).toHaveLength(1);
        expect(reads[0].pathname).toBe('/v1/nfl/espn_schedule');
        expect(reads[0].searchParams.has('fbs_game')).toBe(false);
    });
});

describe('GameHeader chip', () => {
    // Real, offline /process payloads: CMU 30 at OKST 27 (2016), JAX 34 at CLE 10 (2026), both final.
    const FIXTURES = { cfb: 'usage-cfb-400869270.json.gz', nfl: 'usage-nfl-401872922.json.gz' } as const;
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    });
    const render = async (league: 'cfb' | 'nfl', on: boolean, earliestId: string | null) => {
        const game = loadGzJson(FIXTURES[league]);
        net.urls = [];
        net.rows = () => (earliestId ? [{ game_id: earliestId, start_date: '2001-09-01T00:00:00.000Z' }] : []);
        const { default: GameHeader } = await import('../src/components/game/GameHeader.astro');
        const html = await container.renderToString(GameHeader, {
            props: { game },
            locals: { league, flagOverrides: { 'final-score-first': on } } as any,
        });
        return { html, game, reads: net.urls.filter((s) => s.includes('schedule')).length };
    };
    const chips = (html: string) => [...html.matchAll(/<span class="badge bg-secondary">([^<]+)<\/span>/g)].map((m) => m[1]);

    for (const league of ['cfb', 'nfl'] as const) {
        test(`[${league}] the game that is first gets the chip in both headers`, async () => {
            const game = loadGzJson(FIXTURES[league]);
            const [a, b] = game.header.competitions[0].competitors.map((c: any) => Number(c.score));
            const { html } = await render(league, true, String(game.header.id));
            expect(chips(html)).toEqual(Array(2).fill(firstFinalLabel(league, a, b)));
        });
        test(`[${league}] an earlier game with the score: no chip, same HTML as flag off`, async () => {
            const on = await render(league, true, '1');
            const off = await render(league, false, null);
            expect(chips(on.html)).toEqual([]);
            expect(off.reads, 'flag off reads nothing').toBe(0);
            // Astro islands carry a random uid per render; nothing else may differ
            const strip = (h: string) => h.replace(/uid="[^"]*"/g, '').replace(/astro-island uid=\S+/g, '');
            expect(strip(on.html)).toBe(strip(off.html));
        });
    }
});
