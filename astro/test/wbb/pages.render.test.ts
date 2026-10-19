// astro/test/wbb/pages.render.test.ts
// Every WBB dashboard page on the real captures (Task 2), through the real loaders; only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL, courtFor, rankMins } from '../../src/basketball/config';
import { NCAA_USAGE_NOTE } from '../../src/basketball/dashboards';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { describeHex } from '../../src/nba/charts/hexShotChart';
import { buildDashboard } from '../../src/nba/dashboard';
import {
    SC, conferenceNames, conferences, coverage, leadersGames2026, leadersLatest2026, leagueContext, p26, player2019Games, player2026Games,
    player2026Seasons, player2026Shots, scShots, scheduleTeams, seasonPlayers, type Season,
} from './dashboardFixtures';
import { defaultScatterConference } from '../../src/basketball/dashboards';

const CAPTURED = [2019, 2022, 2026];
const lite = ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result }: any) => ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result });
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number, lg: string) => { if (lg !== 'wbb') throw new Error(`league ${lg}`); return CAPTURED.includes(s) ? seasonPlayers(s as Season) : []; },
    retrieveLeagueContextRows: async (s: number) => (CAPTURED.includes(s) ? leagueContext(s as Season) : []),
    retrieveTeamShots: async (s: number, t: number) => (t === SC && CAPTURED.includes(s) ? scShots(s as Season).map(lite) : []),
    retrievePlayerShots: async (s: number, id: number) => (s === 2026 && id === p26().person_id ? player2026Shots() : []),
    retrievePlayerGameRows: async (s: number, id: number) => (s === 2026 && id === p26().person_id ? player2026Games() : s === 2019 ? player2019Games() : []),
    retrievePlayerSeasons: async () => [...new Set(player2026Seasons().map((r) => Number(r.season)))].sort((a, b) => a - b),
    retrieveCoverageRows: async () => coverage(),
    retrieveConferenceRows: async (s: number) => (CAPTURED.includes(s) ? { teams: conferences(s as Season), groups: conferenceNames(s as Season) } : { teams: [], groups: [] }),
    retrieveScheduleTeamRows: async (s: number) => (CAPTURED.includes(s) ? scheduleTeams(s as Season) : []),
    retrieveLatestGameDate: async () => leadersLatest2026()[0].game_date,
    retrieveSeasonPlayerGameRows: async (_s: number, _lg: string, since?: string) => { if (!since) throw new Error('a season-wide college read'); return leadersGames2026(); },
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function page(file: string, url: string, params: Record<string, string> = {}) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/wbb/${file}`);
    return container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true } as App.Locals });
}
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');
const plain = (h: string) => noScripts(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** What every WBB dashboard page must be: one h1, the season label, the college source and scope, no NBA leftovers, no PIE. */
function wbbPage(html: string, label: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(label);
    expect(html).not.toContain('stats.nba.com');
    expect(html).not.toContain('Nets');
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // the Header's league switch only
    expect([...html.matchAll(/href="\/mbb\/[^"]*"/g)]).toEqual([]);                            // no men's page is linked from a women's page
    expect(plain(html)).not.toMatch(/\bPIE\b(?! is not shown)/);                                 // D25: only the usage note names it
    expect(html).not.toContain('no recorded location');                                          // D29: no placeholder in WBB stats.ncaa.org shots
    expect(html).not.toContain('no charted shots');                                              // Decision 8
    expect(html).not.toMatch(/>2017-18</);                                                        // the picker starts at 2018-19
    for (const bad of ['NaN', 'undefined']) expect(noScripts(html)).not.toContain(bad);
}
const hexDesc = (shots: any[], season: Season) =>
    describeHex(buildDashboard(shotsFromRows(shots), leagueContextFromRows(leagueContext(season)), courtFor('wbb', season)).hex);
const sizes: Record<string, number> = {};
const size = (k: string, html: string) => { sizes[k] = Buffer.byteLength(html); return html; };
const bar = rankMins('wbb', 2026).fga; // 39 (D44: wbbGamesInScope(2026) = 32)
// plan #9's D42 scatter URL parameter and its "All D-I" value, as Task 1 Step 0 printed them (planning names)
const CONF_PARAM = 'conference';
const ALL_DI = 'all';

describe('the WBB dashboard pages', () => {
    test('/wbb: the teams index of all 363 programs by conference is the landing, with a scoreboard link and the coverage note', async () => {
        const html = size('/wbb', await page('index.astro', '/wbb'));
        wbbPage(html, 'WBB teams, 2025-26');
        expect(html).toContain('id="nba-teams-table"');
        expect(new Set([...html.matchAll(/href="\/wbb\/team\/(\d+)"/g)].map((m) => m[1])).size).toBe(363);   // D38
        for (const id of [2130, 2385, 2441, 2837, 88]) expect(html, String(id)).toContain(`href="/wbb/team/${id}"`);
        expect(html).toContain('href="/wbb/scoreboard"');
        expect(html).toContain('href="https://gameonpaper.com/wbb"');
        expect(plain(html)).toContain('stats.ncaa.org shot charts, 2025-26:');
        expect(plain(html)).toContain('from teams linked to an ESPN Division I team');
        expect(html).toContain('regular-season and postseason shooting line, from stats.ncaa.org shot charts');
        expect(html).toContain('>Players &rarr;</a>');
    });
    test('/wbb/teams?season=2019: 2019 conferences, 351 programs (D43: LIU 112358 out), the partial-season numbers', async () => {
        const html = await page('teams.astro', '/wbb/teams?season=2019');
        wbbPage(html, 'Teams, 2018-19');
        expect(new Set([...html.matchAll(/href="\/wbb\/team\/(\d+)\?season=2019"/g)].map((m) => m[1])).size).toBe(351);
        expect(html).not.toContain('href="/wbb/team/112358?season=2019"');
        expect(plain(html)).toContain('2018-19 has 236,067 charted shots against 708,038 in 2025-26.');
        expect(plain(html)).not.toContain('Other Division I');
        expect(html).toContain('href="https://gameonpaper.com/wbb/teams?season=2019"');
    });
    test("/wbb/team/<South Carolina>: the 2026 women's court in the hex chart; USG% labelled, no PIE", async () => {
        const html = size('/wbb/team/2579', await page('team/[id].astro', `/wbb/team/${SC}`, { id: String(SC) }));
        wbbPage(html, '2025-26 regular season + postseason');
        expect(html).toContain(hexDesc(scShots(2026).map(lite), 2026));
        expect(html).toContain('>USG%<');
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
        expect(html).toContain(`href="/wbb/players?team=${SC}"`);
    });
    test('/wbb/team/<South Carolina>?season=2022 and 2019: each season\'s own arc', async () => {
        for (const s of [2022, 2019] as const) {
            const html = await page('team/[id].astro', `/wbb/team/${SC}?season=${s}`, { id: String(SC) });
            wbbPage(html, `${s === 2022 ? '2021-22' : '2018-19'} regular season + postseason`);
            expect(html, String(s)).toContain(hexDesc(scShots(s).map(lite), s)); // the court each season zones on is Task 3's parity proof
        }
    });
    test('/wbb/team/2837: a reclassifying program with no linked shots is a page that says so (D38, Decision 8)', async () => {
        const html = await page('team/[id].astro', '/wbb/team/2837', { id: '2837' });
        const name = BASKETBALL.wbb.teams.inSeason(2837, 2026)!.name.replace(/&/g, '&amp;'); // East Texas A&M, as the HTML escapes it
        wbbPage(html, name);
        expect(plain(html)).toContain(`No stats.ncaa.org shots are linked to ${name} in 2025-26.`);
        expect(html).not.toContain('id="nba-hex-panel"');
    });
    test('/wbb/players: choose a team; ?team=<South Carolina>: her team list', async () => {
        const choose = await page('players.astro', '/wbb/players');
        wbbPage(choose, 'Players, 2025-26');
        expect(plain(choose)).toContain('Choose a team to list its players.');
        expect(choose).not.toContain('id="nba-players"');
        const sc = await page('players.astro', `/wbb/players?team=${SC}`);
        wbbPage(sc, 'Players, 2025-26');
        expect(sc).toContain('id="nba-players"');
        expect(sc).toContain(`href="https://gameonpaper.com/wbb/players?team=${SC}"`);
        expect(sc).toContain('Regular-season and postseason field-goal attempts from stats.ncaa.org shot charts');
    });
    test('/wbb/players/<p26>: the season bars, the scope, the women\'s court, box-score USG%, her', async () => {
        const id = p26().person_id;
        const html = size('/wbb/players/[p26]', await page('players/[id].astro', `/wbb/players/${id}`, { id: String(id) }));
        wbbPage(html, '2025-26 regular season + postseason');
        expect(html).toContain(`Among players with ${bar}+ field-goal attempts this regular season + postseason;`);
        expect(html).toContain('full regular season + postseason');
        expect(html).toContain(hexDesc(player2026Shots(), 2026));
        expect(plain(html)).toMatch(/USG% &middot; [\d.]+% TS%/); // plain() keeps entities; the shared template writes &middot;
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
        expect(html).toContain('&quot;pronoun&quot;:[0,&quot;her&quot;]'); // plan #6's pronoun prop on the explorer island
        expect(plain(html)).not.toMatch(/\bhis season\b/);
    });
    test('/wbb/scatter: D42/D46 opens on the computed default conference; All D-I on request; the 2026 bar, no highlight, the usage note', async () => {
        const html = size('/wbb/scatter', await page('scatter.astro', '/wbb/scatter'));
        wbbPage(html, 'WBB scatter, 2025-26');
        expect(html).toContain(`Players with ${bar}+ FGA.`);
        expect(plain(html)).toContain(NCAA_USAGE_NOTE);
        const dflt = defaultScatterConference(seasonPlayers(2026), conferences(2026), 2026, 'wbb'); // D46: computed (R2: a reference slug)
        expect(dflt).toBe('acc'); // R-S8: computed; 2026 ACC and Big Ten tie at 167 qualifiers, the A-Z tiebreak picks the ACC
        expect(html).toMatch(new RegExp(`<option value="${dflt}" selected`));
        const all = size('/wbb/scatter all', await page('scatter.astro', `/wbb/scatter?${CONF_PARAM}=${ALL_DI}`));
        wbbPage(all, 'WBB scatter, 2025-26');
        expect(sizes['/wbb/scatter'] * 10).toBeLessThan(sizes['/wbb/scatter all']); // only one conference's 167 points serialized (D42), not All D-I's 3,431
        const bad = await page('scatter.astro', `/wbb/scatter?${CONF_PARAM}=49`); // an ESPN group id is not a reference slug (R2)
        expect(bad).toMatch(new RegExp(`<option value="${dflt}" selected`)); // unknown value: the default, never a 404 and never the whole league
    });
    test('/wbb/leaders: two windows inside the 49-day read, her pronoun', async () => {
        const html = size('/wbb/leaders', await page('leaders.astro', '/wbb/leaders'));
        wbbPage(html, 'WBB rolling leaders, 2025-26');
        expect(html).toContain('over their last 5 and 10 games');
        expect(html).toContain('the last 49 days of games.');
        expect(html).not.toContain('>20 games<');
        expect(html).toContain('&quot;pronoun&quot;:[0,&quot;her&quot;]');
        expect(html.match(/<tr class="fw-bold"/g)).toBeNull();
    });
    test('unknown ids are 404s', async () => {
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const fake = (path: string, id: string) => ({ params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
        expect(await prepareBasketballPlayer(fake('/wbb/players/123', '123'), 'wbb')).toEqual({ notFound: true });
    });
    test('HTML budgets (measured on these captures x 1.2)', () => {
        const BUDGET: Record<string, number> = { '/wbb': 242253, '/wbb/team/2579': 144102, '/wbb/players/[p26]': 304592, '/wbb/scatter': 123536, '/wbb/scatter all': 2029853, '/wbb/leaders': 105629 };
        for (const [k, b] of Object.entries(BUDGET)) expect(sizes[k], k).toBeLessThanOrEqual(b);
    });
});
