// astro/test/basketball/leagueShots.test.ts
// BB-G16 ('bball-league-shots'): /<league>/shots, every team's square chart. Real captures: the NBA's and MBB's 2025-26
// `kind='square'` league rows (sdv-db #191), the 2026 season-player rows, the Nets' 2,000 2026 shots and Texas's 2026 shots.
// Only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LeagueContextRow, ShotApiRow } from '../../src/resources/nbaShots';
import { apiSeasonPlayerRows } from '../nba/rows';
import * as mbb from '../mbb/dashboardFixtures';

vi.setConfig({ testTimeout: 60_000 });
const NETS = 1610612751;
const CELTICS = 1610612738;
const nbaContext = JSON.parse(readFileSync(new URL('../fixtures/nba/league_context_squares_2026.json', import.meta.url)).toString()) as LeagueContextRow[];
const netsShots = JSON.parse(readFileSync(new URL('../fixtures/nba/shots.json', import.meta.url)).toString()) as ShotApiRow[];
const mbbSquares = () => mbb.readFix<LeagueContextRow[]>('league_squares_2026.json');

const teamReads: number[] = [];
let inFlight = 0;
let maxInFlight = 0;
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (_s: number, lg: string) => (lg === 'nba' ? apiSeasonPlayerRows() : mbb.seasonPlayers(2026)),
    retrieveLeagueContextRows: async (_s: number, lg: string) => (lg === 'nba' ? nbaContext : [...mbb.leagueContext(2026), ...mbbSquares()]),
    retrieveCoverageRows: async () => mbb.coverage(),
    retrieveConferenceRows: async () => ({ teams: mbb.conferences(2026), groups: mbb.conferenceNames(2026) }),
    retrieveScheduleTeamRows: async () => mbb.scheduleTeams(2026),
    retrieveTeamShots: async (_s: number, teamId: number) => {
        teamReads.push(teamId);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        if (teamId === CELTICS) throw new Error('503');
        if (teamId === NETS) return netsShots;
        if (teamId === mbb.TEX) return mbb.texShots(2026);
        return [];
    },
}));

import NotFound from '../../src/pages/404.astro';
import { defaultScatterConference, withSeasonMembers, filterByConference } from '../../src/basketball/dashboards';
import { leagueSquaresFromRows } from '../../src/nba/adapters';
import { colourDiff } from '../../src/nba/charts/hexShotChart';
import { SQUARE_SIDE } from '../../src/nba/dashboard';
import { LEAGUE_PRIOR_ATTEMPTS, squarebinShots } from '../../src/nba/data/aggregate';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { prepareLeagueShots, TEAM_READS_AT_ONCE, type LeagueShotsParams } from '../../src/routes/basketball/leagueShots';
import { FLAGS } from '../../src/utils/features';

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });
beforeEach(() => { teamReads.length = 0; maxInFlight = 0; });

const locals = (on: boolean) => ({ preview: true, flagOverrides: { 'bball-league-shots': on } }) as unknown as App.Locals;
const fakeAstro = (path: string) =>
    ({ params: {}, url: new URL(`https://gameonpaper.com${path}`), locals: locals(true), cache: { set: () => {} }, response: { headers: new Headers() } }) as any;
async function prep(lg: 'nba' | 'mbb', path: string): Promise<LeagueShotsParams> {
    const r = await prepareLeagueShots(fakeAstro(path), lg);
    if ('unavailable' in r) throw new Error('unavailable');
    return r;
}

describe('leagueSquaresFromRows (sdv-db kind=square)', () => {
    test("the NBA's 2026 rows: every attempt kept, on GOP's lattice, so every Nets square is a league square holding at least the Nets' attempts", () => {
        const cells = leagueSquaresFromRows(nbaContext);
        expect(cells).toHaveLength(376);
        expect(cells.reduce((a, c) => a + c.attempts, 0)).toBe(219_159);
        expect(cells.some((c) => Object.is(c.x, -0) || Object.is(c.y, -0))).toBe(false);
        const league = new Map(cells.map((c) => [`${c.x},${c.y}`, c]));
        const nets = squarebinShots(netsShots, SQUARE_SIDE);
        expect(nets.length).toBeGreaterThan(150);
        for (const c of nets) expect(league.get(`${c.x},${c.y}`)?.attempts ?? -1, `${c.x},${c.y}`).toBeGreaterThanOrEqual(c.attempts);
    });
});

describe('/nba/shots', () => {
    test('all 30 teams, six reads at a time; the Nets coloured against the exact league squares; a failed read is that card only', async () => {
        const r = await prep('nba', '/nba/shots?season=2026');
        expect(r.teams).toHaveLength(30);
        expect(new Set(teamReads).size).toBe(30);
        expect(teamReads).toHaveLength(30);
        expect(maxInFlight).toBe(TEAM_READS_AT_ONCE);
        expect(r.teams.find((t) => t.team.team_id === CELTICS)!.cells).toBeNull();
        const nets = r.teams.find((t) => t.team.team_id === NETS)!;
        expect(nets.line.attempts).toBe(2000);
        const rows = new Map(nbaContext.filter((x) => x.kind === 'square').map((x) => [`${x.key1},${x.key2}`, x]));
        const own = new Map(squarebinShots(netsShots, SQUARE_SIDE).map((c) => [`${c.x / SQUARE_SIDE},${c.y / SQUARE_SIDE}`, c]));
        let exact = 0;
        for (const [i, j, attempts, diff] of nets.cells!) {
            const row = rows.get(`${i},${j}`)!;
            const c = own.get(`${i},${j}`)!;
            expect(attempts).toBe(c.attempts);
            if (row.attempts < LEAGUE_PRIOR_ATTEMPTS) continue;
            exact++;
            expect(diff).toBe(Math.round(colourDiff(c.makes, c.attempts, row.makes / row.attempts)! * 1000));
        }
        expect(exact).toBeGreaterThan(100);
        expect(r.cap).toBeGreaterThanOrEqual(2);
        expect(r.court).toBeUndefined();
    });
});

describe('/mbb/shots, one conference at a time', () => {
    test('?conference=sec reads the SEC members only, Texas with its real shots', async () => {
        const r = await prep('mbb', '/mbb/shots?season=2026&conference=sec');
        expect(r.conference).toBe('sec');
        const members = filterByConference(withSeasonMembers(teamsFromSeasonRows(mbb.seasonPlayers(2026), 2026, 'mbb'), mbb.conferences(2026), mbb.scheduleTeams(2026), 2026, 'mbb'), mbb.conferences(2026), 'sec');
        expect(members.length).toBe(16);
        expect([...teamReads].sort()).toEqual(members.map((t) => t.team_id).sort());
        const tex = r.teams.find((t) => t.team.team_id === mbb.TEX)!;
        expect(tex.cells!.length).toBeGreaterThan(100);
        expect(r.conferences!.length).toBeGreaterThan(30);
    });

    test("no ?conference: the scatter's computed default, never 'all'", async () => {
        const r = await prep('mbb', '/mbb/shots?season=2026');
        expect(r.conference).toBe(defaultScatterConference(mbb.seasonPlayers(2026), mbb.conferences(2026), 2026, 'mbb'));
        expect(teamReads.length).toBeLessThanOrEqual(18);
        const bogus = await prep('mbb', '/mbb/shots?season=2026&conference=all');
        expect(bogus.conference).toBe(r.conference);
    });
});

describe("the 'bball-league-shots' flag", () => {
    let container: AstroContainer;
    beforeAll(async () => {
        container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
        container.insertPageRoute('/404', NotFound);
    });
    test('is a preview flag', () => expect(FLAGS['bball-league-shots']).toBe('preview'));

    test('off: every league page is the site 404, before any read', async () => {
        for (const lg of ['nba', 'wnba', 'mbb', 'wbb']) {
            const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/${lg}/shots.astro`);
            const res = await container.renderToResponse(Page, { request: new Request(`https://gameonpaper.com/${lg}/shots`), locals: locals(false) });
            expect(res.status, lg).toBe(404);
        }
        expect(teamReads).toEqual([]);
    });

    test('on: the NBA page renders a card per team; the teams index links it only when on, and is otherwise unchanged', async () => {
        const { default: Page } = await import('../../src/pages/nba/shots.astro');
        const html = await container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/shots?season=2026'), locals: locals(true) });
        expect(html).toContain('Shot charts, 2025-26');
        expect(html).toContain('Shots unavailable right now.');
        const { default: Teams } = await import('../../src/pages/nba/teams.astro');
        const req = () => new Request('https://gameonpaper.com/nba/teams?season=2026');
        const on = await container.renderToString(Teams, { request: req(), locals: locals(true) });
        const off = await container.renderToString(Teams, { request: req(), locals: locals(false) });
        expect(off).not.toContain('teams-shots-link');
        const link = on.match(/<p class="small mt-2" id="teams-shots-link">.*?<\/p>/s)![0];
        expect(link).toContain('href="/nba/shots?season=2026"');
        expect(on.replace(link, '')).toBe(off);
    });
});
