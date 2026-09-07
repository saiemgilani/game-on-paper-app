import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test } from 'vitest';

// The compact scoreboard rows ('scoreboard-compact' flag) must render for a
// previewing admin and stay entirely absent from the public page.

function competitor(id: string, abbr: string, score: string, rank = 99) {
    return {
        id,
        score,
        team: { id, abbreviation: abbr, conferenceId: '8', color: 'ba0c2f', location: `${abbr} State` },
        curatedRank: { current: rank },
        records: [],
    };
}

function gameEvent(id: string, opts: { completed: boolean; live?: boolean }) {
    const status = opts.live
        ? {
            period: 3,
            clock: 512,
            type: { id: '2', name: 'STATUS_IN_PROGRESS', completed: false, detail: '8:32 - 3rd', shortDetail: '8:32 - 3rd' },
        }
        : {
            period: opts.completed ? 4 : 0,
            clock: 0,
            type: {
                id: opts.completed ? '3' : '1',
                name: opts.completed ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
                completed: opts.completed,
                detail: opts.completed ? 'Final' : 'Sat, September 6th at 7:30 PM EDT',
                shortDetail: opts.completed ? 'Final' : '9/6 - 7:30 PM EDT',
            },
        };
    return {
        id,
        date: '2026-09-06T23:30Z',
        status,
        competitions: [{
            id,
            date: '2026-09-06T23:30Z',
            status,
            notes: [],
            // ids chosen off the MEME_LIST (61 = UGA renders lowercased on purpose)
            competitors: [competitor('333', 'ALA', '24', 5), competitor('2', 'AUB', '17')],
            // the live game: ALA has the ball in the red zone
            ...(opts.live ? { situation: { lastPlay: { end: { team: { id: '333' } } }, isRedZone: true } } : {}),
        }],
    };
}

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function render(locals: Record<string, unknown>) {
    const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
    return container.renderToString(SchedulePage, {
        props: {
            season: 2026, week: 2, isScoreboard: true,
            games: [gameEvent('401', { completed: true }), gameEvent('402', { completed: false }), gameEvent('403', { completed: false, live: true })],
        },
        request: new Request('https://gameonpaper.com/'),
        locals,
    });
}

describe('the compact scoreboard rows are preview-gated', () => {
    test('preview renders banner rows under a kickoff-time header, card grid demoted to md+', async () => {
        const html = await render({ preview: true });
        expect(html).toContain('game-compact-list');
        const rows = [...html.matchAll(/class="game-banner[" ]/g)];
        expect(rows).toHaveLength(3);
        // both fixture games share a kickoff -> exactly one time-slot header (ET)
        const slots = [...html.matchAll(/class="gb-slot[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
        expect(slots).toHaveLength(1);
        expect(slots[0]).toMatch(/7:30 PM ET/);
        // full school names, not truncated abbreviation pairs
        expect(html).toContain('ALA State');
        expect(html).toContain('AUB State');
        // completed: winner fw-bold, loser opacity-50 (Bootstrap utilities,
        // TeamRow semantics), never both; live/scheduled mark nobody
        expect(html).toMatch(/gb-pts fs-5 opacity-50">17</);
        expect(html).toMatch(/gb-pts fs-5 fw-bold">24</);
        expect(html).not.toMatch(/fw-bold opacity-50/);
        // team-color stripe carries the ESPN hex
        expect(html).toContain('style="background:#ba0c2f"');
        // scheduled game: ET kickoff server-rendered as the no-JS fallback,
        // with data-gb-utc for the single localization script (no islands)
        expect(html).toMatch(/data-gb-utc="2026-09-06T23:30Z"[^>]*>7:30 PM EDT</);
        expect(html).toMatch(/gb-slot[^>]*data-gb-utc=/);
        expect([...html.matchAll(/data-gb-utc="/g)].length).toBe(2); // header + 1 scheduled game (live/final carry none)
        // live game: possession dot on the team with the ball, red in the red zone
        const liveCard = html.slice(html.indexOf('/game/403'));
        expect(liveCard.slice(0, liveCard.indexOf('</a>'))).toContain('text-danger');
        expect(liveCard).toContain('8:32 - 3rd');
        expect(html).toContain("querySelectorAll('[data-gb-utc]')");
        // the card grid is still there for md+, hidden on phones
        expect(html).toMatch(/class="row mb-3 d-none d-md-flex"/);
    });

    test('the public page has no trace of the compact variant', async () => {
        const html = await render({});
        expect(html).not.toContain('game-compact');
        expect(html).not.toContain('game-banner');
        expect(html).not.toContain('d-none d-md-flex');
    });
});
