import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { readFileSync } from 'node:fs';
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

function gameEvent(id: string, opts: { completed: boolean; live?: boolean; ballTeamId?: string }) {
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
            ...(opts.live ? { situation: { lastPlay: { end: { team: { id: opts.ballTeamId ?? '333' } } }, isRedZone: opts.ballTeamId == null } } : {}),
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
        // slots are keyed by ET day + time; the fixture spans two dates, so
        // labels carry the day prefix and the headers carry data-gb-fmt so the
        // localization script keeps the date in its rewrite (CodeRabbit: two
        // Saturdays sharing "12:00 PM" must not merge under one header)
        const slots = [...html.matchAll(/class="gb-slot[^"]*"[^>]*>\s*([^<]+)</g)].map((m) => m[1].trim());
        expect(slots).toHaveLength(2);
        expect(slots[0]).toMatch(/^\w+, 9\/6 - 7:30 PM ET$/);
        expect(slots[1]).toMatch(/^\w+, 12\/5 - Time TBD$/);
        expect(html).toMatch(/data-gb-utc="2026-09-06T23:30Z"[^>]*data-gb-fmt="datetime"/);
        // Option E: abbreviations with the rank AHEAD of the abbr on BOTH
        // sides (the banner list section only -- the md+ card grid also
        // renders ranks, differently)
        const banners = html.slice(html.indexOf('game-compact-list'), html.indexOf('class="row mb-3'));
        // rank lives INSIDE the abbr span so both share a text baseline
        expect(banners).toMatch(/gb-abbr[^>]*><span class="gb-rank text-muted">#5<\/span> ALA</);
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
        // live game: possession dot inside the abbreviation of the team with the ball,
        // red variant in the red zone
        const liveCard = html.slice(html.indexOf('/game/403'));
        expect(liveCard.slice(0, liveCard.indexOf('</a>'))).toMatch(/class="gb-ball [^"]*gb-ball-rz"/);
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

// Launch condition for 'scoreboard-compact' (Akshay, sign-off ledger): the
// possession marker sits on the row's interior, facing the score. Akshay's
// #356 review: it belongs inside the abbreviation, not beside the logo -- so
// the dot lives in the .gb-abbr span (after the away abbr, ahead of the home
// rank and abbr), the desktop TeamRow's "ABBR dot" mirrored.
describe('the compact row possession marker', () => {
    async function row(ballTeamId: string, unrankedHome = false) {
        const game = gameEvent('403', { completed: false, live: true, ballTeamId });
        if (unrankedHome) game.competitions[0].competitors[0].curatedRank.current = 99;
        const { default: GameCompactRow } = await import('../src/components/schedule/GameCompactRow.astro');
        return container.renderToString(GameCompactRow, {
            props: { game },
            request: new Request('https://gameonpaper.com/'),
            locals: { preview: true },
        });
    }
    // competitors[0] is home (ALA, 333, ranked #5), competitors[1] away (AUB,
    // 2, unranked); the hidden text names the team, so a screen reader hears
    // who has the ball
    const dot = (abbr: string, margin: string) => String.raw`<span class="gb-ball ${margin}[^"]*"><span class="visually-hidden">${abbr} has the ball</span></span>`;
    // every logo wrapper's contents: the logo <img> and nothing else
    const logoWrappers = (html: string) => [...html.matchAll(/<span class="gb-logo[^"]*">([\s\S]*?)<\/span>/g)].map((m) => m[1]);

    test('away team with the ball: the dot is inside the away abbreviation, after it', async () => {
        const html = await row('2');
        expect([...html.matchAll(/class="gb-ball/g)]).toHaveLength(1);
        expect(html).toMatch(new RegExp(String.raw`<span class="gb-abbr[^"]*">\s*AUB` + dot('AUB', 'ms-1') + String.raw`</span>`));
        // not beside the logo: neither logo wrapper holds a dot
        const logos = logoWrappers(html);
        expect(logos).toHaveLength(2);
        for (const inner of logos) expect(inner).not.toContain('gb-ball');
        // outside the red zone the dot is the primary (not danger) variant
        expect(html).not.toContain('gb-ball-rz');
    });

    test('home team with the ball: the dot is inside the home abbreviation, ahead of the rank', async () => {
        const html = await row('333');
        expect([...html.matchAll(/class="gb-ball/g)]).toHaveLength(1);
        expect(html).toMatch(new RegExp(String.raw`<span class="gb-abbr[^"]*">` + dot('ALA', 'me-1') + String.raw`<span class="gb-rank text-muted">#5</span> ALA</span>`));
        const logos = logoWrappers(html);
        expect(logos).toHaveLength(2);
        for (const inner of logos) expect(inner).not.toContain('gb-ball');
    });

    test('an unranked home team: the dot sits right against the abbr, no stray space', async () => {
        const html = await row('333', true);
        expect(html).toMatch(new RegExp(String.raw`<span class="gb-abbr[^"]*">` + dot('ALA', 'me-1') + 'ALA</span>'));
    });

    test('the dot is inline in the abbreviation text instead of overlaying the logo corner', () => {
        const css = readFileSync(new URL('../public/assets/css/index.css', import.meta.url), 'utf8');
        const rule = (sel: string) => {
            const at = css.indexOf(sel + ' {');
            return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
        };
        const ball = rule('.game-banner .gb-ball');
        expect(ball).not.toBe('');
        expect(ball).not.toMatch(/position:\s*absolute/);
        expect(ball).toMatch(/display:\s*inline-block/);
        expect(rule('.game-banner .gb-logo')).toMatch(/display:\s*flex/);
        // the logo is what gives way when a double-ranked side carries the dot
        // at 320, so neither the abbr nor the dot is clipped
        expect(rule('.game-banner .gb-logo')).toMatch(/min-width:\s*0/);
        // spacing is a Bootstrap utility on the markup, not a bespoke CSS value
        // (docs/design-conventions.md: "Spacing is Bootstrap utilities only")
        expect(rule('.game-banner .gb-logo')).not.toMatch(/gap:/);
    });
});

// G12 ('spice-cues'): the spice border gets words. With the flag on, a card
// whose level draws a coloured border carries the label as text and as the
// bordered element's name, the compact row (no border) carries the text, and
// the legend reads the same SPICE_LABEL words in border order. Flag off, none
// of it renders and the legend keeps its old wording.
describe('spice cues', () => {
    // ALA (#5, home) v unranked AUB, 4th quarter, 3:00 left, 24-17: the ranked
    // upset check (3rd/4th, <= 7:30, one score) fires
    function spicedEvent(id: string) {
        const e: any = gameEvent(id, { completed: false, live: true, ballTeamId: '2' });
        e.status = { period: 4, clock: 180, type: { id: '2', name: 'STATUS_IN_PROGRESS', completed: false, detail: '3:00 - 4th', shortDetail: '3:00 - 4th' } };
        e.competitions[0].status = e.status;
        return e;
    }
    async function page(locals: Record<string, unknown>) {
        const { default: SchedulePage } = await import('../src/components/schedule/SchedulePage.astro');
        return container.renderToString(SchedulePage, {
            props: { season: 2026, week: 2, isScoreboard: true, games: [spicedEvent('405'), gameEvent('401', { completed: true })] },
            request: new Request('https://gameonpaper.com/'),
            locals,
        });
    }
    const legend = (html: string) => [...html.slice(html.indexOf('Game border color guide')).matchAll(/<li><strong>(\w+)<\/strong> - ([^<]+)<\/li>/g)].map((m) => `${m[1]} - ${m[2]}`);

    test('flag on: the spiced card names its border, the plain card does not', async () => {
        const html = await page({ preview: true });
        const grid = html.slice(html.indexOf('class="row mb-3'));
        expect(grid).toMatch(/class="row border rounded m-2 mb-4 spice-level-ranked-upset" role="group" aria-label="Ranked upset"/);
        expect(grid).toContain('<span class="text-small text-muted text-nowrap ms-auto ps-2">Ranked upset</span>');
        // the final game draws the gray border and carries neither cue
        expect(grid).toMatch(/class="row border rounded m-2 mb-4 spice-level-none">/);
        expect([...grid.matchAll(/role="group" aria-label="/g)]).toHaveLength(1);
        expect([...grid.matchAll(/text-muted text-nowrap ms-auto ps-2">Ranked upset/g)]).toHaveLength(1);
    });

    test('flag on: the compact row carries the words on its note line, and only the spiced row', async () => {
        const html = await page({ preview: true });
        const rows = html.slice(html.indexOf('game-compact-list'), html.indexOf('class="row mb-3'));
        // both rows must be there, or slicing at a missing one (-1) would
        // "find" no cue and pass vacuously
        expect(rows).toContain('/game/405');
        expect(rows).toContain('/game/401');
        const spiced = rows.slice(rows.indexOf('/game/405'));
        expect(spiced.slice(0, spiced.indexOf('</a>'))).toMatch(/<span class="gb-note small d-flex justify-content-center overflow-hidden text-muted">\s*<span class="text-nowrap flex-shrink-0 text-muted">Ranked upset<\/span>\s*<\/span>/);
        const plain = rows.slice(rows.indexOf('/game/401'));
        expect(plain.slice(0, plain.indexOf('</a>'))).not.toContain('gb-note');
        // a row is a link whose name is its text; an aria-label would replace it
        expect(rows).not.toContain('aria-label');
    });

    async function notedRow(headline: string, locals: Record<string, unknown> = { preview: true }) {
        const { default: GameCompactRow } = await import('../src/components/schedule/GameCompactRow.astro');
        const e = spicedEvent('406');
        e.competitions[0].notes = [{ type: 'event', headline }];
        return container.renderToString(GameCompactRow, {
            props: { game: e }, request: new Request('https://gameonpaper.com/'), locals,
        });
    }

    test('flag on: a row with an ESPN note and a cue keeps ONE note line', async () => {
        const html = await notedRow('Iron Bowl');
        expect([...html.matchAll(/class="gb-note/g)]).toHaveLength(1);
        // the cue is its own span after a ps-2 gap (the desktop card's cue
        // spacing), with no separator glyph between note and cue
        expect(html).toMatch(/<span class="text-truncate">Iron Bowl<\/span> <span class="text-nowrap flex-shrink-0 text-muted ps-2">Ranked upset<\/span>/);
        expect(html).not.toMatch(/[·•]/);
    });

    // Self-review on #360: bowl games carry the longest notes, and a single
    // text-truncate line cut the cue off at 320-375px. Only the note may
    // shrink: it is the one truncating item; the cue never shrinks.
    test('flag on: a long bowl note truncates, the cue does not', async () => {
        const html = await notedRow('CFP Semifinal at the Allstate Sugar Bowl');
        const note = html.slice(html.indexOf('class="gb-note'), html.indexOf('</a>'));
        expect(note).toMatch(/^class="gb-note small d-flex justify-content-center overflow-hidden /);
        expect(note).toContain('<span class="text-truncate">CFP Semifinal at the Allstate Sugar Bowl</span>');
        expect(note).toContain('<span class="text-nowrap flex-shrink-0 text-muted ps-2">Ranked upset</span>');
        // nothing but the note itself truncates
        expect([...note.matchAll(/text-truncate/g)]).toHaveLength(1);
    });

    test('flag off: the note line is the original single truncating span', async () => {
        const html = await notedRow('CFP Semifinal at the Allstate Sugar Bowl', { preview: true, flagOverrides: { 'spice-cues': false } });
        expect(html).toContain('<span class="gb-note small text-center text-truncate text-championship">CFP Semifinal at the Allstate Sugar Bowl</span>');
        expect(html).not.toContain('Ranked upset');
    });

    test('flag on: the legend reads SPICE_LABEL, in border order', async () => {
        const { SPICE_LABEL } = await import('../src/utils/misc');
        expect(legend(await page({ preview: true }))).toEqual([
            'Gray - normal',
            `Green - ${SPICE_LABEL['close-late']}`,
            `Yellow - ${SPICE_LABEL['ranked-upset']}`,
            `Orange - ${SPICE_LABEL['ranked-close-late']}`,
            `Red - ${SPICE_LABEL['fcs-upset']}`,
        ]);
    });

    test('flag off: no cue anywhere and the legend keeps its wording', async () => {
        for (const html of [await page({}), await page({ preview: true, flagOverrides: { 'spice-cues': false } })]) {
            expect(html).toContain('spice-level-ranked-upset'); // the border itself is public
            expect(html).not.toContain('aria-label="Ranked upset"');
            expect(html).not.toContain('>Ranked upset</span>');
            expect(legend(html)).toEqual([
                'Gray - normal',
                'Green - Close game late',
                'Yellow - Ranked Upset',
                'Orange - Ranked Opponents + close game late',
                'Red - FCS Upset',
            ]);
        }
    });
});
