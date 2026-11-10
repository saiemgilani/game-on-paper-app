// BB-G33: the game page's possession factors behind 'bball-situational-box'. The fixtures are BB-G32's real ones
// (fixtures/README.md: team-grid-*.json.gz): the offline processor body of one game per league, with sdv-py's BB-D31 team
// split rows. The panel makes no read; fetch is stubbed and must never be called.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

import NbaGamePage from '../src/components/nba/game/NbaGamePage.astro';
import { TEAM_SPLIT_KEYS, fromProcessor, type NbaGame, type NbaProcessorPayload } from '../src/resources/nbaGame';
import type { BasketballLeague } from '../src/utils/league';

const gz = (name: string): { payload: NbaProcessorPayload } => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const P: Record<BasketballLeague, NbaProcessorPayload> = {
    nba: gz('team-grid-nba-401585607').payload, // TOR 96 at ORL 111, 2023-24
    wnba: gz('team-grid-wnba-401736325').payload, // SEA 80 at ATL 78, 2025
    mbb: gz('team-grid-mbb-401820775').payload, // NC State 90 at Notre Dame 96 (OT), 2025-26
    wbb: gz('team-grid-wbb-401805076').payload, // UTEP 87 at Louisiana Tech 91 (OT), 2025-26
};
const LEAGUES = Object.keys(P) as BasketballLeague[];
const game = (lg: BasketballLeague): NbaGame => fromProcessor(structuredClone(P[lg]), lg);

describe('the processor payload', () => {
    test.each(LEAGUES)('%s: each side carries every split column the panel reads, as the producer wrote it', (lg) => {
        const g = game(lg);
        for (const s of ['home', 'away'] as const) {
            const row = P[lg].splits![s].team!;
            for (const k of TEAM_SPLIT_KEYS) { expect(row).toHaveProperty(k); expect(g[s].splits![k]).toBe(row[k] ?? null); }
            // the families the tables split the possessions and shots into add up (sdv-py's own gate, re-read here)
            const t = g[s].splits!;
            expect(t.transition_poss! + t.half_court_poss!).toBe(t.possessions);
            expect(t.second_chance_poss! + t.first_chance_poss!).toBe(t.possessions);
            expect(t.rim_fga! + t.mid_fga! + t.fg2_unlocated_fga! + t.fg3_fga!).toBe(t.fga);
            expect(t.corner3_fga! + t.above_break3_fga! + t.fg3_unlocated_fga!).toBe(t.fg3_fga);
            expect(t.live_tov! + t.dead_tov!).toBe(t.tov);
        }
    });
});

describe('the page', () => {
    let container: AstroContainer;
    beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
    const render = (lg: BasketballLeague, g: NbaGame, flag = true) =>
        container.renderToString(NbaGamePage, { props: { game: g }, request: new Request(`https://gameonpaper.com/${lg}/game/${g.id}`), locals: { league: lg, preview: true, flagOverrides: { 'bball-situational-box': flag, 'bball-team-grid': false } } as unknown as App.Locals });
    const plain = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    const row = (html: string, label: string) => html.match(new RegExp(`<tr[^>]*>\\s*<th[^>]*>${label}</th>[\\s\\S]*?</tr>`))![0];

    test.each(LEAGUES)('%s: the panel, its nav entry and three tables, every number the producer\'s, the better side tinted', async (lg) => {
        const g = game(lg), a = g.away.splits!, h = g.home.splits!;
        const html = await render(lg, g);
        expect(html).toContain('id="situations"'); expect(html).toContain('href="#situations"');
        for (const t of ['Situations', 'Shot zones', 'Ball and flow']) expect(html).toContain(`aria-label="${t}"`);
        const text = plain(html);
        for (const bad of ['NaN', 'undefined', 'null', 'n/a']) expect(text).not.toContain(bad);
        // situations: possessions, share, points and PPP for each side; the better PPP tinted unless tied
        const tr = row(html, 'Transition');
        for (const s of [a, h]) {
            expect(tr).toContain(`>${s.transition_poss}<`); expect(tr).toContain(`>${s.transition_pts}<`); expect(tr).toContain(`>${s.transition_ppp!.toFixed(2)}<`);
            expect(tr).toContain(`>${(100 * s.transition_poss! / s.possessions!).toFixed(1)}%<`);
        }
        expect(tr.match(/table-success/g)?.length ?? 0).toBe(a.transition_ppp === h.transition_ppp ? 0 : 1);
        // zones: made-attempted and eFG% (a three's make counts 1.5)
        const corner = row(html, 'Corner three');
        for (const s of [a, h]) {
            expect(corner).toContain(`>${s.corner3_fgm}-${s.corner3_fga}<`);
            if (s.corner3_fga) expect(corner).toContain(`>${(150 * s.corner3_fgm! / s.corner3_fga).toFixed(1)}%<`);
        }
        expect(row(html, 'Rim \\(under 4 ft\\)')).toContain(`>${h.rim_fgm}-${h.rim_fga}<`);
        // no unlocated shots in these captures, so no unlocated rows
        expect(text).not.toContain('no location');
        // ball and flow: fewer turnovers is better, more points off them is better
        const live = row(html, 'Live-ball turnovers \\(steals\\)');
        expect(live).toContain(`>${a.live_tov}<`); expect(live).toContain(`>${h.live_tov}<`);
        if (a.live_tov !== h.live_tov) expect(live).toMatch(new RegExp(`table-success fw-bold[^>]*>${Math.min(a.live_tov!, h.live_tov!)}<`));
        expect(row(html, 'Biggest run')).toContain(`>${Math.abs(a.max_run! - h.max_run!)}<`);
        // a style row has no better side
        expect(row(html, '3PA rate')).not.toContain('table-success');
        expect(text).toContain(`within ${lg === 'nba' || lg === 'wnba' ? 8 : 10} seconds`);
    });
    test('an unlocated shot shows its row, and only then', async () => {
        const g = game('mbb'); g.home.splits = { ...g.home.splits!, fg2_unlocated_fga: 2, fg2_unlocated_fgm: 1 };
        const text = plain(await render('mbb', g));
        expect(text).toContain('Two, no location'); expect(text).not.toContain('Three, no location');
    });
    test('a zero-attempt zone is a dash, never NaN', async () => {
        const g = game('wnba'); g.away.splits = { ...g.away.splits!, corner3_fga: 0, corner3_fgm: 0 };
        const corner = row(await render('wnba', g), 'Corner three');
        expect(corner).toContain('>0-0<'); expect(corner).toContain('>–<'); expect(corner).not.toContain('NaN');
    });
    test('no splits (a Data API final, or before the tip): the panel says so, with no tables', async () => {
        const g = game('nba'); delete g.home.splits; delete g.away.splits;
        const html = await render('nba', g);
        expect(html).toContain('id="situations"');
        expect(plain(html)).toContain('not available for this game yet'); expect(html).not.toContain('aria-label="Situations"');
    });
    test('flag off: no panel and no nav entry', async () => {
        const html = await render('wbb', game('wbb'), false);
        expect(html).not.toContain('id="situations"'); expect(html).not.toContain('href="#situations"'); expect(html).not.toContain('Possession factors');
    });
});
