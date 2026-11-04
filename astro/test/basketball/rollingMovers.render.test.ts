// astro/test/basketball/rollingMovers.render.test.ts
// BB-G11 ('bball-rolling-movers'): the rolling leaders' Most declined board on every league's /<league>/leaders, on the real
// captures (the NBA's fixture rows, the WNBA's 2026 season, the colleges' 49-day 2026 reads). Only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { PlayerGameRow } from '../../src/resources/nbaShots';
import type { BasketballLeague } from '../../src/utils/league';
import { seasonPlayerRows } from '../nba/rows';
import * as wnba from '../wnba/dashboardFixtures';
import * as mbb from '../mbb/dashboardFixtures';
import * as wbb from '../wbb/dashboardFixtures';

vi.setConfig({ testTimeout: 60_000 });
const byPlayer = JSON.parse(readFileSync(new URL('../fixtures/nba/player_games.json', import.meta.url)).toString()) as Record<string, any[]>;
const nbaGames = (): PlayerGameRow[] => Object.entries(byPlayer).flatMap(([pid, games]) => games.map((g) => ({
    season: 2026, person_id: Number(pid), game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
    fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
})));
const FIX: Record<string, { players: () => any[]; games: () => PlayerGameRow[]; latest: () => string | null; coverage: () => any[] }> = {
    nba: { players: seasonPlayerRows, games: nbaGames, latest: () => null, coverage: () => [] },
    wnba: { players: () => wnba.seasonPlayers(2026), games: wnba.playerGames2026, latest: () => null, coverage: () => [] },
    mbb: { players: () => mbb.seasonPlayers(2026), games: mbb.leadersGames2026, latest: () => mbb.leadersLatest2026()[0].game_date, coverage: mbb.coverage },
    wbb: { players: () => wbb.seasonPlayers(2026), games: wbb.leadersGames2026, latest: () => wbb.leadersLatest2026()[0].game_date, coverage: wbb.coverage },
};
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (_s: number, lg: string) => FIX[lg].players(),
    retrieveSeasonPlayerGameRows: async (_s: number, lg: string) => FIX[lg].games(),
    retrieveLatestGameDate: async (_s: number, lg: string) => FIX[lg].latest(),
    retrieveCoverageRows: async (lg: string) => FIX[lg].coverage(),
}));

import { prepareBasketballLeaders } from '../../src/routes/basketball/leaders';

const LEAGUES: BasketballLeague[] = ['nba', 'wnba', 'mbb', 'wbb'];
const URL_OF = (lg: BasketballLeague) => `/${lg}/leaders${lg === 'nba' ? '?season=2026' : ''}`;
const locals = (on: boolean) => ({ preview: true, flagOverrides: { 'bball-rolling-movers': on } }) as unknown as App.Locals;

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function render(lg: BasketballLeague, on: boolean) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/${lg}/leaders.astro`);
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com${URL_OF(lg)}`), locals: locals(on) });
}
const fakeAstro = (lg: BasketballLeague, on: boolean) =>
    ({ params: {}, url: new URL(`https://gameonpaper.com${URL_OF(lg)}`), locals: locals(on), cache: { set: () => {} }, response: { headers: new Headers() } }) as any;

describe.each(LEAGUES)('/%s/leaders, Most declined', (lg) => {
    test('flag on: every window has the board, the improved change ranked from the largest drop, over the same players', async () => {
        const r = await prepareBasketballLeaders(fakeAstro(lg, true), lg);
        if ('unavailable' in r) throw new Error('unavailable');
        expect(r.movers).toBe(true);
        for (const [n, b] of Object.entries(r.boards!)) {
            const down = b.declined!;
            expect(down.rows.length, `${lg} ${n}`).toBeGreaterThan(0);
            expect(down.eligible).toBe(b.improved.eligible);
            const v = down.rows.map((row) => row.value);
            expect(v).toEqual([...v].sort((a, c) => a - c));
            expect(down.rows[0].value).toBeLessThan(0);
            expect(down.rows[0].value).toBeLessThan(b.improved.rows[0].value);
            expect(down.rows[0].rank).toBe(1);
            for (const row of down.rows) expect(row.value).toBeCloseTo(row.window.attempts ? (row.window.makes + 0.5 * row.window.fg3m) / row.window.attempts - row.seasonEfg! : NaN, 12);
        }
    });
    test('flag off: no board, no prop, no button; flag on: the button and the definition', async () => {
        const off = await prepareBasketballLeaders(fakeAstro(lg, false), lg);
        if ('unavailable' in off) throw new Error('unavailable');
        expect(off.movers).toBeUndefined();
        for (const b of Object.values(off.boards!)) expect(b).not.toHaveProperty('declined');
        const offHtml = await render(lg, false);
        expect(offHtml).not.toContain('declined');
        expect(offHtml).not.toContain('The change:');
        const onHtml = await render(lg, true);
        expect(onHtml).toContain('>Most declined</button>');
        expect(onHtml).toContain("The change: the window's eFG% minus");
        expect(onHtml).toContain('Most declined the largest drop.');
        expect(onHtml).toContain('most improved and declined');
    });
});
