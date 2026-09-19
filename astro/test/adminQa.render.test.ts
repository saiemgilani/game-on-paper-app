import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// /admin/qa renders the validation signal every /process response now carries.
// Two things have to hold: it is admin-only whatever the middleware did, and
// the tables follow the site's table conventions (name column left, everything
// else centered, numbers carrying `numeral`, good/bad shaded green -> purple).

vi.mock('astro:env/server', () => ({ getSecret: () => undefined }));

const ADMIN = {
    games: [
        {
            game_id: '401856682', matchup: 'TEX @ OSU', status: 'STATUS_IN_PROGRESS',
            away_score: 7, home_score: 10, last_poll: '2026-09-19T18:00:00Z', age_s: 45,
            qa_ok: false, qa_errors: 3, qa_warnings: 2, qa_source: 'shield', qa_fallback: true,
            qa_rules: ['score.monotone', 'live.prefix_dropped'],
        },
        {
            game_id: '401772944', matchup: 'NYJ @ BUF', status: 'STATUS_FINAL',
            away_score: 17, home_score: 24, last_poll: '2026-09-19T17:00:00Z', age_s: 3900,
            qa_ok: true, qa_errors: 0, qa_warnings: 1, qa_source: 'espn', qa_fallback: false,
            qa_rules: null,
        },
    ],
    rules: [
        { rule: 'score.monotone', day: '2026-09-18', n: 4, games: 2 },
        { rule: 'score.monotone', day: '2026-09-19', n: 9, games: 3 },
        { rule: 'live.prefix_dropped', day: '2026-09-19', n: 1, games: 1 },
    ],
    totals: { checks: 120, clean: 96, games: 14, fallbacks: 3 },
    days: 7,
    ok: true,
};

vi.mock('../src/resources/qa', () => ({ retrieveQaAdmin: vi.fn(async () => ADMIN) }));
vi.mock('../src/resources/sdv', () => ({ retrieveQaSeason: vi.fn(async () => []) }));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function render(locals: Record<string, unknown>, search = '') {
    const { default: Page } = await import('../src/pages/admin/qa.astro');
    return container.renderToResponse(Page, {
        request: new Request(`https://gameonpaper.com/admin/qa${search}`),
        locals: locals as any,
        routeType: 'page',
    });
}

describe('/admin/qa', () => {
    test('a viewer without an admin session gets nothing but the login redirect', async () => {
        const res = await render({});
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/admin/login');
        expect(await res.text()).not.toContain('TEX @ OSU');
    });

    test('an admin sees every game with its last verdict', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('TEX @ OSU');
        expect(html).toContain('/game/401856682');
        expect(html).toContain('in progress');          // STATUS_ prefix stripped
        expect(html).toContain('shield (fallback)');    // the failover is visible
        expect(html).toContain('score.monotone');
        expect(html).toContain('120 checks on 14 games');
        expect(html).toContain('80.0% clean');
    });

    test('the rule histogram has one column per day and one row per rule', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('09-18');
        expect(html).toContain('09-19');
        expect(html).toContain('live.prefix_dropped');
    });

    test('the season view says it is not published rather than showing a clean season', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('Not published yet');
        expect(html).not.toContain('No rule fired');    // the rule table has rows
    });

    test('the tables follow the site conventions', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        // every numeric cell carries `numeral`, and good/bad is the hulk ramp
        expect(html).toMatch(/class="numeral[^"]*"/);
        expect(html).toContain('hulk-bg-level-');
        expect(html).not.toMatch(/<td[^>]*bg-(danger|success)/);  // never green/red for good/bad
        // name column left, the rest centered
        expect(html).toContain('<th class="box-heading">Game</th>');
        expect(html).toContain('style="text-align: center;">Errors</th>');
        // panels, not cards
        expect(html).toContain('panel-group');
        expect(html).not.toContain('class="card"');
    });

    test('the window pills are the site filter group, and one is active', async () => {
        const html = await (await render({ adminAuthed: true }, '?days=14')).text();
        expect(html).toContain('btn btn-sm btn-outline-secondary active');
        expect(html).toContain('href="/admin/qa?days=1&amp;season=');
    });
});
