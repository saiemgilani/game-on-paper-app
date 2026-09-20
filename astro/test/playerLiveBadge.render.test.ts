import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { CURRENT_YEAR } from '../src/utils/constants';
import { badgeText, qaBadge } from '../src/utils/liveQa';

// The live badge and the QA badge on the player game log (plan P5, marker 7).
//
// They are two different claims with two different audiences (review on #268):
// "this game is being played" is public and generic, and anything about the
// payload's soundness is admin detail. A preview-cookie holder is not an admin.
//
// The `qa` shapes below are the ones GOP #265 actually produces -- copied from
// its `python/tests/test_qa.py` cases and `docs/qa-payload.md` -- INCLUDING the
// two that carry no verdict, because #265 is not merged into this branch's base:
// production answers `/process` with no `qa` key at all today, and the block is
// documented to be `null` on a pin without `sportsdataverse.validation`. Neither
// may read as "clean", and neither may cost the row.

const cfb = JSON.parse(readFileSync(new URL('./fixtures/player-cfb-4433971-2024.json', import.meta.url)).toString());

/** the gate spoke, the source was a fallback, and the live rules saw one anomaly */
const QA_FULL = {
    ok: false,
    n_errors: 2,
    n_warnings: 1,
    top_rules: [
        { rule: 'ep.ep_range', n: 9, severity: 'error' },
        { rule: 'score.monotone', n: 3, severity: 'error' },
        { rule: 'wp.wpa_sums_to_result', n: 1, severity: 'warn' },
    ],
    contract_ok: false,
    gop_ok: false,
    provenance: { source: 'shield', requested: 'shield', fallback_used: true, sdv_version: '0.1.4', sdv_sha: '7be22b5a' },
    live: {
        ok: true,
        findings: [],
        anomalies: [{ rule: 'live.prefix_dropped', n: 29, sample: '40186653299', severity: 'warn' }],
        polls: 7,
        since: '2026-09-19T18:02:11+00:00',
    },
};

/** the deployed pin has no validation package: the gate is silent, the live rules still answer */
const QA_NO_GATE = {
    ok: true,
    n_errors: null,
    n_warnings: null,
    top_rules: [],
    contract_ok: null,
    gop_ok: null,
    provenance: { source: 'espn', requested: null, fallback_used: false, sdv_version: '0.1.4', sdv_sha: '7be22b5a' },
    live: { ok: true, findings: [], anomalies: [], polls: 1, since: '2026-09-19T18:02:11+00:00' },
};

const LIVE_ID = String(cfb.games.data[0].game_id);
// the game log, moved onto the current season -- only a current-season page can
// have a game in progress, and the guard that says so is the one being tested
const games = cfb.games.data.map((g: any, i: number) => (i === 0
    ? { ...g, season: CURRENT_YEAR, result: null, team_score: 14, opponent_score: 10 }
    : { ...g, season: CURRENT_YEAR }));
const identity = { ...cfb.identity, seasons: [CURRENT_YEAR], latest_season: CURRENT_YEAR };

/** what the mocked hops answer; each test sets the two lines it cares about */
const world: { live: string[], payload: any, fail: boolean } = { live: [], payload: {}, fail: false };
const processed = vi.fn();

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePlayer: async () => identity,
    retrievePlayerSeasons: async () => cfb.seasons.data,
    retrievePlayerGames: async () => games,
    retrievePlayerSplits: async () => cfb.splits.data,
    retrieveNflEspnGameIds: async () => ({}),
    retrieveTeamSummaries: async () => [],
    resolveEspnAthleteId: async () => null,
}));
vi.mock('../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../src/resources/espn')>()),
    getCurrentScoreboard: async () => world.live.map((id) => ({
        id, competitions: [{ status: { type: { state: 'in', name: 'STATUS_IN_PROGRESS', completed: false } } }],
    })),
}));
vi.mock('../src/resources/python', async (orig) => ({
    ...(await orig<typeof import('../src/resources/python')>()),
    retrieveProcessedGame: (...args: unknown[]) => {
        processed(...args);
        return world.fail ? Promise.reject(new Error('502 from the processor')) : Promise.resolve(world.payload);
    },
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
beforeEach(() => {
    world.live = [];
    world.payload = {};
    world.fail = false;
    processed.mockClear();
});

async function renderPage(locals: Record<string, unknown> = {}): Promise<string> {
    const { default: Page } = await import('../src/pages/players/[id].astro');
    return container.renderToString(Page, {
        params: { id: '4433971' },
        request: new Request(`https://gameonpaper.com/players/4433971?season=${CURRENT_YEAR}`),
        locals: { preview: true, ...locals } as any,
    });
}

/** the `<td>`s of the Result column, exactly as they render */
const resultCells = (html: string): string[] =>
    [...html.split('id="player-game-log"')[1].split('</table>')[0]
        .matchAll(/<td class="text-center text-nowrap numeral" colspan="1">[\s\S]*?<\/td>/g)].map((m) => m[0]);

describe('the badge copy, over the shapes #265 produces', () => {
    test('a full block: served source, fallback flag, verdict and anomaly count', () => {
        const b = qaBadge({ qa: QA_FULL } as any);
        expect(b).toMatchObject({ source: 'shield', fallback: true, verdict: '2 errors, 1 warning', anomalies: 1 });
        expect(badgeText(b)).toBe('Served: shield (fallback), QA 2 errors, 1 warning, 1 anomaly');
        // the admin detail is #263's vocabulary: rule x rows, errors first
        expect(b.rules).toBe('ep.ep_range×9, score.monotone×3, wp.wpa_sums_to_result×1');
    });

    test('a silent gate still carries the live verdict, and counts nothing it did not count', () => {
        const b = qaBadge({ qa: QA_NO_GATE } as any);
        expect(badgeText(b)).toBe('Served: espn, QA ok');
        expect(b.rules).toBe('');
    });

    test('a live error tier reads as not ok even when the gate counted nothing', () => {
        const qa = { ...QA_NO_GATE, ok: false, live: { ...QA_NO_GATE.live, ok: false, findings: [{ rule: 'live.phase_order', n: 1 }] } };
        expect(badgeText(qaBadge({ qa } as any))).toBe('Served: espn, QA not ok');
    });

    test('`qa: null` and an absent `qa` both read as the source alone -- never as clean', () => {
        for (const payload of [{ qa: null }, {}]) {
            const b = qaBadge(payload as any);
            expect(b.verdict).toBeNull();
            expect(badgeText(b)).toBe('Served: espn');
        }
    });
});

describe('the live badge is public and generic', () => {
    test('an in-progress game gets the Live pill; every other row is untouched', async () => {
        world.live = [LIVE_ID];
        world.payload = { qa: QA_FULL };
        const html = await renderPage();
        const cells = resultCells(html);
        expect(cells[0]).toContain('<span class="badge bg-danger ms-1" title="This game is in progress">Live</span>');
        // a final row renders EXACTLY the markup it rendered before this change
        expect(cells[1]).toBe('<td class="text-center text-nowrap numeral" colspan="1">W 31-28</td>');
        expect(cells.filter((c) => c.includes('>Live<'))).toHaveLength(1);
    }, 60_000);

    test('the live claim costs one scoreboard read and NO processing run', async () => {
        // The public reader is shown nothing from the payload, so the payload is
        // never fetched: the split is a real saving, not just a hidden element.
        world.live = [LIVE_ID];
        world.payload = { qa: QA_FULL };
        const html = await renderPage();
        expect(html).toContain('>Live<');
        expect(processed).not.toHaveBeenCalled();
    }, 60_000);

    test('nothing live: the page is byte-identical, and nothing is processed', async () => {
        const html = await renderPage();
        expect(html).not.toContain('>Live<');
        expect(processed).not.toHaveBeenCalled();
        // the pre-change markup of every Result cell, unchanged
        expect(resultCells(html)[0]).toBe('<td class="text-center text-nowrap numeral" colspan="1">— 14-10</td>');
        expect(resultCells(html)[1]).toBe('<td class="text-center text-nowrap numeral" colspan="1">W 31-28</td>');
    }, 60_000);
});

describe('the QA badge is admin only', () => {
    test('a reader is shown nothing about the payload, however bad it is', async () => {
        world.live = [LIVE_ID];
        world.payload = { qa: QA_FULL };
        const reader = await renderPage();
        expect(reader).toContain('>Live<');
        for (const leak of ['data-status-detail', 'Served:', 'QA ', 'shield', 'ep.ep_range', 'anomaly']) {
            expect(reader, leak).not.toContain(leak);
        }
    }, 60_000);

    test('a preview-cookie holder is not an admin', async () => {
        // renderPage always passes `preview: true` -- the pages are behind the
        // flag -- so this is the distinction that matters in practice.
        world.live = [LIVE_ID];
        world.payload = { qa: QA_FULL };
        expect(await renderPage({ preview: true })).not.toContain('data-status-detail');
    }, 60_000);

    test('an admin gets the source, the verdict and the rule list', async () => {
        world.live = [LIVE_ID];
        world.payload = { qa: QA_FULL };
        const admin = await renderPage({ adminAuthed: true });
        expect(admin).toContain('>Live<');
        expect(admin).toContain('data-status-detail="live-qa"');
        expect(admin).toContain('Served: shield (fallback), QA 2 errors, 1 warning, 1 anomaly');
        expect(admin).toContain('title="ep.ep_range×9, score.monotone×3, wp.wpa_sums_to_result×1"');
        // ...through the game page's own path, on its own cache key: one call, the live game's
        expect(processed).toHaveBeenCalledTimes(1);
        expect(processed.mock.calls[0][0]).toBe(LIVE_ID);
    }, 60_000);

    test('no `qa` block: the source alone, and no verdict invented', async () => {
        world.live = [LIVE_ID];
        world.payload = { qa: null };
        const admin = await renderPage({ adminAuthed: true });
        expect(admin).toContain('>Served: espn</span>');
        expect(admin).not.toContain('QA ok');
    }, 60_000);

    test('the payload is unavailable: the row keeps its Live pill and gains nothing else', async () => {
        world.live = [LIVE_ID];
        world.fail = true;
        const html = await renderPage({ adminAuthed: true });
        expect(html).not.toContain('data-status-detail');
        expect(resultCells(html)[0]).toContain('>Live<');
    }, 60_000);
});

describe('an admin render never enters Workers Caching', () => {
    // A HIT never runs the middleware, so an admin variant in Workers Caching
    // would serve the QA detail to everyone -- the bug reviewed on #213.
    test('withPreviewCacheGuard opts an admin-authed response out', async () => {
        const { withPreviewCacheGuard } = await import('../src/middleware');
        const ctx: any = { request: new Request('https://gameonpaper.com/players/4433971'), locals: { adminAuthed: true }, cache: { set: () => {} } };
        const res = withPreviewCacheGuard(ctx, new Response('ok'));
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
});
