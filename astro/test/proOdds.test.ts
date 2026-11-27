import { describe, expect, test, vi } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';

// The Pro odds board ('pro-odds', ACC-2026-0066) on the synthetic fixture test/fixtures/pro/odds/odds.json
// (made-up books and teams: real lines never go into this public repo).
vi.mock('astro:env/server', () => ({ getSecret: () => undefined }));
vi.mock('cloudflare:workers', async () => ({ env: (await import('./helpers/memKV')).memEnv }));

import { fmtAmerican, fmtPct, fmtStart, implied, pickLeague, type OddsBoard } from '../src/utils/proOdds';

const DAY = 86_400_000;
const pro = { email: 'coach@example.edu', tier: 'pro', expires: new Date(Date.now() + 30 * DAY).toISOString() };

describe('odds formatting', () => {
    test('American prices, percents and Eastern start times', () => {
        expect([fmtAmerican(145), fmtAmerican(-175), fmtAmerican(100), fmtAmerican(-100)]).toEqual(['+145', '-175', 'EVEN', 'EVEN']);
        expect([fmtPct(0.61771), fmtPct(0.0455), fmtPct(null), fmtPct(0.0046, true), fmtPct(-0.02, true)]).toEqual(['61.8%', '4.5%', '—', '+0.5%', '-2.0%']);
        expect(fmtStart('2026-11-28T17:00:00Z')).toBe('Sat, Nov 28, 12:00 PM ET');
        expect([implied(-175), implied(145), implied(100)]).toEqual([175 / 275, 100 / 245, 0.5]);
    });

    test('the league picker falls back to the first league with games', () => {
        const board = { leagues: [{ key: 'nfl', name: 'NFL', games: [] }, { key: 'nhl', name: 'NHL', games: [{}] }] } as unknown as OddsBoard;
        expect(pickLeague(board, 'nfl')?.key).toBe('nfl');
        expect(pickLeague(board, 'zzz')?.key).toBe('nhl');
        expect(pickLeague(board, null)?.key).toBe('nhl');
    });
});

describe('the /pro/odds page', () => {
    const render = async (url: string, locals: Record<string, unknown>) => {
        const container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        const { default: Page } = await import('../src/pages/pro/odds.astro');
        return container.renderToResponse(Page, { request: new Request(`https://gameonpaper.com${url}`), locals: locals as any });
    };

    test('renders every book, the consensus, the best price and the guards', async () => {
        const html = await (await render('/pro/odds', { preview: true, pro })).text();
        for (const s of ['Fixture Tech at Fixture State', 'Book A', 'Book B', '+160', '-150', '38.0%', '62.0%', '(implied <span class="numeral">38.5%</span>)', 'the best prices cross',
            'draw possible but not priced', 'Fixture limit one.', 'no book endorses or sponsors this page']) expect(html, s).toContain(s);
        // the best price is bold in its column; the other book's price is not
        const bookB = html.split('Book B</td>')[1].split('</tr>')[0];
        expect(bookB).toMatch(/fw-bold[^>]*>\+160/);
        expect(html).not.toContain('Download');  // rendered only: no file of the lines
    });

    test('an empty league says so', async () => {
        expect(await (await render('/pro/odds?league=nhl', { preview: true, pro })).text()).toContain('No upcoming NHL games');
    });

    test("is the site's 404 with the flag off and sends a signed-out viewer to pricing", async () => {
        // flag off: the page rewrites to the site's 404 (the container has no 404 route, so the rewrite surfaces as this error)
        await expect(render('/pro/odds', { preview: false, pro })).rejects.toThrow('/404');
        const out = await render('/pro/odds', { preview: true, pro: null });
        expect(out.status).toBe(302);
        expect(out.headers.get('location')).toBe('/pricing');
    });
});
