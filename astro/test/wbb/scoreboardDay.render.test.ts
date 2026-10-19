// The REAL loader (plan #4/#8's prepareBasketballScoreboard) over real women's boards: only ESPN's read is replaced, by the captures.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const board = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const reads: { date: string | null; group: string | undefined }[] = [];
let days: Record<string, { top25: unknown[]; all: unknown[] }> = {};
vi.mock('../../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/espn')>()),
    getScoreboardForDay: async (_league: string, espnDate: string | null, opts: { group?: string } = {}) => {
        reads.push({ date: espnDate, group: opts.group });
        const d = espnDate ?? Object.keys(days)[0];
        return { day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, events: opts.group === '50' ? days[d].all : days[d].top25, degraded: false };
    },
}));
import Page from '../../src/pages/wbb/scoreboard.astro';

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (q: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wbb/scoreboard${q}`), locals: { preview: true, league: 'wbb' } as App.Locals });

/** Owner ruling D36 (as plan #8's mbb/scoreboard_budget.json): the busiest real WBB day's rendered HTML length and its budget (x 1.2, rounded up). */
const BUDGET = new URL('../fixtures/wbb/scoreboard_budget.json', import.meta.url);

describe('D35: an empty Top 25 day falls back to all of Division I with a note (2025-04-02)', () => {
    test('the default view shows the 3 D-I games and the note; the URL did not ask for a group', async () => {
        days = { '20250402': { top25: board('20250402-top25'), all: board('20250402-all') } };
        reads.length = 0;
        const html = await render('?date=2025-04-02');
        expect(board('20250402-top25')).toHaveLength(0);
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(3);
        expect(html).toContain('No ranked teams play today — showing all Division I');
        expect(html).not.toContain('No games scheduled.');
        expect(reads.some((r) => r.date === '20250402' && r.group === '50')).toBe(true);
    });
});

describe('D36: the busiest real day on one page, sectioned by status, within its byte budget (2024-11-04)', () => {
    test('161 cards, 34 default shields and no 404 logo, every jump link lands, HTML under budget', async () => {
        days = { '20241104': { top25: [], all: board('20241104-all') } };
        const html = await render('?date=2024-11-04&group=all');
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(161);
        expect(html.match(/default-team-logo-500\.png/g)).toHaveLength(34);
        expect(html).not.toContain('/i/teamlogos/ncaa/500/111956.png'); // Meredith: ESPN has no logo, the card draws the shield
        expect(html).toContain('/i/teamlogos/ncaa/500-dark/2579.png');  // South Carolina's dark rule
        const jumps = [...html.matchAll(/<a[^>]+href="#([\w-]+)"/g)].map((m) => m[1]);
        for (const id of jumps) expect(html, id).toContain(`id="${id}"`);
        // MEASURE_SCOREBOARD_BUDGET=1 only (Task 6 Step 4): record the measured size and the budget (x 1.2) once
        if (process.env.MEASURE_SCOREBOARD_BUDGET === '1') writeFileSync(BUDGET, JSON.stringify({ day: '2024-11-04', measured_bytes: html.length, budget_bytes: Math.ceil(html.length * 1.2) }, null, 1) + '\n');
        expect(existsSync(BUDGET)).toBe(true);
        const b = JSON.parse(readFileSync(BUDGET).toString());
        expect(b.budget_bytes).toBe(Math.ceil(b.measured_bytes * 1.2));
        expect(html.length).toBeLessThanOrEqual(b.budget_bytes);
    });
});
