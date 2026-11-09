import { readFileSync } from 'node:fs';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL } from '../../src/basketball/config';
import { dayNav, statusSections } from '../../src/nba/scoreboard';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/mbb/scoreboard.astro';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
const render = (q: string, iso: string, n: string) => {
    prep.mockResolvedValueOnce({ day: iso, isLive: false, degraded: false, stale: false, nav: dayNav(iso), today: '2026-10-12', games: events(n), group: 'all', groupLabel: 'Division I' });
    return container.renderToString(Page, { request: new Request(`https://gameonpaper.com/mbb/scoreboard${q}`), locals: { preview: true, league: 'mbb' } as App.Locals });
};

describe('status sections (D36, R11)', () => {
    test('college only: mbb groups by status, the NBA and WNBA objects gained no key', () => {
        expect(BASKETBALL.mbb.scoreboardGrouping).toBe('status');
        for (const lg of ['nba', 'wnba'] as const) expect(Object.keys(BASKETBALL[lg])).not.toContain('scoreboardGrouping');
    });
    test('a finished day is one Final section; an upcoming day one Upcoming section; ESPN order kept', () => {
        const fin = events('20250222-all'), pre = events('20261103-all');
        expect(statusSections(fin).map((s) => [s.key, s.label, s.events.length])).toEqual([['final', 'Final', 131]]);
        expect(statusSections(pre).map((s) => [s.key, s.events.length])).toEqual([['upcoming', pre.length]]);
        const mixed = statusSections([...fin.slice(0, 2), ...pre.slice(0, 3)]); // real events of two days: Upcoming before Final
        expect(mixed.map((s) => [s.key, s.events.map((e: any) => e.id)])).toEqual([['upcoming', pre.slice(0, 3).map((e: any) => e.id)], ['final', fin.slice(0, 2).map((e: any) => e.id)]]);
    });
    test('the D-I page renders sections with jump links to the non-empty ones only', async () => {
        const html = await render('?date=2025-02-22&group=all', '2025-02-22', '20250222-all');
        expect(html).toContain('<section id="final"');
        expect(html).toContain('href="#final"');
        for (const k of ['live', 'upcoming']) { expect(html).not.toContain(`id="${k}"`); expect(html).not.toContain(`href="#${k}"`); }
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(131);
        expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    test('an upcoming day renders the Upcoming section', async () => {
        const html = await render('?date=2026-11-03&group=all', '2026-11-03', '20261103-all');
        expect(html).toContain('<section id="upcoming"');
        expect(html).not.toContain('<section id="final"');
    });
});
