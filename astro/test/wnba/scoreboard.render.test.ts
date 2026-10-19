import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
const sbDay = vi.fn();
vi.mock('../../src/resources/espn', async (orig) => ({ ...(await orig<typeof import('../../src/resources/espn')>()), getScoreboardForDay: (...a: unknown[]) => sbDay(...a) }));
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
    test('2005-06-03 through the real loader: the halves-era overtime card says Final/OT; Detroit is DET, never ESPN\'s TUL; WAS / NYL cards draw today\'s logos by ESPN id, Detroit the Shock\'s', async () => {
        const real = await vi.importActual<typeof import('../../src/routes/basketball/scoreboard')>('../../src/routes/basketball/scoreboard');
        prep.mockImplementationOnce((...a: Parameters<typeof real.prepareBasketballScoreboard>) => real.prepareBasketballScoreboard(...a));
        sbDay.mockImplementation(async (_l: string, d: string | null) => (d === null ? { day: '2026-10-12', events: [], degraded: false } : { day: '2005-06-03', events: events('20050603'), degraded: false }));
        const html = await render('?date=2005-06-03');
        expect(sbDay).toHaveBeenLastCalledWith('wnba', '20050603', expect.anything());
        expect(html).not.toContain('TUL');
        // each card's team cell (the winner's in <strong>, the loser's dimmed), then the leaders line
        for (const ab of ['DET', 'NYL', 'WAS', 'MIN']) expect(html).toMatch(new RegExp(`>${ab}</(strong|span)>`)); // NYL / WAS / MIN have no former name: ESPN's abbreviation stays
        expect(html).toContain('<span class="d-block">DET: 34 D. Nolan PTS');
        expect(html).toContain('Final/OT');
        expect(html).toContain('href="/wnba/game/250603003"');
        // D22 era logo: ESPN id 3 in 2005 is the Detroit Shock (wnba/500/det.png), never Dallas's
        expect(lightSrcs(html)).toEqual(['min', 'wsh', 'ny', 'det'].map(lightLogo));
        for (const ab of ['wsh', 'min', 'det', 'ny']) expect(darkBlock(html)).toContain(`/wnba/500-dark/${ab}.png`);
        expect(html).not.toContain('/dal.png');
    });
    test('2002-06-15 through the real loader: the defunct Rockers, Sol and 2000-02 Fire draw the site-hosted logos, not the shield', async () => {
        const real = await vi.importActual<typeof import('../../src/routes/basketball/scoreboard')>('../../src/routes/basketball/scoreboard');
        prep.mockImplementationOnce((...a: Parameters<typeof real.prepareBasketballScoreboard>) => real.prepareBasketballScoreboard(...a));
        sbDay.mockImplementation(async (_l: string, d: string | null) => (d === null ? { day: '2026-10-12', events: [], degraded: false } : { day: '2002-06-15', events: events('20020615'), degraded: false }));
        const html = await render('?date=2002-06-15');
        const byId = Object.fromEntries([...html.matchAll(/<img class="[^"]*team-logo-(\d+)" [^>]*src="([^"]+)"/g)].map((m) => [m[1], m[2].replaceAll('&amp;', '&')]));
        expect(Object.keys(byId)).toHaveLength(12);
        // hosted files as they are, never through ESPN's combiner (it only resizes a.espncdn.com files)
        expect(byId['2']).toBe('/assets/img/wnba/cle.png');
        expect(byId['7']).toBe('/assets/img/wnba/mia.png');
        expect(byId['132052']).toBe('/assets/img/wnba/por-2000.png'); // ESPN's id for the old Fire; never the 2026 Fire's por.png
        expect(html).not.toContain('500/por.png');
        // the folded franchises ESPN does serve stay on ESPN
        for (const [id, ab] of [['13', 'sac'], ['4', 'hou'], ['6', 'la']]) expect(byId[id]).toBe(lightLogo(ab));
        expect(byId['3']).toBe(lightLogo('det')); // ESPN's Detroit Shock era file, light and dark
        expect(darkBlock(html)).toContain("img.team-logo-3{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500-dark/det.png");
        // D22 era logos: the Utah Starzz (15) and Orlando Miracle (10) draw their hosted WNBA.com 2002 marks, never the shield
        expect(byId['15']).toBe('/assets/img/wnba/uta.png');
        expect(byId['10']).toBe('/assets/img/wnba/orl.png');
        expect(html).not.toContain('default-team-logo-500');
        // dark mode: no rule replaces a hosted logo; ESPN's teams keep theirs
        for (const id of ['2', '7', '132052', '15', '10']) expect(darkBlock(html)).not.toContain(`team-logo-${id}{`);
        for (const ab of ['sac', 'hou']) expect(darkBlock(html)).toContain(`/wnba/500-dark/${ab}.png`);
    });
    test('a date before 2002-05-25 is a 400 that names the floor month', async () => {
        prep.mockResolvedValueOnce({ badDate: 'range' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wnba/scoreboard?date=2001-06-02'), locals: { preview: true, league: 'wnba' } as App.Locals });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('May 2002');
    });
});
