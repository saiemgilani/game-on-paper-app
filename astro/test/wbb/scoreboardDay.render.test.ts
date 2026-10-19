// The REAL loader (plan #4/#8's prepareBasketballScoreboard) over real women's boards: only ESPN's read is replaced, by the captures.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const board = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const reads: { date: string | null; group: string | undefined }[] = [];
let days: Record<string, { top25: unknown[]; all: unknown[] }> = {};
let allDegraded = false; // the D-I read (group 50) failed upstream
vi.mock('../../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/espn')>()),
    getScoreboardForDay: async (_league: string, espnDate: string | null, opts: { group?: string } = {}) => {
        reads.push({ date: espnDate, group: opts.group });
        const d = espnDate ?? Object.keys(days)[0];
        return { day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, events: opts.group === '50' ? (allDegraded ? [] : days[d].all) : days[d].top25, degraded: opts.group === '50' && allDegraded };
    },
}));
import Page from '../../src/pages/wbb/scoreboard.astro';

/** The Final section's card for one game: its NbaGameCard column, up to the next card or the section's end ('' when not in Final). */
const finalCard = (h: string, id: string) => {
    const sec = h.match(/<section id="final"[\s\S]*?<\/section>/)?.[0] ?? '';
    const at = sec.indexOf(`href="/wbb/game/${id}"`);
    if (at < 0) return '';
    const next = sec.indexOf('<div class="col-xl-3', at);
    return sec.slice(sec.lastIndexOf('<div class="col-xl-3', at), next < 0 ? undefined : next);
};
const plain = (h: string) => h.replace(/<[^>]+>/g, '');
let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create(); });
const render = (q: string) => container.renderToString(Page, { request: new Request(`https://gameonpaper.com/wbb/scoreboard${q}`), locals: { preview: true, league: 'wbb' } as App.Locals });

/**
 * Owner ruling D36 (as plan #8's mbb/scoreboard_budget.json): the busiest real WBB day's rendered HTML length and its budget (x 1.2,
 * rounded up). `measured_bytes` / `budget_bytes` count `html.length`, UTF-16 code units (characters), not encoded bytes, exactly as
 * MBB's file does (test/mbb/scoreboardBudget.test.ts reads the same keys, so they keep their names).
 */
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
    test('failed fallback: the D-I read degraded, so the page says unavailable (not "No games scheduled.") and is not cached', async () => {
        days = { '20250402': { top25: board('20250402-top25'), all: board('20250402-all') } };
        allDegraded = true;
        try {
            const res = await container.renderToResponse(Page, { request: new Request('https://gameonpaper.com/wbb/scoreboard?date=2025-04-02'), locals: { preview: true, league: 'wbb' } as App.Locals });
            const html = await res.text();
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            expect(html).toContain('The scoreboard is unavailable right now.');
            expect(html).not.toContain('No games scheduled.');
            expect(html).not.toContain('No ranked teams play today');
            expect(html).not.toMatch(/href="\/wbb\/game\/\d+"/);
        } finally { allDegraded = false; }
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
        expect(jumps).toEqual(['final']); // a finished day: one section
        for (const id of jumps) expect(html, id).toContain(`<section id="${id}"`);
        expect(finalCard(html, '401716378')).toContain('Canceled'); // statusSections: not live, not upcoming, so Final, with its own line
        // MEASURE_SCOREBOARD_BUDGET=1 only (Task 6 Step 4): record the measured size and the budget (x 1.2) once
        if (process.env.MEASURE_SCOREBOARD_BUDGET === '1') writeFileSync(BUDGET, JSON.stringify({ day: '2024-11-04', measured_bytes: html.length, budget_bytes: Math.ceil(html.length * 1.2) }, null, 1) + '\n');
        expect(existsSync(BUDGET)).toBe(true);
        const b = JSON.parse(readFileSync(BUDGET).toString());
        expect(b.budget_bytes).toBe(Math.ceil(b.measured_bytes * 1.2));
        expect(html.length).toBeLessThanOrEqual(b.budget_bytes);
    });
});

describe('a halves-era D-I day (2014-02-08, real board): overtimes counted past two halves', () => {
    test('118 finals: 111 Final, 5 Final/OT (period 3), 2 Final/2OT (period 4, which a quarters game would call regulation)', async () => {
        days = { '20140208': { top25: [], all: board('20140208-all') } };
        const html = await render('?date=2014-02-08&group=all');
        expect(html.match(/href="\/wbb\/game\/\d+"/g)).toHaveLength(118);
        expect([...html.matchAll(/<a[^>]+href="#([\w-]+)"/g)].map((m) => m[1])).toEqual(['final']);
        expect(finalCard(html, '400512272')).toContain('Final/2OT');
        expect(finalCard(html, '400504882')).toContain('Final/OT');
        expect((plain(html).match(/Final\/2OT/g) ?? []).length).toBe(2);
        expect((plain(html).match(/Final\/OT/g) ?? []).length).toBe(5);
        expect(plain(html)).not.toMatch(/Final\/(3|4)OT|\bQ[1-4]\b/);
    });
});
