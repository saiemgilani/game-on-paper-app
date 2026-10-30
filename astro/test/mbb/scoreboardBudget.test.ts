// D36: the busiest real D-I day (2024-11-04, 199 games) renders on one page within its measured HTML size x 1.2.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { gunzipSync } from 'node:zlib';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, test, vi } from 'vitest';
import { dayNav } from '../../src/nba/scoreboard';

const prep = vi.fn();
vi.mock('../../src/routes/basketball/scoreboard', async (orig) => ({ ...(await orig<typeof import('../../src/routes/basketball/scoreboard')>()), prepareBasketballScoreboard: (...a: unknown[]) => prep(...a) }));
import Page from '../../src/pages/mbb/scoreboard.astro';

const BUDGET = new URL('../fixtures/mbb/scoreboard_budget.json', import.meta.url);

describe('the 199-game day fits one page (D36)', () => {
    test('2024-11-04, all of D-I: 199 cards under the budget', async () => {
        const ev = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/mbb/scoreboard-20241104-all.json.gz', import.meta.url))).toString()).content.sbData.events;
        prep.mockResolvedValueOnce({ day: '2024-11-04', isLive: false, degraded: false, stale: false, nav: dayNav('2024-11-04'), today: '2026-10-12', games: ev, group: 'all', groupLabel: 'Division I' });
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/mbb/scoreboard?date=2024-11-04&group=all'), locals: { preview: true, league: 'mbb' } as App.Locals });
        expect(html.match(/href="\/mbb\/game\/\d+"/g)).toHaveLength(199);
        // Task 6b Step 3 only: MEASURE_SCOREBOARD_BUDGET=1 records the measured size and the budget (x 1.2) once
        if (process.env.MEASURE_SCOREBOARD_BUDGET === '1') writeFileSync(BUDGET, JSON.stringify({ day: '2024-11-04', measured_bytes: html.length, budget_bytes: Math.ceil(html.length * 1.2) }, null, 1) + '\n');
        expect(existsSync(BUDGET)).toBe(true);
        const b = JSON.parse(readFileSync(BUDGET).toString());
        expect(b.budget_bytes).toBe(Math.ceil(b.measured_bytes * 1.2));
        expect(html.length).toBeLessThanOrEqual(b.budget_bytes);
    });
});
