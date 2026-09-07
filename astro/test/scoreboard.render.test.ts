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

function tbdCompetitor() {
    return {
        id: '0',
        score: '0',
        team: { id: '0', abbreviation: 'TBD', location: 'TBD', conferenceId: '0' },
        curatedRank: { current: 99 },
        records: [],
    };
}

function championshipEvent(id: string) {
    // conference championship placeholder: TBD vs TBD, no announced kickoff
    const status = {
        period: 0, clock: 0,
        type: { id: '1', name: 'STATUS_SCHEDULED', completed: false, detail: 'Sat, December 5th TBD', shortDetail: '12/5 - TBD' },
    };
    return {
        id,
        date: '2026-12-05T05:00Z',
        status,
        competitions: [{
            id,
            date: '2026-12-05T05:00Z',
            status,
            timeValid: false,
            notes: [{ type: 'event', headline: 'SEC Championship Game' }],
            competitors: [tbdCompetitor(), tbdCompetitor()],
        }],
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
            games: [gameEvent('401', { completed: true }), gameEvent('402', { completed: false }), gameEvent('403', { completed: false, live: true }), championshipEvent('404')],
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
        expect(rows).toHaveLength(4);
        // both fixture games share a kickoff -> exactly one time-slot header (ET)
        const slots = [...html.matchAll(/class="gb-slot[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
        expect(slots).toHaveLength(2);
        expect(slots[0]).toMatch(/7:30 PM ET/);
        expect(slots[1]).toBe('Time TBD');
        // Option E: abbreviations with the rank AHEAD of the abbr on BOTH
        // sides (the banner list section only -- the md+ card grid also
        // renders ranks, differently)
        const banners = html.slice(html.indexOf('game-compact-list'), html.indexOf('class="row mb-3'));
        expect(banners).toMatch(/gb-rank text-muted">#5<\/span><span class="gb-abbr[^"]*">ALA</);
        // completed: winner fw-bold, loser opacity-50 (TeamRow semantics),
        // never both; live/scheduled mark nobody
        expect(banners).toMatch(/gb-pts opacity-50">17</);
        expect(banners).toMatch(/gb-pts fw-bold">24</);
        expect(banners).not.toMatch(/fw-bold opacity-50/);
        // scheduled game: ET kickoff server-rendered as the no-JS fallback,
        // with data-gb-utc for the single localization script (no islands)
        expect(html).toMatch(/data-gb-utc="2026-09-06T23:30Z"[^>]*>7:30 PM EDT</);
        expect(html).toMatch(/gb-slot[^>]*data-gb-utc=/);
        expect([...html.matchAll(/data-gb-utc="/g)].length).toBe(2); // header + 1 scheduled game (live/final carry none)
        // live game: possession badge on the logo of the team with the ball,
        // red variant in the red zone
        const liveCard = html.slice(html.indexOf('/game/403'));
        expect(liveCard.slice(0, liveCard.indexOf('</a>'))).toContain('gb-ball gb-ball-rz');
        expect(liveCard).toContain('8:32 - 3rd');
        // championship placeholder: default shield (no broken 500/0.png), note
        // line, TBD status, and NO data-gb-utc anywhere (its date is a
        // placeholder midnight the localization script must not "fix"; the
        // Time TBD slot header carries none either)
        const champCard = html.slice(html.indexOf('/game/404'));
        const champA = champCard.slice(0, champCard.indexOf('</a>'));
        expect(champA).toContain('default-team-logo-500.png');
        expect(champA).not.toContain('/500/0.png');
        expect(champA).toContain('SEC Championship Game');
        // gold championship treatment on the card and the note line
        expect(html.slice(0, html.indexOf('/game/404')).slice(-400) + champA).toContain('outline-championship');
        expect(champA).toContain('text-championship');
        expect(champA).toContain('gb-note');
        expect(champA).not.toContain('data-gb-utc');
        // the DESKTOP CARD GRID gets the same treatment (GameThumb/TeamRow):
        // TBD detail text instead of a LocalDate island on the placeholder
        // midnight, the note headline, the gold class, and shield logos --
        // no broken /500/0.png anywhere on the page
        const grid = html.slice(html.indexOf('class="row mb-3'));
        expect(grid).toContain('Sat, December 5th TBD');
        expect(grid).toContain('SEC Championship Game');
        expect(grid).toContain('text-championship');
        expect(html).not.toContain('/500/0.png');
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
