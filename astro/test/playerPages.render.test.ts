import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { categoryColumns, formatPlayerMetric, gameStatLine, percentileOf, totalGameLog } from '../src/utils/players';
import { roundNumber } from '../src/utils/misc';

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

async function renderPage(league: 'cfb' | 'nfl', id: string, season: number) {
    const path = league === 'nfl' ? `/nfl/players/${id}` : `/players/${id}`;
    const { default: Page } = await import(
        league === 'nfl' ? '../src/pages/nfl/players/[id].astro' : '../src/pages/players/[id].astro');
    return container.renderToString(Page, {
        params: { id },
        request: new Request(`https://gameonpaper.com${path}?season=${season}`),
        // the pages are behind the 'player-pages' flag, so the only viewer who
        // reaches one holds the preview cookie
        locals: { preview: true },
    });
}

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
        expect(html).toContain('<title>QB Kyle McCord 2024 advanced stats: EPA per play, success rate and game log | Game on Paper</title>');
        expect(html).toContain('"@type":"Dataset"');
        expect(html).toContain('"temporalCoverage":"2024"');
        // canonical, og:url and the Dataset all name the season the page SHOWS:
        // `?season=` changes the content, so canonicalising every season onto
        // one URL would advertise a page that renders a different year
        expect(html).toContain('<link rel="canonical" href="https://gameonpaper.com/players/4433971?season=2024">');
        expect(html).toContain('"url":"https://gameonpaper.com/players/4433971?season=2024"');
        // the pills offer exactly the seasons the player has rows for, newest first
        for (const y of [2024, 2023, 2022, 2021]) expect(html, `${y}`).toContain(`href="/players/4433971?season=${y}"`);
        expect(html).not.toContain('?season=2020');
        expect(html).toContain('btn btn-sm btn-secondary'); // the selected pill
        expect(html).toContain('headshots/college-football/players/full/4433971.png');
        expect(html).toContain('teamlogos/ncaa/500/183.png');
        expect(html).not.toContain('teamlogos/nfl/');
    }, 60_000);

    test('the summary tiles are the game log summed', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const totals = totalGameLog(cfb.games.data);
        const tiles = html.split('id="player-summary-tiles"')[1].split('</div>\n')[0];
        expect(tiles).toContain(`>${totals.games}<`);
        expect(tiles).toContain(`>${totals.plays}<`);
        expect(tiles).toContain(`>${roundNumber(totals.epa, 2, 2)}<`);
        expect(tiles).toContain(`>${roundNumber(totals.epa_per_play, 2, 2)}<`);
        expect(tiles).toContain(`>${roundNumber((totals.success_rate as number) * 100, 2, 1)}%<`);
        // and the all-plays split is the same population, so the same play count
        expect(totals.plays).toBe(cfb.splits.data.find((s: any) => s.split === 'all').plays);
    }, 60_000);

    test('season line table: every cell holds the field its header names, with EPA/DB per dropback', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const columns = categoryColumns('passing');
        const head = html.split('id="player-season-passing"')[1].split('</thead>')[0];
        expect(head).toContain('>EPA/DB<'); // never "EPA/Play" for a passer
        for (const [, label] of columns) expect(head, label).toContain(`>${label}<`);
        const row = cells(bodyRows(html, 'player-season-passing')[0]);
        const fx = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        expect(row[0]).toBe('2024');
        expect(row[1]).toContain('Syracuse');
        columns.forEach(([k], i) => {
            expect(row[i + 2], k).toBe(formatPlayerMetric('passing', k, fx[k]));
        });
        // the rank is its own indented row, not a second number in the value cell
        const rankRow = cells(bodyRows(html, 'player-season-passing')[1]);
        expect(rankRow[0]).toBe('Rank');
        expect(rankRow[2 + columns.findIndex(([k]) => k === 'TEPA')]).toBe('2');
        // the career roll-up is the last row, over all four seasons
        const rows = bodyRows(html, 'player-season-passing');
        expect(cells(rows[rows.length - 1])[0]).toBe('Career');
    }, 60_000);

    test('game log: every row carries its stat line, its EPA and a link to the game page', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-game-log');
        expect(rows.length).toBe(cfb.games.data.length);
        cfb.games.data.forEach((g: any, i: number) => {
            const c = cells(rows[i]);
            expect(c[0], String(g.game_id)).toBe(String(g.game_date).slice(0, 10));
            expect(c[1]).toBe(String(g.week));
            expect(c[2]).toContain(g.opponent);
            expect(c[4]).toBe(gameStatLine(g.box, 'cfb'));
            expect(c[5]).toBe(String(g.plays));
            expect(c[6]).toBe(roundNumber(g.epa_per_play, 2, 2));
            expect(c[7]).toBe(roundNumber(g.epa, 2, 2));
            expect(c[8]).toBe(`${roundNumber(g.success_rate * 100, 2, 1)}%`);
            expect(rows[i]).toContain(`href="/game/${g.game_id}"`);
        });
        // The page renders the API's rows in order and never re-sorts. This pins
        // that CONTRACT, not GOP code: sdv-db's player_routes sorts on the
        // kickoff date precisely so a postseason game whose schedule `week`
        // restarts at 1 still sorts last. A producer that stopped sorting would
        // break here, which is the point -- nothing in this repo can.
        const dates = rows.map((r) => cells(r)[0]);
        expect([...dates].sort()).toEqual(dates);
        expect(cfb.games.data[cfb.games.data.length - 1].week).toBe(1);
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
            expect(c[4], s.split).toBe(String(s.successes));
        });
        expect(html).not.toContain('>Overtime<');
        expect(html).toContain('Standard downs');
        expect(html).toContain('Passing downs');
        expect(html).toContain('Red zone');
    }, 60_000);

    test('percentile bars are as wide as the producer\'s _pct, on the green to purple ramp', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const block = html.split('id="player-percentiles-passing"')[1].split('id="player-team-context"')[0];
        const fx = cfb.seasons.data.find((r: any) => r.category === 'passing' && r.season === 2024);
        const bars = categoryColumns('passing').filter(([k]) => percentileOf(fx, k) !== null);
        expect(bars.length).toBeGreaterThan(0);
        for (const [k] of bars) {
            expect(block, k).toContain(`width: ${percentileOf(fx, k)}%`);
        }
        // the site's ramp, never green/red: EPA/DB at the 94.7th percentile is level 9
        expect(block).toContain('hulk-bg-level-9');
        expect(html).not.toContain('bg-danger');
        // a metric with no percentile gets no bar at all
        expect(block).not.toContain('width: null%');
        expect(block).not.toContain('width: NaN%');
    }, 60_000);

    test('team context reuses the team_summaries row the team leaderboards read', async () => {
        const html = await renderPage('cfb', '4433971', 2024);
        const rows = bodyRows(html, 'player-team-context-table');
        expect(cells(rows[0])[0]).toContain('Syracuse');
        expect(cells(rows[0])[1]).toBe('0.21');
        expect(cells(rows[0])[2]).toBe('48.0%');
        expect(cells(rows[1])[0]).toBe('Rank');
        expect(html).toContain('href="/year/2024/team/183"');
        expect(html).toContain('alt="Syracuse logo"');
    }, 60_000);

    test('a team_summaries column the producer did not publish reads as absent, not zero', async () => {
        const sdv = await import('../src/resources/sdv');
        const spy = vi.spyOn(sdv, 'retrieveTeamSummaries').mockResolvedValue(
            [{ team_id: 183, pos_team: 'Syracuse' }] as any);
        try {
            const html = await renderPage('cfb', '4433971', 2024);
            const row = cells(bodyRows(html, 'player-team-context-table')[0]);
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
        expect(cells(rows[2])[1]).toContain('LV');
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
        });
    }, 60_000);

    test('percentiles render for the NFL too, and a stint below the gate gets none', async () => {
        const html = await renderPage('nfl', '16800', 2024);
        const nyj = nfl.seasons.data.find((r: any) => r.category === 'receiving' && r.season === 2024 && r.pos_team === 'NYJ');
        const lv = nfl.seasons.data.find((r: any) => r.category === 'receiving' && r.season === 2024 && r.pos_team === 'LV');
        expect(percentileOf(nyj, 'EPAplay')).not.toBeNull();
        expect(percentileOf(lv, 'EPAplay')).toBeNull();
        // the bars come from the season's primary team-season (114 plays with the
        // Jets, not the 27-play Raiders stint under the qualification gate)
        expect(html).toContain(`width: ${percentileOf(nyj, 'EPAplay')}%`);
        expect(html).toContain('hulk-bg-level-');
        // EVERY bar is on the ramp. generateColorRampValue returns null through the
        // middle of the distribution (levels 4-5), which leaves a table cell unshaded
        // but leaves a .progress-bar on Bootstrap's blue -- two of this player's 2024
        // bars (TEPA 52.6th, Yards/Tgt 43.2nd) sit in that band.
        const bars = [...html.matchAll(/<div class="([^"]*progress-bar[^"]*)"/g)].map((m) => m[1]);
        expect(bars.length).toBeGreaterThan(0);
        expect(bars.filter((b) => !/hulk-bg-level-\d/.test(b))).toEqual([]);
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
        // no ?season: the player's latest
        const latest = await preparePlayer(fake('/players/4433971', { id: '4433971' }).astro, 'cfb') as any;
        expect(latest.season).toBe(2024);
    }, 60_000);
});
