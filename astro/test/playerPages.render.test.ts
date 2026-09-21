import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { categoryColumns, formatPlayerMetric, gameStatLine, percentileOf, totalGameLog, weekLabel } from '../src/utils/players';
import { formatPercent, formatRank, generateColorRampValue, roundNumber } from '../src/utils/misc';

// The player pages rendered with the REAL bodies the Data API's player-keyed
// routes return (fixtures captured 2026-09-19; see fixtures/README.md). The SDV
// client is mocked -- the routes are merged but the live API has not been
// restarted onto them -- so what this pins is the RENDER contract: every cell
// holds the field its header names, the summary tiles are the game log summed,
// the percentile bar is as wide as the producer's `_pct`, and a 404 from the
// API is a 404 page rather than an identity shell.
const cfb = JSON.parse(readFileSync(new URL('./fixtures/player-cfb-4433971-2024.json', import.meta.url)).toString());
const nfl = JSON.parse(readFileSync(new URL('./fixtures/player-nfl-16800-2024.json', import.meta.url)).toString());

const feed: any = { cfb, nfl, missing: new Set<string>() };

vi.mock('../src/resources/sdv', async (orig) => {
    const real = await orig<typeof import('../src/resources/sdv')>();
    const pick = (league: string) => (league === 'nfl' ? feed.nfl : feed.cfb);
    return {
        ...real,
        retrievePlayer: async (id: string, league = 'cfb') =>
            (feed.missing.has(id) ? null : pick(league).identity),
        retrievePlayerSeasons: async (_id: string, league = 'cfb') => pick(league).seasons.data,
        // note the arity: games and splits take (id, season, league)
        retrievePlayerGames: async (_id: string, _season: number, league = 'cfb') => pick(league).games.data,
        retrievePlayerSplits: async (_id: string, _season: number, league = 'cfb') => pick(league).splits.data,
        // 2024_01_LV_LAC -> the ESPN event id GOP's game pages are keyed on
        retrieveNflEspnGameIds: async () => ({ '2024_01_LV_LAC': '401671592' }),
        retrieveTeamSummaries: async () => [
            { team_id: 183, pos_team: 'Syracuse', EPAplay_off: 0.21, success_off: 0.48, explosive_off: 0.12, EPAplay_def: 0.09, EPAplay_off_rank: 7, success_off_rank: 9, explosive_off_rank: 11, EPAplay_def_rank: 103 },
            { team_id: 13, pos_team: 'LV', EPAplay_off: -0.08, success_off: 0.41, explosive_off: 0.09, EPAplay_def: 0.02, EPAplay_off_rank: 27, success_off_rank: 29, explosive_off_rank: 25, EPAplay_def_rank: 18 },
            { team_id: 20, pos_team: 'NYJ', EPAplay_off: -0.02, success_off: 0.44, explosive_off: 0.10, EPAplay_def: -0.04, EPAplay_off_rank: 21, success_off_rank: 18, explosive_off_rank: 20, EPAplay_def_rank: 6 },
        ],
        resolveEspnAthleteId: async (gsis: string) => (gsis === '00-0031381' ? '16800' : null),
    };
});

let container: AstroContainer;
beforeAll(async () => {
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});

async function render(league: 'cfb' | 'nfl', id: string, query: string) {
    const path = league === 'nfl' ? `/nfl/players/${id}` : `/players/${id}`;
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/players/[id].astro' : '../src/pages/players/[id].astro');
    return container.renderToString(Page, {
        params: { id },
        request: new Request(`https://gameonpaper.com${path}${query}`),
        // the pages are behind the 'player-pages' flag, so the only viewer who
        // reaches one holds the preview cookie
        locals: { preview: true },
    });
}
const renderPage = (league: 'cfb' | 'nfl', id: string, season: number) => render(league, id, `?season=${season}`);
/** No `?season=`: the page's default, the player's whole career. */
const renderCareer = (league: 'cfb' | 'nfl', id: string) => render(league, id, '');

/** The `<tr>` blocks of one table, header row dropped. */
const bodyRows = (html: string, id: string): string[] => {
    const table = html.split(`id="${id}"`)[1];
    expect(table, id).toBeTruthy();
    return table.split('</table>')[0].split('<tr').slice(2);
};
/** The text of each `<td>` in a row, tags stripped. */
const cells = (row: string): string[] =>
    [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;|&emsp;/g, ' ').trim());

describe('CFB player page', () => {
    test('identity, season pills and SEO', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        expect(html).toContain('Kyle McCord');
        expect(html).toContain('<title>QB Kyle McCord 2024 advanced stats: EPA per play, success rate, and game log | Game on Paper</title>');
        expect(html).toContain('"@type":"Dataset"');
        expect(html).toContain('"temporalCoverage":"2024"');
        // canonical, og:url and the Dataset all name the season the page SHOWS:
        // `?season=` changes the content, so canonicalising every season onto
        // one URL would advertise a page that renders a different year
        expect(html).toContain('<link rel="canonical" href="https://gameonpaper.com/players/4433971?season=2024">');
        expect(html).toContain('"url":"https://gameonpaper.com/players/4433971?season=2024"');
        // the dropdown offers Career plus exactly the seasons the player has
        // rows for, newest first, and the shown one is `selected`
        const picker = html.split('id="player-season"')[1].split('</select>')[0];
        expect(picker).toContain('<option value="/players/4433971"');
        for (const y of [2024, 2023, 2022, 2021]) expect(picker, `${y}`).toContain(`<option value="/players/4433971?season=${y}"`);
        expect(picker).not.toContain('?season=2020');
        expect(picker).toContain('<option value="/players/4433971?season=2024" selected');
        expect(html).toContain('headshots/college-football/players/full/4433971.png');
        expect(html).toContain('teamlogos/ncaa/500/183.png');
        expect(html).not.toContain('teamlogos/nfl/');
    }, 60_000);

    test('the summary row is the game log summed, in the same table format as every other section', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const totals = totalGameLog(cfb.games.data);
        const table = html.split('id="player-summary-totals"')[1].split('</table>')[0];
        // a table, not a row of loose tiles, and with margin under it (review on #267)
        expect(html).toContain('class="table-responsive mb-4" id="player-summary-totals"');
        expect(cells(table.split(/<tbody[^>]*>/)[1])).toEqual([
            `${totals.games}`,
            `${totals.plays}`,
            roundNumber(totals.epa, 2, 2),
            roundNumber(totals.epa_per_play, 2, 2),
            `${roundNumber((totals.success_rate as number) * 100, 2, 1)}%`,
        ]);
        // and the all-plays split is the same population, so the same play count
        expect(totals.plays).toBe(cfb.splits.data.find((s: any) => s.split === 'all').plays);
    }, 60_000);

    test('season line table: the team cell is the abbreviation on a phone and the full name from md up', async () => {
        // Review on #267: a CFB team name pushed the metric columns off a phone.
        // Akshay's call was the abbreviation rather than nothing, so BOTH
        // spellings ship and Bootstrap picks (`routes/StandingsRoute.astro`'s
        // pattern); every other visible cell stays short.
        const html = await renderPage('cfb', '4433971', 2024);
        const head = html.split('id="player-season-passing"')[1].split('</thead>')[0];
        expect(head).toContain('<th class="text-left" colspan="1">Team</th>');
        for (const row of bodyRows(html, 'player-season-passing')) {
            const tds = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
            for (const m of tds) {
                // the phone reading of a cell: whatever `d-none d-md-inline` hides is not there
                const text = m[2].replace(/<span class="d-none d-md-inline">[\s\S]*?<\/span>/g, '')
                    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&emsp;/g, ' ').trim();
                expect(text.length, text).toBeLessThanOrEqual(12);
            }
        }
        // the abbreviation comes from the team index, not from truncating the name
        const first = bodyRows(html, 'player-season-passing')[0];
        expect(first).toContain('<span class="d-md-none">SYR</span>');
        expect(first).toContain('<span class="d-none d-md-inline">Syracuse</span>');
    }, 60_000);

    test('a category the producer published no ranks for says why, in the table caption', async () => {
        // Akshay on #267: Darian Mensah's 2026 rushing. The payload says "does
        // not qualify" by withholding every `_rank`; the table says it in words.
        const html = await renderPage('cfb', '4433971', 2024);
        const rushing = html.split('id="player-season-rushing"')[1].split('</table>')[0];
        expect(rushing).toContain('<caption class="text-small">Does not qualify for rushing ranks (min. 6.25 carries per team-game).</caption>');
        // ... and a category he IS ranked in carries no caption
        expect(html.split('id="player-season-passing"')[1].split('</table>')[0]).not.toContain('<caption');
    }, 60_000);

    test('season line table: every cell holds the field its header names, with EPA/DB per dropback', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const columns = categoryColumns('passing');
        const head = html.split('id="player-season-passing"')[1].split('</thead>')[0];
        expect(head).toContain('>EPA/DB<'); // never "EPA/Play" for a passer
        for (const [, label] of columns) expect(head, label).toContain(`>${label}<`);
        const rows = bodyRows(html, 'player-season-passing');
        const row = cells(rows[0]);
        const fx = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        expect(row[0]).toBe('2024');
        expect(row[1]).toContain('Syracuse');
        // the rank rides IN the metric cell (team/TeamCard.astro's pattern), so
        // there is no second row and the columns stay one number wide
        columns.forEach(([k], i) => {
            const rank = fx[`${k}_rank`];
            const want = formatPlayerMetric('passing', k, fx[k])
                + (rank === null || rank === undefined ? '' : ` #${formatRank(rank)}`);
            expect(row[i + 2], k).toBe(want);
        });
        expect(row[2 + columns.findIndex(([k]) => k === 'TEPA')]).toContain('#2');
        expect(rows.some((r) => cells(r)[0] === 'Rank')).toBe(false);
        // the career roll-up is the last row, over all four seasons
        expect(cells(rows[rows.length - 1])[0]).toBe('Career');
    }, 60_000);

    test('game log: every row carries its stat line, its EPA and a link to the game page', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-game-log');
        expect(rows.length).toBe(cfb.games.data.length);
        cfb.games.data.forEach((g: any, i: number) => {
            const c = cells(rows[i]);
            // the date is a LocalDate island (client:only), so what the server
            // ships is the UTC instant for the viewer's browser to localise --
            // a 7:30pm ET Saturday kickoff must not render as Sunday
            expect(rows[i], String(g.game_id)).toContain(String(g.game_date));
            expect(c[1]).toBe(weekLabel('cfb', g.season_type, g.week));
            expect(c[2]).toContain(g.opponent);
            expect(c[4]).toBe(gameStatLine(g.box, 'cfb'));
            expect(c[5]).toBe(String(g.plays));
            expect(c[6]).toBe(roundNumber(g.epa_per_play, 2, 2));
            expect(c[7]).toBe(roundNumber(g.epa, 2, 2));
            expect(c[8]).toBe(formatPercent(g.success_rate));
            expect(rows[i]).toContain(`href="/game/${g.game_id}"`);
            // every opponent links to its team page, logo and name in one flex row
            expect(rows[i], `opponent ${g.opponent_id}`).toContain(`href="/year/${g.season}/team/${g.opponent_id}"`);
        });
        // The page renders the API's rows in order and never re-sorts. This pins
        // that CONTRACT, not GOP code: sdv-db's player_routes sorts on the
        // kickoff date precisely so a postseason game whose schedule `week`
        // restarts at 1 still sorts last. A producer that stopped sorting would
        // break here, which is the point -- nothing in this repo can.
        const dates = cfb.games.data.map((g: any) => String(g.game_date));
        expect([...dates].sort()).toEqual(dates);
        // and that last row is a bowl game, so its week cell is NAMED, not "1"
        const last = cfb.games.data[cfb.games.data.length - 1];
        expect(last.week).toBe(1);
        expect(last.season_type).toBe('postseason');
        expect(cells(rows[rows.length - 1])[1]).toBe('Postseason');
    }, 60_000);

    test('game log: W/L is green/purple, and the metric cells are shaded by rank within the season', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-game-log');
        cfb.games.data.forEach((g: any, i: number) => {
            if (g.result === 'W') expect(rows[i], String(g.game_id)).toContain('<span class="hulk-text-green">W</span>');
            if (g.result === 'L') expect(rows[i], String(g.game_id)).toContain('<span class="hulk-text-purple">L</span>');
            expect(rows[i], String(g.game_id)).not.toContain('text-danger');
        });
        // the best EPA game is green, the worst purple, on the same ramp the
        // season table uses -- ranked among THIS player's games, the only
        // distribution the page reads
        const byEpa = [...cfb.games.data].toSorted((a: any, b: any) => b.epa - a.epa);
        const rowOf = (g: any) => rows[cfb.games.data.indexOf(g)];
        expect(rowOf(byEpa[0])).toContain('hulk-bg-level-9');
        expect(rowOf(byEpa[byEpa.length - 1])).toContain('hulk-bg-level-0');
    }, 60_000);

    test('a row with no schedule row renders an em dash, never "Invalid DateTime"', async () => {
        // Akshay on #267: the NFL log showed `Invalid DateTime` for 2025, because
        // the API adds a game the player has attributed plays in even when
        // nothing joined a schedule row to it -- luxon renders an absent date as
        // that literal. An absent date is an em dash, like every other cell.
        const sdv = await import('../src/resources/sdv');
        const bare = cfb.games.data.map((g: any) => ({ game_id: g.game_id, season: g.season, plays: g.plays, epa: g.epa }));
        const spy = vi.spyOn(sdv, 'retrievePlayerGames').mockResolvedValue(bare);
        try {
            const html = await renderPage('cfb', '4433971', 2024);
            const rows = bodyRows(html, 'player-game-log');
            expect(rows.length).toBe(bare.length);
            for (const row of rows) {
                expect(cells(row)[0]).toBe('—');
                expect(row).not.toContain('LocalDate');
            }
        } finally {
            spy.mockRestore();
        }
    }, 60_000);

    test('only opponents on a meme list are lowercased, never the whole log', async () => {
        // Akshay on #267: viewing a player whose OWN team is on the list
        // lowercased every opponent, because `cleanField` reads the id off the
        // row and a game-log row carries HIS team's id. The opponent's own id
        // decides now (`cleanTextForTeam`).
        const sdv = await import('../src/resources/sdv');
        const games = cfb.games.data.map((g: any, i: number) => ({
            ...g, team_id: 61, opponent_id: i === 0 ? 61 : g.opponent_id, opponent: i === 0 ? 'Georgia' : g.opponent,
        }));
        const spy = vi.spyOn(sdv, 'retrievePlayerGames').mockResolvedValue(games);
        try {
            const rows = bodyRows(await renderPage('cfb', '4433971', 2024), 'player-game-log');
            expect(cells(rows[0])[2]).toContain('georgia');
            games.slice(1).forEach((g: any, i: number) => {
                expect(cells(rows[i + 1])[2], g.opponent).toContain(g.opponent);
            });
        } finally {
            spy.mockRestore();
        }
    }, 60_000);

    test('a player whose team is on a meme list has his own name lowercased too', async () => {
        const sdv = await import('../src/resources/sdv');
        const seasons = cfb.seasons.data.map((r: any) => (r.season === 2024 ? { ...r, team_id: 61, pos_team: 'Georgia' } : r));
        const spy = vi.spyOn(sdv, 'retrievePlayerSeasons').mockResolvedValue(seasons);
        try {
            const html = await renderPage('cfb', '4433971', 2024);
            expect(html).toContain('<h2 class="mb-0" data-astro-cid-kzafhnxi>kyle mccord</h2>');
            // ... but the <title> and the schema.org name keep the real spelling
            expect(html).toContain('<title>QB Kyle McCord 2024 advanced stats');
        } finally {
            spy.mockRestore();
        }
    }, 60_000);

    test('splits: the table is the API\'s rows, and overtime with no plays is left out', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-splits-table');
        const played = cfb.splits.data.filter((s: any) => s.plays > 0);
        expect(rows.length).toBe(played.length);
        played.forEach((s: any, i: number) => {
            const c = cells(rows[i]);
            expect(c[1], s.split).toBe(String(s.plays));
            expect(c[2], s.split).toBe(roundNumber(s.epa_per_play, 2, 2));
            expect(c[3], s.split).toBe(roundNumber(s.epa, 2, 2));
            // success rate only: the raw count of successful plays earns no cell
            expect(c[4], s.split).toBe(formatPercent(s.success_rate));
            expect(c.length, s.split).toBe(5);
        });
        expect(html).not.toContain('>Successes<');
        expect(html).toContain('>SR%<');
        // only the two down-type splits offer a definition, and as an <abbr>
        expect(html).toContain('<abbr title="2nd and 8 or more, 3rd or 4th and 5 or more">Passing downs</abbr>');
        expect(html).not.toContain('Every play from scrimmage');
        expect(html).not.toContain('>Overtime<');
        expect(html).toContain('Standard downs');
        expect(html).toContain('Passing downs');
        expect(html).toContain('Red zone');
    }, 60_000);

    test('percentiles shade the season table\'s own cells, on the green to purple ramp', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const block = html.split('id="player-season-passing"')[1].split('</table>')[0];
        const fx = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        const shaded = categoryColumns('passing').filter(([k]) => percentileOf(fx, k) !== null);
        expect(shaded.length).toBeGreaterThan(0);
        for (const [k] of shaded) {
            const cls = generateColorRampValue(percentileOf(fx, k), 100);
            if (cls) expect(block, k).toContain(cls);
        }
        // the site's ramp, never green/red: EPA/DB at the 94.7th percentile is level 9
        expect(block).toContain('hulk-bg-level-9');
        expect(html).not.toContain('bg-danger');
        // and there is no separate percentile section any more -- the numbers
        // live where every other table on the site puts them
        expect(html).not.toContain('player-percentiles');
        expect(html).not.toContain('progress-bar');
    }, 60_000);

    test('team context reuses the team_summaries row the team leaderboards read', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-team-context-table');
        // the rank rides with the metric, so one row per team and no Rank row
        expect(rows.length).toBe(1);
        expect(cells(rows[0])[0]).toContain('Syracuse');
        expect(cells(rows[0])[1]).toBe('0.21 #7');
        expect(cells(rows[0])[2]).toBe('48.0% #9');
        expect(html).toContain('href="/year/2024/team/183"');
        expect(html).toContain('alt="Syracuse logo"');
        // shaded by the rank as well as labelled by it, the way TeamCard does
        // it -- #7 of 134 is green, #103 purple-ish
        expect(rows[0]).toContain('hulk-bg-level-9');
        expect(rows[0]).toContain('hulk-bg-level-2');
        // and the panel is open on arrival (review on #267)
        expect(html).toContain('<div id="player-team-context" class="collapse show">');
    }, 60_000);

    test('a team_summaries column the producer did not publish reads as absent, not zero', async () => {
        const sdv = await import('../src/resources/sdv');
        const spy = vi.spyOn(sdv, 'retrieveTeamSummaries').mockResolvedValue(
            [{ team_id: 183, pos_team: 'Syracuse' }] as any);
        try {
            const html = await renderPage('cfb', '4433971', 2024);
            const row = cells(bodyRows(html, 'player-team-context-table')[0]);
            // absent value AND absent rank: no number, no "#N/A"
            expect(row.slice(1)).toEqual(['—', '—', '—', '—']);
            expect(row).not.toContain('0.0%');
            expect(row).not.toContain('0.00');
        } finally {
            spy.mockRestore();
        }
    }, 60_000);
});

describe('NFL player page', () => {
    test('a traded player gets one season row per team, and the NFL surfaces throughout', async () => {
        const html = await renderPage('nfl', '16800', 2024);
        expect(html).toContain('Davante Adams');
        expect(html).toContain('<title>WR Davante Adams 2024 advanced stats');
        expect(html).toContain('gameonpaper.com/nfl/players/16800');
        const rows = bodyRows(html, 'player-season-receiving');
        // LV and NYJ in 2024, then the career roll-up over every season
        expect(cells(rows[0])[1]).toContain('NYJ'); // sorted by plays, 114 > 27
        expect(cells(rows[1])[1]).toContain('LV');
        expect(cells(rows[rows.length - 1])[0]).toBe('Career');
        expect(html).toContain('teamlogos/nfl/500/20.png');
        expect(html).not.toContain('teamlogos/ncaa/');
        expect(html).toContain('href="/nfl/year/2024/team/20"');
        expect(html).not.toMatch(/href="\/year\/2024\/team\//);
        expect(html).toContain('Rosters from nflverse');
    }, 60_000);

    test('game log rows link through the nflverse-to-ESPN crosswalk, or not at all', async () => {
        const html = await renderPage('nfl', '16800', 2024);
        const rows = bodyRows(html, 'player-game-log');
        expect(rows.length).toBe(nfl.games.data.length);
        // the one game the mocked crosswalk knows becomes a link to the ESPN id
        expect(html).toContain('href="/nfl/game/401671592"');
        // and no row ever links to a raw nflverse id
        expect(html).not.toContain('/game/2024_');
        nfl.games.data.forEach((g: any, i: number) => {
            const c = cells(rows[i]);
            expect(c[4], String(g.game_id)).toBe(gameStatLine(g.box, 'nfl'));
            expect(c[5]).toBe(String(g.plays));
            expect(c[7]).toBe(roundNumber(g.epa, 2, 2));
            // the nflverse rows name an opponent by ABBREVIATION; every team URL
            // and every dark-mode logo rule is keyed on the ESPN id, so it is
            // resolved before it reaches either
            expect(rows[i], String(g.opponent_id)).not.toContain(`/team/${g.opponent_id}"`);
            expect(rows[i], String(g.opponent_id)).toMatch(/href="\/nfl\/year\/2024\/team\/\d+"/);
        });
    }, 60_000);

    test('percentiles shade the NFL cells too, and a stint below the gate gets none', async () => {
        const html = await renderPage('nfl', '16800', 2024);
        const nyj = nfl.seasons.data.find((r: any) => r.category === 'receiving' && r.season === 2024 && r.pos_team === 'NYJ');
        const lv = nfl.seasons.data.find((r: any) => r.category === 'receiving' && r.season === 2024 && r.pos_team === 'LV');
        expect(percentileOf(nyj, 'EPAplay')).not.toBeNull();
        expect(percentileOf(lv, 'EPAplay')).toBeNull();
        const rows = bodyRows(html, 'player-season-receiving');
        // the qualified row is shaded and carries its rank; the 27-play stint
        // under the gate is neither shaded nor ranked, rather than shaded at 0
        const epaCol = 2 + categoryColumns('receiving').findIndex(([k]) => k === 'EPAplay');
        expect(rows[0]).toContain(generateColorRampValue(percentileOf(nyj, 'EPAplay'), 100) as string);
        expect(cells(rows[0])[epaCol]).toContain('#');
        expect(cells(rows[1])[epaCol]).not.toContain('#');
        expect(html).toContain('hulk-bg-level-');
        // the retired bar component drew every neutral percentile on Bootstrap's
        // blue; an unshaded table cell is the site's own answer to that band
        expect(html).not.toContain('progress-bar');
    }, 60_000);
});

/** An Astro stub that records what the route asked Workers Caching to do. */
const fake = (path: string, params: Record<string, string>) => {
    const cache: any[] = [];
    const headers = new Headers();
    return {
        astro: { params, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any,
            cache: { set: (v: any) => cache.push(v) }, response: { headers } } as any,
        cache, headers,
    };
};

describe('the page tells Workers Caching what to do', () => {
    // Every other data-backed route owns its policy (game.ts, matchup.ts,
    // charts.ts); a header-less 200 sits in Workers Caching on a ~2h heuristic
    // with no way to purge it, so a 404 from one bad upstream minute would
    // freeze a real player's page. Only matters once the flag is 'on' -- which
    // is exactly why it has to be right before it flips.
    test('a rendered page is cacheable per (league, id, season) and purgeable', async () => {
        const { preparePlayer } = await import('../src/routes/player');
        const f = fake('/players/4433971?season=2023', { id: '4433971' });
        await preparePlayer(f.astro, 'cfb');
        expect(f.cache).toEqual([{ maxAge: 60 * 60, swr: 60 * 60 * 6, tags: ['player'] }]);
        expect(f.headers.get('Cache-Control')).toBeNull();
        // the key is the URL: league and id in the path, season in the query
        expect(f.astro.url.pathname).toBe('/players/4433971');
        expect(f.astro.url.searchParams.get('season')).toBe('2023');
    }, 60_000);

    test('the tag is one /admin/api/purge-game accepts', async () => {
        const src = readFileSync(new URL('../src/pages/admin/api/purge-game.ts', import.meta.url)).toString();
        const known = src.slice(src.indexOf('const KNOWN_TAGS'), src.indexOf('export const GET'));
        expect(known).toContain("'player'");
    });

    test('every branch that does not render a page is explicitly uncacheable', async () => {
        const { preparePlayer } = await import('../src/routes/player');
        feed.missing.add('99999999999');
        const cases: [string, Record<string, string>, 'cfb' | 'nfl'][] = [
            ['/players/99999999999', { id: '99999999999' }, 'cfb'],   // the API 404s the id
            ['/players/kyle', { id: 'kyle' }, 'cfb'],                  // malformed id
            ['/players/4433971?season=1999', { id: '4433971' }, 'cfb'],// season he never played
            ['/nfl/players/00-0031381', { id: '00-0031381' }, 'nfl'],  // the gsis redirect
            ['/nfl/players/00-0000001', { id: '00-0000001' }, 'nfl'],  // crosswalk miss
        ];
        for (const [path, params, league] of cases) {
            const f = fake(path, params);
            await preparePlayer(f.astro, league);
            expect(f.cache, path).toEqual([false]);
            // set(false) alone emits NO header, which Workers Caching reads as
            // "cache me for two hours" -- the opt-out has to say so
            expect(f.headers.get('Cache-Control'), path).toBe('no-store');
        }
        feed.missing.delete('99999999999');
    }, 60_000);
});

describe('one failing section does not blank the page', () => {
    // The page fans out to four Data API routes plus the team-summaries read.
    // `Promise.all` would have let ONE of them reject the lot, and the reader
    // would have got a 500 for a page whose other three sections were fine.
    const SECTIONS = ['retrievePlayerSeasons', 'retrievePlayerGames', 'retrievePlayerSplits', 'retrieveTeamSummaries'] as const;

    test('every secondary read can fail on its own with the rest still rendered', async () => {
        const sdv = await import('../src/resources/sdv');
        for (const fn of SECTIONS) {
            const spy = vi.spyOn(sdv, fn).mockRejectedValue(new Error(`${fn} is down`));
            try {
                const html = await renderPage('cfb', '4433971', 2024);
                // the page is still a page: identity, canonical, breadcrumbs, and
                // every other panel's data
                expect(html, fn).toContain('Kyle McCord');
                expect(html, fn).toContain('<link rel="canonical" href="https://gameonpaper.com/players/4433971?season=2024">');
                if (fn !== 'retrievePlayerGames') {
                    expect(html, fn).toContain('id="player-game-log"');
                    expect(html, fn).toContain(gameStatLine(cfb.games.data[0].box, 'cfb'));
                }
                if (fn !== 'retrievePlayerSplits') expect(html, fn).toContain('id="player-splits-table"');
                if (fn !== 'retrievePlayerSeasons') expect(html, fn).toContain('id="player-season-passing"');
            } finally {
                spy.mockRestore();
            }
        }
    }, 120_000);

    test('the failed section says so, rather than claiming there is no data', async () => {
        const sdv = await import('../src/resources/sdv');
        const spy = vi.spyOn(sdv, 'retrievePlayerGames').mockRejectedValue(new Error('games route is down'));
        try {
            const html = await renderPage('cfb', '4433971', 2024);
            expect(html).toContain('id="player-game-log-unavailable"');
            // "No games for 2024" would be a lie about a player who played 13
            expect(html).not.toContain('No games for 2024');
        } finally {
            spy.mockRestore();
        }
    }, 60_000);

    test('an identity read that FAILED is a 503, never a 404', async () => {
        // CodeRabbit on #267: a timeout or a 500 answered as "no such player"
        // tells a crawler the page does not exist and hides the outage from
        // anything watching status codes. Only a genuine miss is a 404.
        const sdv = await import('../src/resources/sdv');
        const { preparePlayer, PLAYER_UNAVAILABLE } = await import('../src/routes/player');
        const spy = vi.spyOn(sdv, 'retrievePlayer').mockRejectedValue(new Error('identity route is down'));
        try {
            const f = fake('/players/4433971', { id: '4433971' });
            expect(await preparePlayer(f.astro, 'cfb')).toEqual({ unavailable: true });
            expect(f.cache).toEqual([false]);
            expect(f.headers.get('Cache-Control')).toBe('no-store');
        } finally {
            spy.mockRestore();
        }
        // the crosswalk read answers the same way, and a gsis id nobody has still 404s
        const crosswalk = vi.spyOn(sdv, 'resolveEspnAthleteId').mockRejectedValue(new Error('crosswalk is down'));
        try {
            const f = fake('/nfl/players/00-0031381', { id: '00-0031381' });
            expect(await preparePlayer(f.astro, 'nfl')).toEqual({ unavailable: true });
            expect(f.headers.get('Cache-Control')).toBe('no-store');
        } finally {
            crosswalk.mockRestore();
        }
        // and the response the pages return is a 503 with no-store, not the 404 page
        const res = PLAYER_UNAVAILABLE();
        expect(res.status).toBe(503);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        for (const p of ['../src/pages/players/[id].astro', '../src/pages/nfl/players/[id].astro']) {
            const src = readFileSync(new URL(p, import.meta.url)).toString();
            expect(src, p).toContain("'unavailable' in r");
            expect(src, p).toContain('PLAYER_UNAVAILABLE()');
        }
    }, 60_000);
});

describe('a player the API does not have', () => {
    test('404s rather than handing the page an identity shell', async () => {
        const { preparePlayer } = await import('../src/routes/player');
        feed.missing.add('99999999999');
        expect(await preparePlayer(fake('/players/99999999999', { id: '99999999999' }).astro, 'cfb')).toEqual({ notFound: true });
        feed.missing.delete('99999999999');
        // and the page file branches on it -- rendering the marker object would
        // ship an "undefined" page as HTTP 200
        const src = readFileSync(new URL('../src/pages/players/[id].astro', import.meta.url)).toString();
        expect(src).toContain("'notFound' in r");
        expect(src).toContain('Astro.rewrite("/404")');
    }, 60_000);

    test('a malformed id never reaches the API, and the NFL gsis form redirects', async () => {
        const { preparePlayer } = await import('../src/routes/player');
        for (const id of ['kyle', '4433971.0', '', '../../etc']) {
            expect(await preparePlayer(fake(`/players/${id}`, { id }).astro, 'cfb'), id).toEqual({ notFound: true });
        }
        expect(await preparePlayer(fake('/nfl/players/00-0031381?season=2024', { id: '00-0031381' }).astro, 'nfl'))
            .toEqual({ redirect: '/nfl/players/16800?season=2024' });
        expect(await preparePlayer(fake('/nfl/players/00-0000001', { id: '00-0000001' }).astro, 'nfl'))
            .toEqual({ notFound: true });
        // the redirect carries the validated season TEXT: parsing first makes
        // `0000` falsy (param dropped) and rewrites `0202` to `202`, and either
        // way the canonical URL would render the latest season, not 404
        for (const y of ['0000', '0202']) {
            expect(await preparePlayer(fake(`/nfl/players/00-0031381?season=${y}`, { id: '00-0031381' }).astro, 'nfl'), y)
                .toEqual({ redirect: `/nfl/players/16800?season=${y}` });
            expect(await preparePlayer(fake(`/players/4433971?season=${y}`, { id: '4433971' }).astro, 'cfb'), y)
                .toEqual({ notFound: true });
        }
        // a season the player has no rows for is a 404, not an empty page
        expect(await preparePlayer(fake('/players/4433971?season=1999', { id: '4433971' }).astro, 'cfb'))
            .toEqual({ notFound: true });
        const ok = await preparePlayer(fake('/players/4433971?season=2023', { id: '4433971' }).astro, 'cfb') as any;
        expect(ok.season).toBe(2023);
        // no ?season is the CAREER view, not "the latest season" (review on #267)
        const career = await preparePlayer(fake('/players/4433971', { id: '4433971' }).astro, 'cfb') as any;
        expect(career.season).toBeNull();
    }, 60_000);
});

describe('the career view is what `?season=` is absent means', () => {
    test('every season summary, and none of the one-season sections', async () => {
        const html = await renderCareer('cfb', '4433971');
        // every season the player has a row for, newest first, in one table
        const seasons = bodyRows(html, 'player-season-passing')
            .map((r) => cells(r)[0]).filter((s) => /^\d{4}$/.test(s));
        expect(seasons).toEqual([...new Set(cfb.seasons.data
            .filter((r: any) => r.category === 'passing').map((r: any) => String(r.season)))]
            .toSorted().toReversed());
        expect(html).toContain('Career Summary');
        // the three season-only sections are absent, not empty
        for (const id of ['player-game-log-panel', 'player-splits-panel', 'player-team-context']) {
            expect(html, id).not.toContain(`id="${id}"`);
        }
        expect(html).not.toContain('id="player-summary-totals"');
        // canonical and the Dataset describe a career, so neither names a year
        expect(html).toContain('<link rel="canonical" href="https://gameonpaper.com/players/4433971">');
        expect(html).not.toContain('"temporalCoverage"');
        expect(html).toContain('career advanced stats');
        // and the dropdown's Career option is the selected one
        expect(html.split('id="player-season"')[1].split('</select>')[0])
            .toContain('<option value="/players/4433971" selected');
    }, 60_000);

    test('the season view adds the game log, the splits and the team context', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        for (const id of ['player-game-log-panel', 'player-splits-panel', 'player-team-context']) {
            expect(html, id).toContain(`id="${id}"`);
        }
        // and the season table narrows to that one season
        expect(bodyRows(html, 'player-season-passing').map((r) => cells(r)[0]).filter((s) => /^\d{4}$/.test(s)))
            .toEqual(['2024']);
    }, 60_000);
});
