import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/wnba/scoreboard.astro';
import { dayNav } from '../../src/nba/scoreboard';

const events = (d: string) => JSON.parse(readFileSync(new URL(`../fixtures/wnba/scoreboard-${d}.json`, import.meta.url)).toString()).content.sbData.events;
const day = (iso: string, d: string) => ({ day: iso, isLive: false, degraded: false, stale: false, nav: dayNav(iso), today: '2026-10-12', games: events(d) });
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (q = '') => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wnba/scoreboard${q}`), locals: { preview: true, league: 'wnba' } as App.Locals });
// The light src each card's <img> draws, in card order (away team first); and the dark rules, which only live inside the dark media query.
const lightSrcs = (html: string) => [...html.matchAll(/<img class="[^"]*team-logo-\d+" [^>]*src="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
const lightLogo = (ab: string) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500/${ab}.png&h=80&w=80`;
const darkBlock = (html: string) => html.match(/@media \(prefers-color-scheme: dark\)\{([^<]*)\}/)?.[1] ?? '';

describe('/wnba/scoreboard render (real days)', () => {
    test('2025-08-01: WNBA links, Final/2OT, the 2002 floor, both logo styles', async () => {
        prep.mockResolvedValueOnce(day('2025-08-01', '20250801'));
        const html = await render('?date=2025-08-01');
        expect(prep.mock.calls[0][1]).toBe('wnba');
        for (const id of ['401736285', '401736286', '401736287', '401736288', '401736289']) expect(html).toContain(`href="/wnba/game/${id}"`);
        expect(html).not.toContain('/nba/game/');
        expect(html).toContain('Final/2OT');
        expect(html).toContain('href="/wnba/scoreboard?date=2025-07-31"');
        expect(html).toContain('min="2002-05-25"');
        // light: every card at its abbreviation path, Golden State at 500/gs.png, never the 404 id path
        expect(lightSrcs(html)).toEqual(['phx', 'atl', 'ny', 'con', 'gs', 'chi', 'ind', 'dal', 'la', 'sea'].map(lightLogo));
        expect(html).not.toContain('/500/129689.png');
        expect(darkBlock(html).match(/img\.team-logo-\d+\{/g)).toHaveLength(10);
        expect(darkBlock(html)).toContain('500-dark/gs.png');
        expect(html).toContain('WNBA scoreboard, Friday, August 1 | Game on Paper'); // NbaScoreboardRoute.astro:21 with name 'WNBA'
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    test('2005-06-03: the halves-era overtime card says Final/OT; WAS / TUL / NYL cards draw today\'s logos by ESPN id', async () => {
        prep.mockResolvedValueOnce(day('2005-06-03', '20050603'));
        const html = await render('?date=2005-06-03');
        expect(html).toContain('Final/OT');
        expect(html).toContain('href="/wnba/game/250603003"');
        expect(lightSrcs(html)).toEqual(['min', 'wsh', 'ny', 'dal'].map(lightLogo));
        for (const ab of ['wsh', 'min', 'dal', 'ny']) expect(darkBlock(html)).toContain(`/wnba/500-dark/${ab}.png`);
    });
    test('a date before 2002-05-25 is a 400 that names the floor month', async () => {
        prep.mockResolvedValueOnce({ badDate: 'range' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wnba/scoreboard?date=2001-06-02'), locals: { preview: true, league: 'wnba' } as App.Locals });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('May 2002');
    });
});
