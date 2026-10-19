import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/wbb/scoreboard.astro';
import { dayNav } from '../../src/nba/scoreboard';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const day = (iso: string, n: string, group: string, groupLabel: string) => ({ day: iso, isLive: false, degraded: false, stale: false, nav: dayNav(iso), today: '2026-10-12', games: events(n), group, groupLabel });
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (q: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wbb/scoreboard${q}`), locals: { preview: true, league: 'wbb' } as App.Locals });

describe('/wbb/scoreboard render (real days)', () => {
    test("2026-02-07 Top 25: 6 cards, the women's selector on Top 25, day links without a group", async () => {
        prep.mockResolvedValueOnce(day('2026-02-07', '20260207-top25', 'top25', 'Top 25'));
        const html = await render('?date=2026-02-07');
        expect(prep.mock.calls[0][1]).toBe('wbb');
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(6);
        expect(html).not.toMatch(/href="\/(nba|mbb)\/game\//);
        expect(html).toMatch(/<select[^>]*name="group"/);
        expect(html).toMatch(/<option value="top25" selected[^>]*>Top 25<\/option>/);
        expect(html).toContain('<option value="all">Division I</option>');
        expect(html).toContain('<option value="47">Summit</option>');
        expect(html).not.toContain('<option value="49">');
        expect(html.match(/<option value="\d+"/g)).toHaveLength(32);
        expect(html).toContain('href="/wbb/scoreboard?date=2026-02-06"');
        expect(html).toContain('min="2002-11-10"');
        expect(html).toMatch(/>#\d+</);
        expect(html).toContain('/i/teamlogos/ncaa/500/');
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    test('2026-02-07 all of D-I: 138 cards, Final/OT and Final/2OT, day links keep group=all, the title names the group', async () => {
        prep.mockResolvedValueOnce(day('2026-02-07', '20260207-all', 'all', 'Division I'));
        const html = await render('?date=2026-02-07&group=all');
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(138);
        for (const s of ['Final/OT', 'Final/2OT']) expect(html).toContain(s);
        expect(html).toContain('href="/wbb/scoreboard?date=2026-02-06&amp;group=all"');
        expect(html).toContain('href="/wbb/scoreboard?date=2026-02-08&amp;group=all"');
        expect(html).toMatch(/<option value="all" selected[^>]*>Division I<\/option>/);
        expect(html).toContain('WBB scoreboard, Saturday, February 7, Division I | Game on Paper');
        // D36: every jump link targets a section on the page (the sections themselves are plan #8's, pinned in its MBB render test)
        const jumps = [...html.matchAll(/<a[^>]+href="#([\w-]+)"/g)].map((m) => m[1]);
        for (const id of jumps) expect(html, id).toContain(`id="${id}"`);
    });
    test('2026-02-07 Big 12: the conference is selected and kept on the day links', async () => {
        prep.mockResolvedValueOnce(day('2026-02-07', '20260207-g8', '8', 'Big 12'));
        const html = await render('?date=2026-02-07&group=8');
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(7);
        expect(html).toMatch(/<option value="8" selected[^>]*>Big 12<\/option>/);
        expect(html).toContain('href="/wbb/scoreboard?date=2026-02-06&amp;group=8"');
    });
    test('a bad group is a 400 that says what the groups are', async () => {
        prep.mockResolvedValueOnce({ badDate: 'group' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wbb/scoreboard?group=49'), locals: { preview: true, league: 'wbb' } as App.Locals });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Use ?group=top25, all, or a conference from the menu.');
    });
    test('a date before 2002-11-10 is a 400 that names the floor month', async () => {
        prep.mockResolvedValueOnce({ badDate: 'range' });
        const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wbb/scoreboard?date=2002-11-01'), locals: { preview: true, league: 'wbb' } as App.Locals });
        expect([res.status, (await res.text()).includes('November 2002')]).toEqual([400, true]);
    });
});
