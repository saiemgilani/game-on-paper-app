import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// S15 rendered with real rows: the spec's example query (>= 3,000 pass and >= 1,000 rush
// yards) against the live Data API, both leagues (fixtures/player-seasons-wide.json).
const fx = JSON.parse(readFileSync(new URL('./fixtures/player-seasons-wide.json', import.meta.url)).toString());
let failed = false;
let reads = 0;
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayerSeasonsWide: async ({ league }: { league: string }) => { reads++; return failed ? null : league === 'nfl' ? fx.nfl : fx.cfb; },
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });

const PAGES = { cfb: '../src/pages/search/seasons.astro', nfl: '../src/pages/nfl/search/seasons.astro' } as const;
async function render(lg: 'cfb' | 'nfl', query: string) {
    const { default: Page } = await import(/* @vite-ignore */ PAGES[lg]);
    return container.renderToString(Page, {
        request: new Request(`https://gameonpaper.com${lg === 'nfl' ? '/nfl' : ''}/search/seasons${query}`),
        locals: { preview: true } as any,
    });
}
const bodyRows = (html: string) => html.split('<tr').filter((r) => r.includes('<td'));
const EXAMPLE = '?pass_yards=3000&rush_yards=1000';

describe('the example query', () => {
    test('the fixture holds only rows meeting both thresholds (acceptance)', () => {
        for (const r of [...fx.cfb, ...fx.nfl]) {
            expect(r.pass_yards).toBeGreaterThanOrEqual(3000);
            expect(r.rush_yards).toBeGreaterThanOrEqual(1000);
        }
    });

    test('cfb: every row, each linking its player page in its own season', async () => {
        const html = await render('cfb', EXAMPLE);
        const rows = bodyRows(html);
        expect(rows).toHaveLength(fx.cfb.length);
        for (const r of fx.cfb) expect(html).toContain(`href="/players/${r.espn_id}?season=${r.season}"`);
        expect(html).toContain('href="/year/2018/team/201"'); // Kyler Murray, Oklahoma
        expect(rows[0]).toContain('Kyler Murray');
        expect(html).toContain(`${fx.cfb.length} player-seasons, sorted by Pass Yds.`);
        // the form keeps what was asked
        expect(html).toMatch(/name="pass_yards"[^>]*value="3000"/);
        expect(html).toMatch(/name="rush_yards"[^>]*value="1000"/);
        expect(html).toContain('All games, postseason included.');
    }, 60_000);

    test('nfl: Lamar Jackson 2019 on the /nfl paths', async () => {
        const html = await render('nfl', EXAMPLE);
        expect(bodyRows(html)).toHaveLength(1);
        expect(html).toContain('href="/nfl/players/3916387?season=2019"');
        expect(html).toContain('href="/nfl/year/2019/team/33"');
        expect(html).toContain('1 player-season, sorted by Pass Yds.');
        expect(html).toContain('action="/nfl/search/seasons"');
        expect(html).toContain('Regular season games only.');
    }, 60_000);
});

describe('states', () => {
    test('no filters: the empty form and no read', async () => {
        reads = 0;
        const html = await render('cfb', '');
        expect(reads).toBe(0);
        expect(html).toContain('id="season-search"');
        expect(html).toContain('type="number"');
        expect(bodyRows(html)).toHaveLength(0);
        expect(html).not.toContain('id="season-search-count"');
    }, 60_000);

    test('a failed read says so instead of "no seasons"', async () => {
        failed = true;
        try {
            const html = await render('cfb', EXAMPLE);
            expect(html).toContain('id="season-search-unavailable"');
            expect(html).not.toContain('No player-seasons');
            expect(bodyRows(html)).toHaveLength(0);
        } finally { failed = false; }
    }, 60_000);
});

describe('result notes', () => {
    test('an empty answer says no seasons meet the thresholds', async () => {
        const saved = fx.cfb; fx.cfb = [];
        try {
            const html = await render('cfb', '?pass_yards=9000');
            expect(html).toContain('No player-seasons meet every threshold.');
            expect(bodyRows(html)).toHaveLength(0);
        } finally { fx.cfb = saved; }
    }, 60_000);

    test('a capped answer says it is the top 200', async () => {
        const saved = fx.cfb; fx.cfb = Array.from({ length: 200 }, (_, i) => ({ ...saved[i % saved.length] }));
        try {
            const html = await render('cfb', EXAMPLE);
            expect(html).toContain('The top 200 by Pass Yds.');
            expect(bodyRows(html)).toHaveLength(200);
        } finally { fx.cfb = saved; }
    }, 60_000);
});

describe('a row without a team id', () => {
    test('shows the abbreviation unlinked rather than a broken team link', async () => {
        const saved = fx.nfl; fx.nfl = [{ ...saved[0], team_id: null, team_abbr: 'BAL' }];
        try {
            const html = await render('nfl', EXAMPLE);
            expect(html).not.toContain('/nfl/year/2019/team/');
            expect(bodyRows(html)[0]).toContain('BAL');
            expect(html).toContain('href="/nfl/players/3916387?season=2019"');
        } finally { fx.nfl = saved; }
    }, 60_000);
});
