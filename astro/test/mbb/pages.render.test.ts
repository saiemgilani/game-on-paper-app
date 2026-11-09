// astro/test/mbb/pages.render.test.ts
// Every MBB dashboard page on the real captures (Task 2), through the real loaders; only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { NCAA_USAGE_NOTE, defaultScatterConference, withSeasonMembers } from '../../src/basketball/dashboards';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { describeHex } from '../../src/nba/charts/hexShotChart';
import { buildDashboard } from '../../src/nba/dashboard';
import {
    TEX, conferenceNames, conferences, coverage, leadersGames2026, leadersLatest2026, leagueContext, p26, player2019Games, player2026Games,
    player2026Seasons, player2026Shots, scheduleTeams, seasonPlayers, texShots,
} from './dashboardFixtures';

const lite = ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result }: any) => ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result });
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number, lg: string) => { if (lg !== 'mbb') throw new Error(`league ${lg}`); return [2019, 2023, 2026].includes(s) ? seasonPlayers(s as 2019 | 2023 | 2026) : []; },
    retrieveLeagueContextRows: async (s: number) => leagueContext(s as 2019 | 2026),
    retrieveTeamShots: async (s: number, t: number) => (t === TEX ? texShots(s as 2019 | 2026).map(lite) : []),
    retrievePlayerShots: async (s: number, id: number) => (s === 2026 && id === p26().person_id ? player2026Shots() : []),
    retrievePlayerGameRows: async (s: number, id: number) => (s === 2026 && id === p26().person_id ? player2026Games() : s === 2019 ? player2019Games() : []),
    retrievePlayerSeasons: async () => [...new Set(player2026Seasons().map((r) => Number(r.season)))].sort((a, b) => a - b),
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => ({ teams: conferences(s as 2019 | 2026), groups: conferenceNames(s as 2019 | 2026) }),
    retrieveScheduleTeamRows: async (s: number) => scheduleTeams(s as 2019 | 2021 | 2026),
    retrieveLatestGameDate: async () => leadersLatest2026()[0].game_date,
    retrieveSeasonPlayerGameRows: async (_s: number, _lg: string, since?: string) => { if (!since) throw new Error('a season-wide college read'); return leadersGames2026(); },
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function page(file: string, url: string, params: Record<string, string> = {}) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/mbb/${file}`);
    return container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true } as App.Locals });
}
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');
const plain = (h: string) => noScripts(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** What every MBB dashboard page must be: one h1, the season label, the college source and scope, no NBA leftovers, no PIE. */
function mbbPage(html: string, label: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(label);
    expect(html).not.toContain('stats.nba.com');
    expect(html).not.toContain('Nets');
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // the Header's league switch only
    expect(plain(html)).not.toMatch(/\bPIE\b(?! is not shown)/);                                 // D25: only the usage note names it
    expect(html).not.toContain('no recorded location');                                          // D29: no placeholder in stats.ncaa.org shots
    expect(html).not.toMatch(/>2017-18</);                                                        // the picker starts at 2018-19
    for (const bad of ['NaN', 'undefined']) expect(noScripts(html)).not.toContain(bad);
}
const hexDesc = (shots: any[], season: 2019 | 2026) =>
    describeHex(buildDashboard(shotsFromRows(shots), leagueContextFromRows(leagueContext(season)), courtFor('mbb', season)).hex);
const sizes: Record<string, number> = {};
const size = (k: string, html: string) => { sizes[k] = Buffer.byteLength(html); return html; };

describe('the MBB dashboard pages', () => {
    test('/mbb: the teams index by conference is the landing, with a scoreboard link and the coverage note', async () => {
        const html = size('/mbb', await page('index.astro', '/mbb'));
        mbbPage(html, 'MBB teams, 2025-26');
        expect(html).toContain('id="nba-teams-table"');
        expect(new Set([...html.matchAll(/href="\/mbb\/team\/(\d+)"/g)].map((m) => m[1])).size).toBe(365); // the 2026 members (D43/D47)
        expect(html).not.toContain('href="/mbb/team/42"');
        expect(html).toContain('href="/mbb/scoreboard"');
        expect(html).toContain('href="https://gameonpaper.com/mbb"');
        expect(plain(html)).toContain('stats.ncaa.org shot charts, 2025-26:');
        expect(html).toContain('regular-season and postseason shooting line, from stats.ncaa.org shot charts');
        expect(html).toContain('>Players &rarr;</a>');
    });
    test('/mbb/teams?season=2019: 2019 conferences and the partial-season numbers', async () => {
        const html = await page('teams.astro', '/mbb/teams?season=2019');
        mbbPage(html, 'Teams, 2018-19');
        expect(plain(html)).toContain('2018-19 has 257,291 charted shots against 740,861 in 2025-26.');
        expect(html).toContain('href="https://gameonpaper.com/mbb/teams?season=2019"');
    });
    test('/mbb/team/<Texas>: the 2026 NCAA court in the hex chart; USG% labelled, no PIE', async () => {
        const html = size('/mbb/team/251', await page('team/[id].astro', `/mbb/team/${TEX}`, { id: String(TEX) }));
        mbbPage(html, '2025-26 regular season + postseason');
        expect(html).toContain(hexDesc(texShots(2026).map(lite), 2026));
        expect(html).toContain('>USG%<');
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
        expect(html).toContain(`href="/mbb/players?team=${TEX}"`);
    });
    test('/mbb/team/<Texas>?season=2019: the 20\' 9" court', async () => {
        const html = await page('team/[id].astro', `/mbb/team/${TEX}?season=2019`, { id: String(TEX) });
        mbbPage(html, '2018-19 regular season + postseason');
        expect(html).toContain(hexDesc(texShots(2019).map(lite), 2019));
    });
    test("a 2019 member with no linked shot: the D48 sentence, no charts (Task 5 Step 1's member; Hartford 2026 is a 404 there)", async () => {
        const shotTeams = new Set(seasonPlayers(2019).map((x) => x.team_id));
        const m = withSeasonMembers([], conferences(2019), scheduleTeams(2019), 2019, 'mbb').find((t) => !shotTeams.has(t.team_id))!;
        const html = await page('team/[id].astro', `/mbb/team/${m.team_id}?season=2019`, { id: String(m.team_id) });
        mbbPage(html, m.name);
        expect(plain(html)).toContain(`No stats.ncaa.org shots are linked to ${m.name} in 2018-19.`);
        expect(plain(html)).not.toContain('no charted shots');
        expect(html).not.toContain('id="nba-hex-panel"');
        expect(html).not.toContain('id="nba-line"'); // no "0/0 FG · n/a FG%" header line on the empty page (final review)
    });
    test('/mbb/players: choose a team; /mbb/players?team=<Texas>: the Texas list', async () => {
        const choose = await page('players.astro', '/mbb/players');
        mbbPage(choose, 'Players, 2025-26');
        expect(plain(choose)).toContain('Choose a team to list its players.');
        expect(choose).not.toContain('id="nba-players"');
        const tex = await page('players.astro', `/mbb/players?team=${TEX}`);
        mbbPage(tex, 'Players, 2025-26');
        expect(tex).toContain('id="nba-players"');
        expect(tex).toContain(`href="https://gameonpaper.com/mbb/players?team=${TEX}"`);
        expect(tex).toContain('Regular-season and postseason field-goal attempts from stats.ncaa.org shot charts');
    });
    test('/mbb/players/<p26>: the season bars, the scope, the NCAA court, box-score USG%', async () => {
        const id = p26().person_id;
        const html = size('/mbb/players/[p26]', await page('players/[id].astro', `/mbb/players/${id}`, { id: String(id) }));
        mbbPage(html, '2025-26 regular season + postseason');
        expect(html).toContain('Among players with 40+ field-goal attempts this regular season + postseason;');
        expect(html).toContain('else stats.ncaa.org shot charts.'); // review Minor 3: not the NBA's "play-by-play shots"
        expect(html).toContain('full regular season + postseason');
        expect(html).toContain(hexDesc(player2026Shots(), 2026));
        expect(plain(html)).toMatch(/USG% &middot; [\d.]+% TS%/); // plain() keeps entities; the shared template writes &middot;
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
    });
    test('/mbb/scatter: the 2026 bar (D44: 40), no highlight, the usage note, the computed default conference (D46)', async () => {
        const html = size('/mbb/scatter', await page('scatter.astro', '/mbb/scatter'));
        mbbPage(html, 'MBB scatter, 2025-26');
        expect(html).toContain('Players with 40+ FGA.');
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
        expect(html).toMatch(new RegExp(`<option value="${defaultScatterConference(seasonPlayers(2026), conferences(2026), 2026, 'mbb')}" selected`));
        const all = size('/mbb/scatter?conference=all', await page('scatter.astro', '/mbb/scatter?conference=all'));
        expect(all).toMatch(/<option value="all" selected/);
    });
    test('/mbb/leaders: two windows inside the 49-day read', async () => {
        const html = size('/mbb/leaders', await page('leaders.astro', '/mbb/leaders'));
        mbbPage(html, 'MBB rolling leaders, 2025-26');
        expect(html).toContain('over their last 5 and 10 games');
        expect(html).toContain('the last 49 days of games.');
        expect(html).not.toContain('>20 games<');
        expect(html.match(/<tr class="fw-bold"/g)).toBeNull();
    });
    test('unknown ids are 404s (the page-level Astro.rewrite is rendered in notFound.render.test.ts)', async () => {
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const fake = (path: string, id: string) => ({ params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
        expect(await prepareBasketballPlayer(fake('/mbb/players/123', '123'), 'mbb')).toEqual({ notFound: true });
    });
    test('HTML budgets (measured on these captures x 1.2; Step 3 sets them)', () => {
        const BUDGET: Record<string, number> = { '/mbb': 243155, '/mbb/team/251': 147119, '/mbb/players/[p26]': 260507, '/mbb/scatter': 124539, '/mbb/scatter?conference=all': 2069946, '/mbb/leaders': 101289 };
        for (const [k, b] of Object.entries(BUDGET)) expect(sizes[k], k).toBeLessThanOrEqual(b);
    });
});
