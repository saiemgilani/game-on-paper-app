import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import {
    ago, asLeague, qaDayLabel, qaGamesTable, qaRulesTable, qaSeasonTable, qaSummary, statusText,
    type QaAdmin, type QaSeason,
} from '../src/utils/adminQa';

// QA is a tab on /admin (#qa), rendered client-side by that page's `table()`
// helper like every other tab. The rows are built here so they can be asserted:
// both leagues marked and linked, counts shaded, and an empty table that says
// whether the query failed or the window was clean.

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
};
const EMPTY: QaAdmin = { games: [], rules: [], totals: {}, days: 7 };
const text = (t: { rows: { cells: unknown[] }[] }) =>
    t.rows.flatMap((r) => r.cells).map((c) => (typeof c === 'object' && c !== null ? (c as { v: string }).v : String(c))).join(' | ');

describe('the games table', () => {
    const t = qaGamesTable(ADMIN, true);

    test('every row says its league and links league-aware', () => {
        // /admin is not under /nfl, so nothing but the row can say which league
        // a game belongs to: a bare /game/<id> sends every NFL game to the CFB page
        expect(text(t)).toContain('href="/game/401856682"');
        expect(text(t)).toContain('href="/nfl/game/401772944"');
        expect(t.rows[0].cells[1]).toBe('CFB');
        expect(t.rows[1].cells[1]).toBe('NFL');
    });

    test('the verdict is readable: status prefix stripped, failover named, counts shaded', () => {
        expect(t.rows[0].cells[2]).toBe('in progress');
        expect(t.rows[0].cells[3]).toBe('shield (fallback)');
        // the ramp is fixed at five errors, so a clean game is green and the
        // middle of the scale is deliberately unshaded
        expect(t.rows[1].cells[4]).toEqual({ v: '0', cls: 'hulk-bg-level-9' });
        expect(t.rows[0].cells[4]).toEqual({ v: '3', cls: '' });
        expect(text(t)).toContain('score.monotone, live.prefix_dropped');
        expect(t.head).toEqual(['Game', 'League', 'Status', 'Source', 'Errors', 'Warnings', 'Rules', 'Last poll']);
    });

    test('an empty store says the query answered, a failed one says it did not', () => {
        expect(qaGamesTable(EMPTY, true).note).toContain('No game has been checked in the past 24 hours');
        expect(qaGamesTable(EMPTY, false).note).toContain('The telemetry store did not answer');
        expect(t.note).toBe('');
    });

    test('values from upstream are escaped, since the tab writes innerHTML', () => {
        const nasty = qaGamesTable({ ...EMPTY, games: [{ ...ADMIN.games[0], matchup: '<img src=x onerror=alert(1)>' }] }, true);
        expect(text(nasty)).not.toContain('<img');
        expect(text(nasty)).toContain('&lt;img');
    });
});

describe('the rule histogram', () => {
    const t = qaRulesTable(ADMIN, true);

    test('one column per day, one row per rule, worst rule first', () => {
        expect(t.head).toHaveLength(5);                       // Rule, 2 days, Total, Games
        expect(t.rows.map((r) => r.cells[0])).toEqual(['score.monotone', 'live.prefix_dropped']);
        expect(t.rows[0].cells.at(-2)).toBe('13');            // 4 + 9
        expect(t.rows[0].cells.at(-1)).toBe('5');
        expect(t.rows[1].cells[1]).toEqual({ v: '', cls: '' }); // no cell that day
    });

    test('the day headers are the viewer timezone, not the database one', () => {
        // the bucket arrives as a UTC instant precisely so it can be converted
        expect(t.head[1]).toBe(qaDayLabel('2026-09-18T00:00:00Z'));
        expect(t.head[1]).toMatch(/^\d{1,2}\/\d{1,2}$/);
        expect(qaDayLabel('2026-13-45T00:00:00Z')).toBe('13-45');   // fallback: the raw month-day
    });

    test('shading is relative to the worst cell in the matrix', () => {
        const cells = t.rows.flatMap((r) => r.cells.filter((c) => typeof c === 'object')) as { v: string, cls: string }[];
        expect(cells.find((c) => c.v === '9')!.cls).toContain('hulk-bg-level-0');   // the worst
        expect(cells.find((c) => c.v === '')!.cls).toBe('');
    });

    test('an empty window and a failed query are different claims', () => {
        expect(qaRulesTable(EMPTY, true).note).toContain('No rule fired in this window');
        expect(qaRulesTable(EMPTY, false).note).toContain('did not answer');
    });
});

describe('the window summary', () => {
    test('reads the totals for the chosen window', () => {
        expect(qaSummary(ADMIN, true)).toBe('120 checks on 14 games, 80.0% clean, 3 served by a fallback source.');
    });
    test('says nothing when the query failed, so the note can say why', () => {
        expect(qaSummary(EMPTY, false)).toBe('');
        expect(qaSummary(EMPTY, true)).toContain('0 checks on 0 games');
    });
});

describe('the season table', () => {
    const row = { game_id: '401772944', source: 'espn', processing_version: '0.1.4', n_errors: 1, n_warnings: 0, failed_rule_ids: ['score.monotone'] };
    const season: QaSeason = { season: 2026, ok: true, rows: [{ ...row, league: 'cfb' }, { ...row, league: 'nfl' }] };

    test('each row links by its own league, not the page', () => {
        const t = qaSeasonTable(season);
        expect(text(t)).toContain('href="/game/401772944"');
        expect(text(t)).toContain('href="/nfl/game/401772944"');
    });

    test('unpublished and unreachable are different sentences', () => {
        expect(qaSeasonTable({ season: 2026, ok: true, rows: [] }).note).toContain('Not published yet');
        expect(qaSeasonTable({ season: 2026, ok: false, rows: [] }).note).toContain('The Sportsdataverse API did not answer');
    });
});

describe('small helpers', () => {
    test('an unknown league reads cfb, the site default', () => {
        expect(asLeague('nfl')).toBe('nfl');
        expect(asLeague(null)).toBe('cfb');
        expect(asLeague('xfl')).toBe('cfb');
    });
    test('status text and age are human', () => {
        expect(statusText(null)).toBe('unknown');
        expect(statusText('STATUS_END_PERIOD')).toBe('end period');
        expect([ago(45), ago(600), ago(7200)]).toEqual(['45s', '10m', '2h']);
    });
});

describe('the admin page', () => {
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
    });

    test('QA is a tab beside the others, not an action button to its own page', async () => {
        const { default: Page } = await import('../src/pages/admin/index.astro');
        const html = await container.renderToString(Page, {
            request: new Request('https://gameonpaper.com/admin'),
            locals: { adminAuthed: true } as any,
        });
        expect(html).toContain('data-t="qa">QA<');
        expect(html).toContain('id="t-qarules"');
        expect(html).not.toContain('href="/admin/qa"');
        // the window belongs to the section it filters, not to the page
        const rulesAt = html.indexOf('Findings by rule');
        expect(html.indexOf('id="qa-window"')).toBeGreaterThan(rulesAt);
        expect(html.indexOf('id="t-qarules"')).toBeGreaterThan(html.indexOf('id="qa-window"'));
        expect(html.indexOf('id="qa-window"')).toBeGreaterThan(html.indexOf('id="t-qagames"'));
    });

    test('the old /admin/qa link lands on the tab', async () => {
        const { default: Page } = await import('../src/pages/admin/qa.astro');
        const res = await container.renderToResponse(Page, {
            request: new Request('https://gameonpaper.com/admin/qa'),
            locals: { adminAuthed: true } as any,
            routeType: 'page',
        });
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe('/admin#qa');
    });
});
