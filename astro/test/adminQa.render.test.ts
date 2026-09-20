import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { QaAdmin } from '../src/resources/qa';

// /admin/qa renders the validation signal every /process response now carries.
// Two things have to hold: it is admin-only whatever the middleware did, and
// the tables follow the site's table conventions (name column left, everything
// else centered, numbers carrying `numeral`, good/bad shaded green -> purple).

vi.mock('astro:env/server', () => ({ getSecret: () => undefined }));

const ADMIN: QaAdmin = {
    games: [
        {
            game_id: '401856682', league: 'cfb', matchup: 'TEX @ OSU', status: 'STATUS_IN_PROGRESS',
            away_score: 7, home_score: 10, last_poll: '2026-09-19T18:00:00Z', age_s: 45,
            qa_ok: false, qa_errors: 3, qa_warnings: 2, qa_source: 'shield', qa_fallback: true,
            qa_rules: ['score.monotone', 'live.prefix_dropped'],
        },
        {
            game_id: '401772944', league: 'nfl', matchup: 'NYJ @ BUF', status: 'STATUS_FINAL',
            away_score: 17, home_score: 24, last_poll: '2026-09-19T17:00:00Z', age_s: 3900,
            qa_ok: true, qa_errors: 0, qa_warnings: 1, qa_source: 'espn', qa_fallback: false,
            qa_rules: null,
        },
    ],
    rules: [
        { rule: 'score.monotone', day: '2026-09-18T00:00:00Z', n: 4, games: 2 },
        { rule: 'score.monotone', day: '2026-09-19T00:00:00Z', n: 9, games: 3 },
        { rule: 'live.prefix_dropped', day: '2026-09-19T00:00:00Z', n: 1, games: 1 },
    ],
    totals: { checks: 120, clean: 96, games: 14, fallbacks: 3 },
    days: 7,
    ok: true,
};

let STORE: QaAdmin = ADMIN;
vi.mock('../src/resources/qa', () => ({ retrieveQaAdmin: vi.fn(async () => STORE) }));
vi.mock('../src/resources/sdv', () => ({ retrieveQaSeason: vi.fn(async () => SEASON) }));
import { retrieveQaSeason } from '../src/resources/sdv';
let SEASON: { rows: any[], ok: boolean } = { rows: [], ok: true };

beforeEach(() => { STORE = ADMIN; SEASON = { rows: [], ok: true }; });

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
        expect(html).toContain('in progress');          // STATUS_ prefix stripped
        expect(html).toContain('shield (fallback)');    // the failover is visible
        expect(html).toContain('score.monotone');
        expect(html).toContain('120 checks on 14 games');
        expect(html).toContain('80.0% clean');
    });

    test('the rule histogram has one column per day and one row per rule', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('live.prefix_dropped');
        expect(html).toContain('09-18');
        expect(html).toContain('09-19');
        // the header carries the bucket's INSTANT, which the inline script
        // rewrites into the viewer's timezone; the UTC label is the fallback
        expect(html).toContain('data-qa-utc="2026-09-18T00:00:00Z"');
        expect(html).toContain('data-qa-utc="2026-09-19T00:00:00Z"');
        expect(html).toContain("querySelectorAll('[data-qa-utc]')");
    });

    test('every game row says its league and links league-aware', async () => {
        // the page is not under /nfl, so nothing but the row can say which
        // league a game belongs to -- a bare /game/<id> sends every NFL game
        // to the CFB page
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('href="/game/401856682"');       // cfb: unprefixed
        expect(html).toContain('href="/nfl/game/401772944"');
        expect(html).toContain('>CFB<');
        expect(html).toContain('>NFL<');
    });

    test('the season panel asks both leagues and tags each row with its own', async () => {
        SEASON = { rows: [{ game_id: '401772944', source: 'espn', processing_version: '0.1.4', n_errors: 1, n_warnings: 0, failed_rule_ids: ['score.monotone'] }], ok: true };
        const html = await (await render({ adminAuthed: true })).text();
        expect(retrieveQaSeason).toHaveBeenCalledWith(expect.any(Number), 'cfb');
        expect(retrieveQaSeason).toHaveBeenCalledWith(expect.any(Number), 'nfl');
        // the same row comes back for both leagues here, so the nfl copy is the
        // proof the link follows the row and not the page
        expect(html).toContain('href="/nfl/game/401772944"');
        expect(html).toContain('href="/game/401772944"');
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

    test('an empty store says the query answered, not that nothing is wrong', async () => {
        // day one: the migration has not run, so every table is empty
        STORE = { games: [], rules: [], totals: {}, days: 7, ok: true };
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('No game has been checked in the past 24 hours');
        expect(html).toContain('No rule fired in this window');
        expect(html).toContain('Not published yet');
    });

    test('a store that did not answer says so rather than showing an empty table', async () => {
        STORE = { games: [], rules: [], totals: {}, days: 7, ok: false };
        SEASON = { rows: [], ok: false };
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).toContain('The telemetry store did not answer');
        expect(html).toContain('The Sportsdataverse API did not answer');
        expect(html).not.toContain('Not published yet');   // a different claim
        expect(html).not.toContain('No rule fired');
    });

    test('the window filter is a season-selector-style dropdown, right-aligned on desktop', async () => {
        const html = await (await render({ adminAuthed: true }, '?days=14')).text();
        expect(html).toContain('justify-content-start justify-content-md-end');
        expect(html).toContain('class="form-select form-select-md"');
        expect(html).toMatch(/<option value="14"[^>]*selected/);
        // the badge and the back link went with the breadcrumb that already has both
        expect(html).not.toContain('badge text-bg-danger');
        expect(html).not.toContain('Back to admin');
    });

    test('the page calls itself QA, the name in its own URL', async () => {
        const html = await (await render({ adminAuthed: true })).text();
        expect(html).not.toContain('Validation');
        expect(html).toContain('<h2 class="mb-0">QA</h2>');
    });
});
