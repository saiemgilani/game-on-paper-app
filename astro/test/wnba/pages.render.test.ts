// astro/test/wnba/pages.render.test.ts
// Every WNBA dashboard page on the real captures (Task 2), through the real loaders; only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { BASKETBALL, courtFor } from '../../src/basketball/config';
import { leagueContextFromRows, shotsFromRows } from '../../src/nba/adapters';
import { describeHex } from '../../src/nba/charts/hexShotChart';
import { buildDashboard } from '../../src/nba/dashboard';
import { placeholderAt, placeholderNote } from '../../src/nba/data/placeholder';
import {
    SEA, leagueContext, leagueShots2003, p03, p26, player2003Games, player2026Seasons, player2026Shots, playerGames2026, seaShots, seasonPlayers,
} from './dashboardFixtures';

const lite = ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result }: any) => ({ game_id, x_legacy, y_legacy, shot_distance, shot_value, shot_result });
const SEASON_ROWS: Record<number, () => any[]> = { 2003: () => seasonPlayers(2003), 2008: () => seasonPlayers(2008), 2025: () => seasonPlayers(2025), 2026: () => seasonPlayers(2026) };
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (s: number, lg: string) => { if (lg !== 'wnba') throw new Error(`league ${lg}`); return SEASON_ROWS[s]?.() ?? []; },
    retrieveLeagueContextRows: async (s: number) => leagueContext(s as 2003 | 2026),
    retrievePlayerShots: async (s: number, id: number) => (s === 2026 ? (id === p26().person_id ? player2026Shots() : []) : leagueShots2003().filter((r) => r.person_id === id).map(lite)),
    retrieveTeamShots: async (s: number, t: number) => (s === 2026 ? (t === SEA ? seaShots(2026) : []) : leagueShots2003().filter((r) => r.team_id === t).map(lite)),
    retrievePlayerGameRows: async (s: number, id: number) => (s === 2026 ? playerGames2026().filter((g) => g.person_id === id) : player2003Games()),
    retrieveSeasonPlayerGameRows: async (s: number) => (s === 2026 ? playerGames2026() : []),
    retrievePlayerSeasons: async (id: number) => (id === p26().person_id ? [...new Set(player2026Seasons().map((r) => Number(r.season)))].sort((a, b) => a - b) : [2003]),
}));

let container: AstroContainer;
beforeAll(async () => { container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) }); });
async function page(file: string, url: string, params: Record<string, string> = {}) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/wnba/${file}`);
    return container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true } as App.Locals });
}
const noScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');
/** What every WNBA dashboard page must be: one h1, WNBA copy, a year label, no NBA leftovers. */
function wnbaPage(html: string, label: string) {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(label);
    expect(noScripts(html)).not.toMatch(/\b(19|20)\d\d-\d\d\b(?!-\d)/); // a span season label such as 2025-26 (an ISO date such as 2026-10-12 is not one)
    expect(html).not.toContain('stats.nba.com');
    expect(html).not.toContain('Nets');
    expect([...html.matchAll(/href="\/nba[^"]*"/g)].map((m) => m[0])).toEqual(['href="/nba"']); // only the Header's league switch
    for (const bad of ['NaN', 'undefined']) expect(noScripts(html)).not.toContain(bad);
}
const hexDesc = (shots: any[], season: 2003 | 2026) =>
    describeHex(buildDashboard(shotsFromRows(shots), leagueContextFromRows(leagueContext(season)), courtFor('wnba', season), placeholderAt(BASKETBALL.wnba.placeholderLocation, season)).hex);
/** D29: the note a page shows for these shots ('' when none sit at the placeholder) */
const noteFor = (shots: { x_legacy: number; y_legacy: number }[]) =>
    placeholderNote(shots.filter((s) => s.x_legacy === 0 && s.y_legacy === 0).length, shots.length, 'season');
const leagueNote = (season: 2003 | 2026) => {
    const t = leagueContext(season).find((r) => r.kind === 'total')!;
    return placeholderNote(t.placeholder_shots ?? 0, t.attempts, 'season');
};

describe('the WNBA dashboard pages', () => {
    test('/wnba: the teams index is the landing, with a scoreboard link', async () => {
        const html = await page('index.astro', '/wnba');
        wnbaPage(html, 'WNBA teams, 2026');
        expect(new Set([...html.matchAll(/href="\/wnba\/team\/(\d+)"/g)].map((m) => m[1])).size).toBe(15);
        expect(html).toContain('href="/wnba/scoreboard"');
        expect(html).toContain('href="https://gameonpaper.com/wnba"'); // canonical: the landing, not /wnba/teams
        expect(html).toContain('stats.wnba.com');
        // R22: 2026 is after the last placeholder season, so no note (its 4 genuine (0, 0) shots are charted)
        expect(leagueNote(2026)).toBe('');
        expect(html).not.toContain('have no recorded location');
    });
    test('/wnba/teams?season=2003: folded franchises and former names; the league-wide placeholder note (D29)', async () => {
        const html = await page('teams.astro', '/wnba/teams?season=2003');
        wnbaPage(html, 'Teams, 2003');
        expect(new Set([...html.matchAll(/href="\/wnba\/team\/(\d+)\?season=2003"/g)].map((m) => m[1])).size).toBe(14);
        for (const n of ['Houston Comets', 'Detroit Shock', 'San Antonio Silver Stars']) expect(html).toContain(n);
        expect(html).toContain('5,677 of 28,436 shots this season have no recorded location.');
    });
    test('/wnba/team/<Seattle>: the 2026 court in the hex chart; USG% and PIE in the roster; no placeholder note', async () => {
        const html = await page('team/[id].astro', `/wnba/team/${SEA}`, { id: String(SEA) });
        wnbaPage(html, 'Seattle Storm');
        expect(html).toContain(hexDesc(seaShots(2026), 2026));
        for (const h of ['USG%', 'PIE']) expect(html).toContain(`>${h}<`);
        expect(noteFor(seaShots(2026))).toBe(''); // Seattle 2026 has no (0, 0) shot
        expect(html).not.toContain('have no recorded location');
    });
    test('/wnba/team/<Seattle>?season=2003: the 2003 court; 424 of 2,045 shots have no recorded location (D29)', async () => {
        const html = await page('team/[id].astro', `/wnba/team/${SEA}?season=2003`, { id: String(SEA) });
        wnbaPage(html, '2003 regular season');
        expect(html).toContain(hexDesc(leagueShots2003().filter((s) => s.team_id === SEA).map(lite), 2003));
        expect(html).toContain('424 of 2,045 shots this season have no recorded location.');
    });
    test("a team page's season picker lists only its franchise's seasons (Charlotte 1997-2006, Detroit's franchise 1998-2026)", async () => {
        const options = (html: string) => [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
        const cha = options(await page('team/[id].astro', '/wnba/team/1611661314?season=2003', { id: '1611661314' }));
        expect(cha).toEqual(Array.from({ length: 10 }, (_, i) => `/wnba/team/1611661314?season=${2006 - i}`));
        const det = options(await page('team/[id].astro', '/wnba/team/1611661321?season=2003', { id: '1611661321' }));
        expect([det.length, det[0], det.at(-1)]).toEqual([29, '/wnba/team/1611661321', '/wnba/team/1611661321?season=1998']);
    });
    test("the players page's season picker carries the team only to its franchise's seasons (no 2026 PDX to the 2000-02 Fire)", async () => {
        const options = (html: string) => [...html.match(/<select id="nba-season"[\s\S]*?<\/select>/)![0].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
        const pdx = options(await page('players.astro', '/wnba/players?team=PDX'));
        expect(pdx[0]).toBe('/wnba/players?team=PDX');
        expect(pdx).toContain('/wnba/players?season=2002');
        expect(pdx.filter((o) => o.includes('team='))).toEqual(['/wnba/players?team=PDX']);
        const sea = options(await page('players.astro', '/wnba/players?team=SEA'));
        expect(sea).toContain('/wnba/players?team=SEA&season=2002');
        expect(sea).toContain('/wnba/players?season=1999'); // Seattle's first season is 2000
        expect(sea.filter((o) => o.includes('team=SEA'))).toHaveLength(27);
    });
    test('/wnba/players: every 2026 shooter, the WNBA source', async () => {
        const html = await page('players.astro', '/wnba/players');
        wnbaPage(html, 'WNBA players, 2026');
        expect(html).toContain('stats.wnba.com');
    });
    test("/wnba/players/<p26>: the season's bars, her season, the 2026 court", async () => {
        const id = p26().person_id;
        const html = await page('players/[id].astro', `/wnba/players/${id}`, { id: String(id) });
        wnbaPage(html, '2026 regular season');
        expect(html).toContain('Among players with 54+ field-goal attempts');
        expect(html).toContain('27+ three-point attempts');
        expect(html).toContain('against her season FG%');
        expect(html).toContain(hexDesc(player2026Shots(), 2026));
        expect(html).toMatch(/USG%.*TS%.*PIE/s);
    });
    test('/wnba/players/<p03>?season=2003: no headshot, ESPN\'s no-photo image (D18)', async () => {
        const id = p03().person_id;
        const html = await page('players/[id].astro', `/wnba/players/${id}?season=2003`, { id: String(id) });
        wnbaPage(html, '2003 regular season');
        expect(html).toContain('i/headshots/nophoto.png');
        expect(html).toContain('Among players with 41+ field-goal attempts');
        const note = noteFor(leagueShots2003().filter((s) => s.person_id === id));
        expect(note).toMatch(/^\d[\d,]* of [\d,]+ shots this season have no recorded location\.$/); // 2003 parks a fifth of all shots
        expect(html).toContain(note); // D29 on the player view, from her own season's shots
    });
    test('/wnba/scatter: the 2026 bar, no highlight', async () => {
        const html = await page('scatter.astro', '/wnba/scatter');
        wnbaPage(html, 'WNBA scatter, 2026');
        expect(html).toContain('Players with 54+ FGA.');
        expect(html).toMatch(/\d+ players with 54\+ FGA, /);
    });
    test('/wnba/leaders: the boards, no featured team', async () => {
        const html = await page('leaders.astro', '/wnba/leaders');
        wnbaPage(html, 'WNBA rolling leaders, 2026');
        expect(html).toContain('id="nba-leaders"');
        expect(html.match(/<tr class="fw-bold"/g)).toBeNull(); // no highlighted row
        const m = html.match(/a full (\d+)-game window\), (\d+)\+ FGA in it/)!;
        expect(Number(m[2])).toBe(4 * Number(m[1])); // D31: the WNBA's 4 FGA a game
    });
    test('an unknown player or team is a 404, never a shell', async () => {
        const { prepareBasketballPlayer } = await import('../../src/routes/basketball/player');
        const { prepareBasketballTeam } = await import('../../src/routes/basketball/team');
        const fake = (path: string, id: string) => ({ params: { id }, url: new URL(`https://gameonpaper.com${path}`), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
        expect(await prepareBasketballPlayer(fake('/wnba/players/123', '123'), 'wnba')).toEqual({ notFound: true });
        expect(await prepareBasketballTeam(fake('/wnba/team/1611661316', '1611661316'), 'wnba')).toEqual({ notFound: true }); // Houston folded in 2008
    });
    test("prepareBasketballHome is the featured-team page only: it refuses the WNBA's teams-index landing", async () => {
        const { prepareBasketballHome } = await import('../../src/routes/basketball/home');
        const fake = { params: {}, url: new URL('https://gameonpaper.com/wnba'), locals: {} as any, cache: { set: () => {} }, response: { headers: new Headers() } } as any;
        await expect(prepareBasketballHome(fake, 'wnba')).rejects.toThrow(/no featured-team landing/);
    });
});
