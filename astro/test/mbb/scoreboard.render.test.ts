import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/mbb/scoreboard.astro';
import { dayNav } from '../../src/nba/scoreboard';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const day = (iso: string, n: string, group: string, groupLabel: string) => ({ day: iso, isLive: false, degraded: false, stale: false, nav: dayNav(iso), today: '2026-10-12', games: events(n), group, groupLabel });
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (q: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/mbb/scoreboard${q}`), locals: { preview: true, league: 'mbb' } as App.Locals });

describe('/mbb/scoreboard render (real days)', () => {
    test('2025-02-22 Top 25: 15 cards, ranks, MBB links, the selector on Top 25, day links without a group', async () => {
        prep.mockResolvedValueOnce(day('2025-02-22', '20250222-top25', 'top25', 'Top 25'));
        const html = await render('?date=2025-02-22');
        expect(prep.mock.calls[0][1]).toBe('mbb');
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(15);
        expect(html).not.toContain('/nba/game/');
        expect(html).toMatch(/<select[^>]*name="group"/);
        expect(html).toMatch(/<option value="top25" selected[^>]*>Top 25<\/option>/);
        expect(html).toContain('<option value="all">Division I</option>');
        expect(html.match(/<option value="\d+"/g)).toHaveLength(32);
        expect(html).toContain('href="/mbb/scoreboard?date=2025-02-21"');
        expect(html).toContain('min="2002-11-14"');
        expect(html).toMatch(/>#\d+</); // TeamRow's rank from curatedRank
        expect(html).toContain('/i/teamlogos/ncaa/500/');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    test('2025-02-22 all of D-I: 131 cards, Final/OT, day links keep group=all, canonical names the group', async () => {
        prep.mockResolvedValueOnce(day('2025-02-22', '20250222-all', 'all', 'Division I'));
        const html = await render('?date=2025-02-22&group=all');
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(131);
        expect(html).toContain('Final/OT');
        expect(html).toContain('href="/mbb/scoreboard?date=2025-02-21&amp;group=all"');
        expect(html).toContain('href="/mbb/scoreboard?date=2025-02-23&amp;group=all"');
        expect(html).toContain('/mbb/scoreboard?date=2025-02-22&amp;group=all"'); // canonical
        expect(html).toMatch(/<option value="all" selected[^>]*>Division I<\/option>/);
        expect(html).toContain('MBB scoreboard, Saturday, February 22, Division I | Game on Paper');
        expect(html).toContain('12-17, 7-11 MVC'); // Southern Illinois, id 18: MVC in MBB (FBS Independents in football, no conference record)
        expect(html).toContain('13-14, 6-7 UAC'); // UT Arlington, id 30 (Southland in football)
        expect(html).not.toContain(' FBS Independents<');
    });
    test('2025-02-22 Big 12: the conference is selected and kept on the day links', async () => {
        prep.mockResolvedValueOnce(day('2025-02-22', '20250222-g8', '8', 'Big 12'));
        const html = await render('?date=2025-02-22&group=8');
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(6);
        expect(html).toMatch(/<option value="8" selected[^>]*>Big 12<\/option>/);
        expect(html).toContain('href="/mbb/scoreboard?date=2025-02-21&amp;group=8"');
        // record lines name MBB's own conferences (MBB_CONFERENCES), never the football group list's (id 8 is the SEC there)
        expect(html).toContain('23-4, 15-1 Big 12'); // Houston
        expect(html).not.toContain(' SEC<');
    });
    test('2024-11-04 UAC: a non-D-I opponent gets the default shield, never a 404 logo', async () => {
        prep.mockResolvedValueOnce(day('2024-11-04', '20241104-g30', '30', 'UAC'));
        const html = await render('?date=2024-11-04&group=30');
        expect(html).not.toContain('/i/teamlogos/ncaa/500/126794.png');
        expect(html).not.toContain('500-dark/126794.png');
        expect(html.match(/default-team-logo-500\.png/g)).toHaveLength(3);
        expect(html).toContain('/i/teamlogos/ncaa/500-dark/250.png'); // UT Arlington, ESPN id 250
    });
    test('2025-04-06: the Top 25 board is empty, so the default view is the D-I board with the note (D35, Decision 2)', async () => {
        prep.mockResolvedValueOnce({ ...day('2025-04-06', '20250406-all', 'top25', 'Top 25'), fallbackNote: 'No ranked teams play today — showing all Division I' });
        const html = await render('?date=2025-04-06');
        expect(html).toContain('No ranked teams play today — showing all Division I');
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(1);         // the day's one D-I game
        expect(html).not.toContain('No games scheduled.');
        expect(html).toMatch(/<option value="top25" selected[^>]*>Top 25<\/option>/); // still the default view: the URL stays bare
        expect(html).toContain('href="/mbb/scoreboard?date=2025-04-05"');         // day links stay bare too
    });
    test('a Top 25 day with games has no fallback note', async () => {
        prep.mockResolvedValueOnce(day('2025-02-22', '20250222-top25', 'top25', 'Top 25'));
        expect(await render('?date=2025-02-22')).not.toContain('No ranked teams play today');
    });
    test('a bad group is a 400 that says what the groups are', async () => {
        prep.mockResolvedValueOnce({ badDate: 'group' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/mbb/scoreboard?group=99'), locals: { preview: true, league: 'mbb' } as App.Locals });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Use ?group=top25, all, or a conference from the menu.');
    });
    test('a date before 2002-11-14 is a 400 that names the floor month', async () => {
        prep.mockResolvedValueOnce({ badDate: 'range' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/mbb/scoreboard?date=2002-11-01'), locals: { preview: true, league: 'mbb' } as App.Locals });
        expect([res.status, (await res.text()).includes('November 2002')]).toEqual([400, true]);
    });
});
