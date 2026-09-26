import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { rushingStatLine } from '../src/utils/players';

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

const sdvState = vi.hoisted(() => ({ percentiles: [] as any[] }));
vi.mock('../src/resources/sdv', async (orig) => ({
    ...(await orig<typeof import('../src/resources/sdv')>()),
    retrievePercentiles: async () => sdvState.percentiles,
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
        // 274 with a long of 36, McIvor 20/32 for 153 with a long of 18. The line
        // is the row under his name row (name + five numbers), not a column in it.
        const statLineUnder = (name: string) => html.match(new RegExp(
            `<td style="text-align: left;">${name}</td>(?:<td class="numeral"[^>]*>[^<]*</td>){5}</tr><tr class="stat-line-row">(.*?)</tr>`))?.[1];
        expect(statLineUnder('Cam Miller')).toMatch(/^<td colspan="6" class="text-muted">20\/29, 274 yds,[^<]*<span[\s\S]*, 36 LNG,/);
        expect(statLineUnder('Maverick McIvor')).toMatch(/^<td colspan="6" class="text-muted">20\/32, 153 yds,[^<]*<span[\s\S]*, 18 LNG,/);
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
        expect(html).toMatch(/astro-island[^>]+SituationalSection/);
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
        // and it is the SHARED formatter, the same one the player page's game
        // log prints, so one player reads identically on both surfaces
        expect(html).toContain(rushingStatLine({ carries: 2, yards: 9, tds: 0 }));
    });

    test('a name the usage sections carry an id for reaches the player page', async () => {
        // These rows have a name and no id of their own; the usage/tackle rows of
        // the SAME box do, which is the only bridge from the advanced box score
        // to a player page. Off without the flag, because a public link into the
        // gated namespace is a link to the site's 404.
        const { default: PlayerBoxScore } = await import('../src/components/game/metrics/PlayerBoxScore.astro');
        const props = {
            pass: [],
            rush: [{ rusher_player_name: 'J.Payne', Car: 2, Yds: 9, Rush_TD: 0, Fum: 0, Fum_Lost: 0, YPC: 4.5, EPA: 0.3, EPA_per_Play: 0.15, SR: 0.5, WPA: 0.004 }],
            receiver: [],
            teamId: 1,
            plays: [],
            season: 2024,
            box: {
                player_usage: [{ pos_team: 1, player_id: '4433971', player_name: 'J.Payne' }],
                tackles: [{ def_pos_team: 1, player_id: '4426338', player_name: 'G.Peterson' }],
            },
        } as any;
        const shown = await container.renderToString(PlayerBoxScore, { props, locals: { league: 'cfb', preview: true } as any });
        // ONE interaction per name (review on #267): the name itself is the link,
        // and focusing the plays on a player is the dropdown above the table
        expect(shown).toContain('<a href="/players/4433971?season=2024">J.Payne</a>');
        expect(shown).not.toContain('focus-jump');

        const publicHtml = await container.renderToString(PlayerBoxScore, { props, locals: { league: 'cfb' } as any });
        expect(publicHtml).not.toContain('/players/4433971');
        expect(publicHtml).toContain('J.Payne');

        // a name with no id anywhere in the box gets no link rather than a guess
        const noIds = await container.renderToString(PlayerBoxScore, {
            props: { ...props, box: {} }, locals: { league: 'cfb', preview: true } as any,
        });
        expect(noIds).not.toContain('/players/');
    });
});

describe('the player stat line is a row under the name, not a column', () => {
    // Decided 2026-09-25 with Akshay: as a column the stat line squeezed the
    // numbers off a phone and made the page unnavigable. Each player is now a
    // name row (the name and one number per numeric column) followed by one
    // `stat-line-row` cell spanning the whole table, in BOTH twins -- the public
    // renders classic/, and the evidence workflow only ever sees v2.
    /** Every body `<tr>` of a table: whether it is a stat line or a group heading, and its cells. */
    const trs = (html: string) => html.split('<tbody>')[1].split('</tbody>')[0].split('<tr').slice(1).map((tr) => ({
        statLine: tr.startsWith(' class="stat-line-row"'),
        group: tr.includes('gt_group_heading'),
        html: tr,
        cells: [...tr.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((m) => ({
            colspan: Number(m[1].match(/colspan="(\d+)"/)?.[1] ?? 1),
            text: m[2].replace(/<[^>]*>/g, '').trim(),
        })),
    }));
    const headers = (html: string) => (html.split('</thead>')[0].match(/<th[\s>]/g) ?? []).length;
    /** Every player is a name row of `n` single cells with its stat line, one cell spanning `n`, right under it. */
    const expectSecondRows = (html: string, n: number) => {
        expect(html).not.toContain('Stat line');
        expect(headers(html)).toBe(n);
        const rows = trs(html);
        expect(rows.filter((r) => r.statLine).length).toBeGreaterThan(0);
        rows.forEach((r, i) => {
            if (r.group || r.statLine) {
                // a heading or a stat line is one cell covering every column
                expect(r.cells.map((c) => c.colspan), r.html).toEqual([n]);
                if (r.statLine) expect(rows[i - 1].group || rows[i - 1].statLine, r.html).toBe(false);
                return;
            }
            expect(r.cells.map((c) => c.colspan), r.html).toEqual(Array(n).fill(1));
            expect(rows[i + 1]?.statLine, r.html).toBe(true);
        });
        return rows;
    };

    let classic = '';
    let v2 = '';
    beforeAll(async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30);
        const teamId = game.advBoxScore.pass[0].pos_team;
        const side = (rows: any[]) => rows.filter((r) => r.pos_team == teamId);
        // exactly the props each GamePage passes its own twin
        const props = { pass: side(game.advBoxScore.pass), rush: side(game.advBoxScore.rush), receiver: side(game.advBoxScore.receiver) };
        classic = await container.renderToString((await import('../src/components/game/classic/PlayerBoxScore.astro')).default, { props });
        v2 = await container.renderToString((await import('../src/components/game/metrics/PlayerBoxScore.astro')).default, {
            props: { ...props, plays: game.plays, teamId, box: game.advBoxScore, season: game.season?.year },
        });
    }, 60_000);

    test('classic: the name and five numbers, then the stat line spanning all six columns', () => {
        expectSecondRows(classic, 6);
    });

    test('v2: the same, and the air-yards and best-play tooltips move with the text', () => {
        const rows = expectSecondRows(v2, 6);
        const lines = rows.filter((r) => r.statLine).map((r) => r.html).join('');
        const names = rows.filter((r) => !r.statLine && !r.group).map((r) => r.html).join('');
        expect(lines).toContain('<span title="Air yards on completions');
        expect(lines).toContain('<span title="Longest carry');
        expect(names).not.toContain('<span title=');
    });

    test('twin parity: the same players, in the same order, with the same five numbers', () => {
        const nameRows = (html: string) => {
            const rows = trs(html);
            // v2 adds a Defense section the frozen classic never had; everything above it is shared
            const end = rows.findIndex((r) => r.group && r.cells[0].text === 'Defense');
            return rows.slice(0, end === -1 ? rows.length : end)
                .filter((r) => !r.group && !r.statLine).map((r) => r.cells.map((c) => c.text));
        };
        expect(nameRows(classic).length).toBeGreaterThan(5);
        expect(nameRows(v2)).toEqual(nameRows(classic));
        // and a passer's line reads the same in both; v2 only appends LNG and the best play
        const firstLine = (html: string) => trs(html).find((r) => r.statLine)!.cells[0].text;
        expect(firstLine(classic)).toMatch(/^20\/32, 153 yds, 1 TD, 2 INT, \d+ Sck, [\d.]+ xQBR/);
        expect(firstLine(v2).startsWith(firstLine(classic))).toBe(true);
    });

    test('the special-teams usage table: the name and EPA, then the line spanning both', async () => {
        const { default: Usage } = await import('../src/components/game/metrics/UsageBoxScore.astro');
        const html = await container.renderToString(Usage, {
            props: {
                teamId: 1,
                box: {
                    st_kickers: [{ pos_team: 1, player_id: '1', player_name: 'K. Kicker', fg_attempts: 2, fg_made: 1, fg_long: 44, xp_attempts: 3, xp_made: 3, kickoffs: 0, fg_epa: 0.4, kickoff_epa: 0 }],
                    st_punters: [{ pos_team: 1, player_id: '2', player_name: 'P. Punter', punts: 4, punt_avg: 44.5, punt_net_avg: 40.1, punt_long: 55, punt_inside_20: 2, punt_touchbacks: 0, punt_fair_catches: 1, punt_epa: -0.3 }],
                },
            } as any,
        });
        const table = html.slice(html.indexOf('Special teams'));
        const rows = expectSecondRows(table, 2);
        expect(rows.map((r) => r.cells.map((c) => c.text))).toEqual([
            ['K. Kicker K', '0.40'],
            [expect.stringMatching(/^FG 1\/2 \([^)]*\), 44 LNG\. XP 3\/3\.$/)],
            ['P. Punter P', '-0.30'],
            ['4 punts, 44.5 avg, 40.1 net, 55 LNG, 2 inside 20, 0 TB, 1 FC.'],
        ]);
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

describe('the play filter is the only way to focus the plays on a player', () => {
    test('the dropdown carries a role option per player, and no name is a second control', async () => {
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game: any = await retrieveProcessedGame(GAME_ID, 30);
        const { default: GamePage } = await import('../src/components/game/GamePage.astro');
        const page = await container.renderToString(GamePage, {
            props: { id: GAME_ID, game },
            request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
        });
        for (const role of ['pass', 'rush', 'recv']) {
            expect(page, role).toMatch(new RegExp(`<option value="r:${role}:[^"]+" data-name="[^"]+" data-role="${role}" data-team="[^"]+">`));
        }
        // the box-score jump button is gone, and with it the dead wiring that drove it
        expect(page).not.toContain('focus-jump');
        expect(page).not.toContain('data-focus-jump');
    });
});
describe('chart islands serialize only the fields their charts read', () => {
    // Every client:only prop is serialized into the HTML. Each drive chart
    // carried both full ESPN team objects (~8.8KB a drive, ~212KB a game) to
    // read one colour apiece, and the WP chart carried the whole percentile
    // table (~103KB) to rank one number, the excitement index.
    const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const islandProps = (html: string, component: string) => [...html.matchAll(/<astro-island ([^>]*)>/g)]
        .map((m) => m[1])
        .filter((attrs) => attrs.includes(component))
        .map((attrs) => JSON.parse(unescape(attrs.match(/ props="([^"]*)"/)![1])));
    const renders: Record<string, string> = {};
    beforeAll(async () => {
        sdvState.percentiles = Array.from({ length: 101 }, (_, i) => ({ season: 2025, pctile: i / 100, GEI: i / 20, EPAplay: i / 100 - 0.5 }));
        const { retrieveProcessedGame } = await import('../src/resources/python');
        const game = await retrieveProcessedGame(GAME_ID, 30);
        const { default: v2 } = await import('../src/components/game/GamePage.astro');
        const { default: classic } = await import('../src/components/game/classic/GamePage.astro');
        for (const [name, Page] of [['v2', v2], ['classic', classic]] as const) {
            renders[name] = await container.renderToString(Page, {
                props: { id: GAME_ID, game },
                request: new Request(`https://gameonpaper.com/game/${GAME_ID}`),
            });
        }
        sdvState.percentiles = [];
    }, 60_000);

    for (const twin of ['v2', 'classic']) {
        test(`${twin}: each drive chart gets a team colour, not the team`, () => {
            const drives = islandProps(renders[twin], 'DriveChart');
            expect(drives.length).toBeGreaterThan(10);
            for (const p of drives) {
                expect(Object.keys(p.offense[1])).toEqual(['color']);
                expect(Object.keys(p.defense[1])).toEqual(['color']);
                expect(p.offense[1].color[1]).toMatch(/^[0-9a-f]{6}$/i);
            }
        });

        test(`${twin}: the WP chart gets the excitement column, not the percentile table`, () => {
            const [wp] = islandProps(renders[twin], 'WinProbabilityChart');
            const rows = wp.percentiles[1].map((r: any) => r[1]);
            expect(rows).toHaveLength(101);
            expect(rows.every((r: any) => Object.keys(r).join() == 'GEI')).toBe(true);
        });
    }
});
