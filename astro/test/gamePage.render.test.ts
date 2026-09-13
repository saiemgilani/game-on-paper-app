import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';

// Why this exists: a TDZ ReferenceError in GamePage's frontmatter shipped in
// #181 and every finished-game page rendered as a 200 with an empty body.
// vitest + `astro build` both passed -- nothing rendered a game page before
// merge. This renders a REAL ProcessedGame (captured from the Flask app's
// /cfb/<id>/process against the ESPN summary in cfbfastR-cfb-raw) through the
// component tree, so a frontmatter throw fails here instead of in production.

// The API payload is fed through retrieveProcessedGame exactly as the route
// does it (scoringPlays are rebuilt from processed plays there; the raw list
// has no `start` and would throw in PlayRow), by answering the Python fetch
// with the fixture.
const GAME_ID = 401729745;
const apiPayload = gunzipSync(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString();
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        if (!String(url).includes(`/cfb/${GAME_ID}/process`)) throw new Error(`unexpected fetch in test: ${url}`);
        (globalThis as any).__lastProcessUrl = String(url);
        return new Response(apiPayload, { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => [],
    retrieveTeamSummaries: async () => [],
    retrieveTeamSeasonInformation: async () => null,
    retrieveMatchupHistory: async () => [],
}));

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

describe('GamePage renders a finished game end to end', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30);
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        html = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game },
            request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        });
        // DUMP_HTML=/path/file.html npx vitest run test/gamePage.render.test.ts -- for eyeballing the render
        if (process.env.DUMP_HTML) writeFileSync(process.env.DUMP_HTML, html);
    }, 60_000);

    test('the whole document arrives, not an empty stream', () => {
        expect(html.length).toBeGreaterThan(100_000);
        expect(html).toContain('</html>');
    });

    test('head says what the page is', () => {
        expect(html).toMatch(/<title>[^<]*EPA &(amp;)? advanced box score \| Game on Paper<\/title>/);
        expect(html).toMatch(/<meta name="description" content="[^"]*EPA per play/);
        expect(html).toContain(`<link rel="canonical" href="https://gameonpaper.com/game/${GAME_ID}">`);
    });

    test('stat lines carry the longest gain and the best single play', () => {
        // Extremes come off the plays, so they work on any game, old text or new.
        expect(html).toMatch(/\d+ LNG, -?\d+\.\d+ best EPA, -?\d+\.\d+% best WPA/);
        // a passer's longest is his longest COMPLETION: Cam Miller went 20/29 for
        // 274 with a long of 36, McIvor 20/32 for 153 with a long of 18
        expect(html).toMatch(/Cam Miller[\s\S]{0,400}?36 LNG/);
        expect(html).toMatch(/Maverick McIvor[\s\S]{0,400}?18 LNG/);
    });

    test('a final game has no Latest strip -- the page IS the recap', () => {
        // the fixture game is completed; the strip (and its nav entry) only
        // renders while the game is live
        expect(html).not.toContain('id="latest"');
        expect(html).not.toContain('href="#latest"');
    });

    test('the chart canvas ids are unique -- Chart.js finds the canvas, not a wrapper', () => {
        // a wrapper div carrying id="wpChart" shadowed the canvas and both
        // charts silently never drew (the Svelte components getElementById
        // their own canvases)
        // client:only means the canvases are NOT in the SSR output at all --
        // they arrive at hydration. So the exact SSR invariant is zero
        // claimants on those ids: any server-rendered element carrying them
        // would shadow the canvas when it mounts.
        expect((html.match(/id="wpChart"/g) ?? []).length).toBe(0);
        expect((html.match(/id="epChart"/g) ?? []).length).toBe(0);
        expect(html).toContain('id="wp-section"');
        expect(html).toContain('id="ep-section"');
        // and the islands that will mount them are present
        expect(html).toMatch(/astro-island[^>]+WinProbabilityChart/);
        expect(html).toMatch(/astro-island[^>]+ExpectedPointsChart/);
    });

    test('situational metrics render client-side', () => {
        expect((html.match(/id="team-stats"/g) ?? []).length).toBe(1);
        expect((html.match(/id="span-stats"/g) ?? []).length).toBe(0);
        expect(html).not.toContain(/astro-island[^>]+SituationalSection/);
    });

    // test('penalties split by unit, and the totals are accepted flags only', () => {
    //     expect(html).toContain('>Penalties<');
    //     for (const u of ['Offense', 'Defense', 'Special teams', 'Total', 'First downs given up', 'Plays nullified']) {
    //         expect(html).toContain(`>${u}<`);
    //     }
    //     // this game has 11 flags, none on a kick
    //     const pen = html.slice(html.indexOf('>Penalties<'));
    //     const st = pen.slice(pen.indexOf('>Special teams<'), pen.indexOf('>Total<'));
    //     expect(st).toMatch(/0&ndash;0/);
    //     const totals = [...pen.slice(pen.indexOf('>Total<')).matchAll(/<strong>(\d+)&ndash;(\d+)<\/strong>/g)];
    //     expect(totals).toHaveLength(2);
    //     expect(Number(totals[0][1]) + Number(totals[1][1])).toBe(11);
    // });

    // test('the book rows render with their EPA beside them', () => {
    //     for (const label of ['Third down', 'Fourth down', 'Red zone scoring', 'Turnovers', 'Sacks taken', 'Time of possession']) {
    //         expect(html).toContain(`>${label}<`);
    //     }
    //     expect(html).toMatch(/\d+-\d+ \(\d+%\)/);
    //     // the clock lives in the possession row itself, not just anywhere on the page
    //     expect(html).toMatch(/Time of possession<\/td>[\s\S]{0,600}?\d+:\d\d/);
    // });

    test('a game whose text names no tacklers shows no defensive box', () => {
        // 401729745 predates ESPN's LiveStats tackler parentheticals; the section
        // has to disappear rather than render an empty table. Scoped to the player
        // box: the penalty table legitimately has a row labelled "Defense".
        const box = html.slice(html.indexOf('id="player-stats"'), html.indexOf('id="big-plays"'));
        expect(box).not.toContain('>Defense<');
    });

    test('the linescore prints each quarter and adds up to the final score', () => {
        const table = html.slice(html.indexOf('Linescore</th>'));
        const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
        const rows = body.split('<tr>').filter((r) => r.includes('numeral'));
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            const nums = [...row.matchAll(/class="numeral"[^>]*>\s*(?:<strong>)?\s*(\d+)/g)].map((m) => Number(m[1]));
            const total = nums.pop()!;
            expect(nums).toHaveLength(4);
            expect(nums.reduce((a, b) => a + b, 0)).toBe(total);
        }
        // away team leads the table, the way a scoreboard is read
        expect(rows[0]).toContain('ACU');
        expect(rows[1]).toContain('NDSU');
    });

    test('All Plays offers a quarter filter, and the markup its script needs is there', () => {
        // The filter script finds rows by these hooks. If PlayRow or PlaysTable
        // stops emitting them the buttons silently do nothing, so pin the contract.
        expect(html).toContain('data-plays-body="all"');
        expect(html).toContain('data-play-filters="all"');
        expect(html).toMatch(/data-period-filter="all"/);
        for (const q of [1, 2, 3, 4]) expect(html).toContain(`data-period-filter="${q}"`);
        // no overtime in this game, so no overtime button
        expect(html).not.toContain('data-period-filter="5"');
        expect(html).toContain('data-order-toggle');
    });

    test('inside All Plays every summary row is followed by exactly one detail row', () => {
        // Scoped to the All Plays tbody on purpose: the Latest strip is not
        // expandable, so its rows are unpaired and a whole-page count would be odd.
        const body = html.slice(html.indexOf('data-plays-body="all"'));
        const rows = [...body.slice(0, body.indexOf('</tbody>')).matchAll(/<tr ([^>]*data-play-row[^>]*)>/g)].map((m) => m[1]);
        expect(rows.length).toBeGreaterThan(100);
        expect(rows.every((r) => /data-period="\d+"/.test(r))).toBe(true);

        const isDetail = rows.map((r) => r.includes('accordion-body'));
        expect(isDetail.length % 2).toBe(0);
        for (let i = 0; i < isDetail.length; i += 2) {
            expect(isDetail[i]).toBe(false);
            expect(isDetail[i + 1]).toBe(true);
        }
    });

    test('the filter script is deferred, not run where it sits', () => {
        // It renders BEFORE the table it drives, so an inline script would look
        // up a tbody that has not been parsed yet and wire up nothing at all.
        const inline = html.indexOf('data-plays-body="${target}"');
        expect(inline).toBe(-1);
        const bar = html.indexOf('data-play-filters="all"');
        const tbody = html.indexOf('data-plays-body="all"');
        expect(bar).toBeLessThan(tbody);
    });

    test('the drives table surfaces its calculated metrics, columns aligned', () => {
        const table = html.slice(html.indexOf('id="drives"'));
        const head = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
        const headers = (head.match(/<th[\s>]/g) ?? []).length;
        expect(headers).toBe(9);

        // A summary row must carry exactly one cell per header, and the expanded
        // row must span all of them, or the table shears sideways.
        const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
        const summaryRows = body.split('<tr').filter((r) => r.includes('accordion-toggle'));
        expect(summaryRows.length).toBeGreaterThan(20);
        for (const row of summaryRows) expect((row.match(/<td[\s>]/g) ?? []).length).toBe(headers);
        expect(body).toContain(`colspan="${headers}"`);

        // success rate, EPA per play and the best play. Plays/yards/clock are not
        // repeated here: drive.description already reads "12 plays, 72 yards, 6:08".
        expect(body).toMatch(/-?\d+\.\d\d\/play/);
        expect(body).toMatch(/\d+ plays, -?\d+ yards/);
    });

    test('the play focus selector ships the index its script needs', () => {
        expect(html).toContain('data-play-focus="all"');
        // the index is embedded, keyed by the same play number the row href carries
        const m = html.match(/data-index="([^"]*)"/);
        expect(m).toBeTruthy();
        const index = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        const keys = Object.keys(index);
        expect(keys.length).toBeGreaterThan(100);
        // every selector the menu offers must actually match at least one play
        const offered = [...html.matchAll(/<option value="((?:r|t):[^"]+)"/g)].map((x) => x[1]);
        expect(offered.length).toBeGreaterThan(20);
        const all = new Set(Object.values(index).flat() as string[]);
        for (const o of offered) expect(all.has(o), `menu offers ${o} but no play carries it`).toBe(true);
        // and every indexed key resolves to a row in the All Plays table
        const body = html.slice(html.indexOf('data-plays-body="all"'));
        for (const k of keys.slice(0, 25)) expect(body).toContain(`#play-all-${k}"`);
    });

    test('every nav link points at an anchor that exists', () => {
        // #wpChart, #epChart and #most-imp-plays were all dead: the nav offered
        // them and nothing on the page carried the id.
        const hrefs = [...html.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
        expect(hrefs.length).toBeGreaterThan(5);
        for (const anchor of new Set(hrefs)) {
            expect(html, `nav points at #${anchor} but no element has that id`).toContain(`id="${anchor}"`);
        }
    });

    test('play marks: test explosive sprite', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30);
        expect((html.match(/<symbol id="pi-td"/g) ?? []).length).toBe(1);
        expect(html).not.toContain('#pi-kickoff');
        // per row: the "All plays" table renders every play once, keyed by game_play_number
        const rowFor = (n: number) => html.split('<tr').find((r) => r.includes(`href="#play-all-${n}"`)) ?? '';
        // returns take the bolt on return-team EPA: the 53-yard kickoff return
        // clears it, and so does the 100-yard return touchdown, which carries no
        // yds_kickoff_return value at all and so never fired under the old rule
        const bigRet = game.plays.find((p: any) => Number(p.yds_kickoff_return) >= 40);
        expect(bigRet, 'fixture has a kickoff return of 40+ yards').toBeTruthy();
        expect(rowFor(bigRet.game_play_number)).toContain('<use href="#pi-explosive">');
        const koTd = game.plays.find((p: any) => p.kickoff_play === true && p.touchdown === true);
        expect(koTd, 'fixture has a kickoff return touchdown').toBeTruthy();
        expect(rowFor(koTd.game_play_number), 'kickoff return td').toContain('<use href="#pi-explosive">');
    });


    test('exactly two h1s and a SportsEvent that parses', () => {
        expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(2);
        const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
        const ev = ld.find((o) => o['@type'] === 'SportsEvent');
        expect(ev?.url).toBe(`https://gameonpaper.com/game/${GAME_ID}`);
        expect(ev?.homeTeam?.name).toBeTruthy();
    });
});

describe('PlayerBoxScore builds a defensive box from 2025 play text', () => {
    test('the tacklers ESPN names become rows', async () => {
        const play = (text: string, extra = {}) => ({ text, pos_team: 2, def_pos_team: 1, ...extra });
        const { default: PlayerBoxScore } = await import('../src/components/game/metrics/PlayerBoxScore.astro');
        const html = await container.renderToString(PlayerBoxScore, {
            props: {
                pass: [],
                rush: [{ rusher_player_name: 'J.Payne', Car: 2, Yds: 9, Rush_TD: 0, Fum: 0, Fum_Lost: 0, YPC: 4.5, EPA: 0.3, EPA_per_Play: 0.15, SR: 0.5, WPA: 0.004 }],
                receiver: [],
                teamId: 1,
                plays: [
                    play('#26 J.Payne rush middle for 11 yards gain to the FSU42 (#16 G.Peterson; #8 B.Vislisel)', { rusher_player_name: 'J.Payne', yds_rushed: 11, EPA: 0.8, wpa: 0.012 }),
                    play('#26 J.Payne rush left for 2 yards loss to the FSU40 (#16 G.Peterson)', { rusher_player_name: 'J.Payne', yds_rushed: -2, EPA: -0.5, wpa: -0.008 }),
                    play('#3 T.Hedden pass incomplete short right broken up by #13 D.Diggs'),
                ],
            },
        });
        expect(html).toContain('>Defense<');
        expect(html).toContain('G.Peterson');
        expect(html).toContain('2 tackles (1 solo, 1 ast), 1 TFL');
        expect(html).toContain('1 PBU');
        // the rusher's stat line picks up his longest carry and his best play
        expect(html).toContain('11 LNG, 0.80 best EPA, 1.2% best WPA');
    });
});

describe('DrivesTable survives a drive with no processed plays', () => {
    test('a live drives.current renders the rest of the table instead of throwing', async () => {
        // firstPlay was dereferenced unguarded and the EPA reduce had no seed, so
        // an open drive with no plays yet took the whole page down -- and the
        // `drivePlays.length == 0` guard below it could never be reached.
        const { gunzipSync: gz } = await import('node:zlib');
        const g = JSON.parse(gz(readFileSync(new URL('./fixtures/game-401729745.json.gz', import.meta.url))).toString());
        const drives = [...g.drives.previous, { ...g.drives.previous[0], id: 'not-yet-played', plays: [] }];
        const { default: DrivesTable } = await import('../src/components/game/drives/DrivesTable.astro');
        const html = await container.renderToString(DrivesTable, {
            props: {
                drives,
                gamePlays: g.plays,
                prefix: 'drives',
                expandable: true,
                showGuide: false,
                homeTeam: g.teamInfo.home,
                awayTeam: g.teamInfo.away,
                isNeutralSite: false,
            },
        });
        expect(html).toContain('<tbody>');
        expect(html).not.toContain('not-yet-played');
        // the real drives all still render
        expect((html.match(/accordion-toggle/g) ?? []).length).toBe(g.drives.previous.length);
    });
});

describe('the classic snapshot serves the public while v2 is in preview', () => {
    let html = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30);
        const GamePageClassic = (await import('../src/components/game/classic/GamePage.astro')).default;
        html = await container.renderToString(GamePageClassic, { props: { id: String(GAME_ID), game } });
    }, 30000);

    test('renders the pre-v2 page: plays table present, v2 surfaces absent', () => {
        expect(html.length).toBeGreaterThan(50_000);
        expect(html).toContain('<html');
        // v2-only surfaces must not leak into the public variant
        expect(html).not.toContain('data-play-filters');
        expect(html).not.toContain('<symbol id="pi-td"');
        expect(html).not.toContain('pi-pill');
    });

    test('the flag gates it: preview renders v2, public renders classic', async () => {
        const { isFeatureEnabled, FLAGS } = await import('../src/utils/features');
        expect(FLAGS['game-page-v2']).toBe('preview');
        expect(isFeatureEnabled('game-page-v2', { preview: true })).toBe(true);
        expect(isFeatureEnabled('game-page-v2', {})).toBe(false);
    });
});

describe('box-score names jump into the play filter', () => {
    test('name cells carry the jump wiring and the select options carry the match keys', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30);
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        const page = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game },
            request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        });
        expect(page).toMatch(/<button type="button" class="focus-jump" data-focus-jump data-name="[^"]+" data-team="[^"]+" data-role="pass"/);
        expect(page).toMatch(/data-role="rush"/);
        expect(page).toMatch(/data-role="recv"/);
        // the same (name, role) pair exists on a select option, so the click can match
        const btn = page.match(/data-focus-jump data-name="([^"]+)" data-team="[^"]+" data-role="pass"/);
        expect(btn).toBeTruthy();
        expect(page).toContain(`<option value="r:pass:`);
        expect(page).toMatch(new RegExp(`<option value="r:pass:[^"]+" data-name="${btn![1]}" data-role="pass" data-team="[^"]+">`));
    });
});