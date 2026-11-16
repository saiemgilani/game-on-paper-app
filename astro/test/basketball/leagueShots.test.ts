// astro/test/basketball/leagueShots.test.ts
// BB-G16 ('bball-league-shots'): /<league>/shots, every team's square chart. Real captures: the NBA's and MBB's 2025-26
// `kind='square'` league rows (sdv-db #191), the 2026 season-player rows, sdv-db #221's `shot_team_context` for the Nets and
// for the 2026 SEC, and the team reads it replaces (the Nets' 6,933 and Texas's 2,101 regular-season 2026 shots), so the one read
// is proven cell for cell against the 30 it replaced. Only resources/nbaShots is mocked.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { quantile } from 'd3-array';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LeagueContextRow, ShotApiRow, TeamContextRow } from '../../src/resources/nbaShots';
import { apiSeasonPlayerRows } from '../nba/rows';
import * as mbb from '../mbb/dashboardFixtures';

vi.setConfig({ testTimeout: 60_000 });
const NETS = 1610612751;
const nbaFix = <T>(name: string): T => {
    const bytes = readFileSync(new URL(`../fixtures/nba/${name}`, import.meta.url));
    return JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
};
const nbaContext = nbaFix<LeagueContextRow[]>('league_context_squares_2026.json');
const netsSquares = nbaFix<TeamContextRow[]>('team_context_nets_2026.json');
const netsShots = nbaFix<ShotApiRow[]>('team_shots_nets_2026.json.gz');
const secSquares = mbb.readFix<TeamContextRow[]>('team_context_sec_2026.json.gz');
const mbbSquares = () => mbb.readFix<LeagueContextRow[]>('league_squares_2026.json');

/** every shot_team_context read: [league, conference_id] */
const teamReads: [string, string | undefined][] = [];
let failTeamRead = false;
vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async (_s: number, lg: string) => (lg === 'nba' ? apiSeasonPlayerRows() : mbb.seasonPlayers(2026)),
    retrieveLeagueContextRows: async (_s: number, lg: string) => (lg === 'nba' ? nbaContext : [...mbb.leagueContext(2026), ...mbbSquares()]),
    retrieveCoverageRows: async () => mbb.coverage(),
    retrieveConferenceRows: async () => ({ teams: mbb.conferences(2026), groups: mbb.conferenceNames(2026) }),
    retrieveScheduleTeamRows: async () => mbb.scheduleTeams(2026),
    retrieveTeamContextRows: async (_s: number, lg: string, conf?: string) => {
        teamReads.push([lg, conf]);
        if (failTeamRead) throw new Error('503');
        return lg === 'nba' ? netsSquares : conf === 'mbb:sec' ? secSquares : [];
    },
    retrieveTeamShots: async () => { throw new Error('the league page no longer reads team shots'); },
}));

import NotFound from '../../src/pages/404.astro';
import { defaultScatterConference, withSeasonMembers, filterByConference } from '../../src/basketball/dashboards';
import { courtFor, placeholderFor } from '../../src/basketball/config';
import { leagueContextFromRows, leagueSquaresFromRows, teamSquaresFromRows } from '../../src/nba/adapters';
import { colourDiff, squareCells, type SquareCell } from '../../src/nba/charts/hexShotChart';
import { SQUARE_SIDE } from '../../src/nba/dashboard';
import { binsVsLeague, LEAGUE_PRIOR_ATTEMPTS, onCourt, shootingLine, squareKey, squarebinShots, squaresVsLeague, zoneOf } from '../../src/nba/data/aggregate';
import { placeholderSplit } from '../../src/nba/data/placeholder';
import { teamsFromSeasonRows } from '../../src/nba/tables';
import { prepareLeagueShots, type LeagueShotsParams } from '../../src/routes/basketball/leagueShots';
import { FLAGS } from '../../src/utils/features';

// Every read is mocked: a live request from a test sends vitest.config's 'Bearer test' and counts as a failed auth
// against the Data API from this IP (429 lockout). A fetch here fails the file instead.
const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input instanceof Request ? input.url : input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });
beforeEach(() => { teamReads.length = 0; failTeamRead = false; });

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

/**
 * The cells the page drew from a team's own shots before #221 (placeholderSplit, then squaresVsLeague), and the squares where a
 * tie for the majority zone lets the table's lowest-index pick differ from GOP's first seen: the one known difference.
 */
function fromShots(shots: ShotApiRow[], lg: 'nba' | 'mbb', context: LeagueContextRow[]): { cells: SquareCell[]; ties: Set<string> } {
    const court = courtFor(lg, 2026);
    const { located } = placeholderSplit(shots, placeholderFor(lg, 2026));
    const squares = squaresVsLeague(located, leagueContextFromRows(context).hexIndex, SQUARE_SIDE, LEAGUE_PRIOR_ATTEMPTS, court, leagueSquaresFromRows(context));
    const zones = new Map<string, Map<string, number>>();
    for (const s of located.filter(onCourt)) {
        const k = squareKey(s.x_legacy, s.y_legacy, SQUARE_SIDE).map((v) => v || 0).join(',');
        const z = zones.get(k) ?? new Map<string, number>();
        z.set(zoneOf(s, court), (z.get(zoneOf(s, court)) ?? 0) + 1);
        zones.set(k, z);
    }
    const ties = new Set([...zones].filter(([, z]) => {
        const n = [...z.values()].sort((x, y) => y - x);
        return n.length > 1 && n[0] === n[1];
    }).map(([k]) => k));
    return { cells: squareCells(squares, SQUARE_SIDE), ties };
}

/** The page's cells equal the shots' cells; a cell may differ only in colour, only on a tied square. Returns those squares. */
function expectSameCells(page: SquareCell[], shots: { cells: SquareCell[]; ties: Set<string> }): string[] {
    const want = new Map(shots.cells.map((c) => [`${c[0]},${c[1]}`, c]));
    expect(page.map((c) => `${c[0]},${c[1]}`).sort()).toEqual([...want.keys()].sort());
    const differ: string[] = [];
    for (const c of page) {
        const k = `${c[0]},${c[1]}`;
        const w = want.get(k)!;
        expect(c[2], k).toBe(w[2]);
        if (c[3] !== w[3]) {
            expect(shots.ties.has(k), `${k}: ${c[3]} vs ${w[3]}`).toBe(true);
            differ.push(k);
        }
    }
    return differ;
}

describe('shot_team_context (sdv-db #221) against the team reads it replaces, real 2026 rows', () => {
    test('the Nets: the same squares, attempts and colours, and the same line, as their 6,933 shots', () => {
        const t = teamSquaresFromRows(netsSquares).get(NETS)!;
        expect(t.line).toEqual(shootingLine(netsShots));
        const cells = squareCells(binsVsLeague(t.squares, leagueContextFromRows(nbaContext).hexIndex, SQUARE_SIDE, LEAGUE_PRIOR_ATTEMPTS, leagueSquaresFromRows(nbaContext)), SQUARE_SIDE);
        expect(cells.length).toBeGreaterThan(200);
        expect(expectSameCells(cells, fromShots(netsShots, 'nba', nbaContext))).toEqual([]);
    });

    test('Texas: the same against its 2,101 shots (regular season and postseason, as the team read)', () => {
        const t = teamSquaresFromRows(secSquares).get(mbb.TEX)!;
        const tex = mbb.texShots(2026);
        expect(t.line).toEqual(shootingLine(tex));
        const context = [...mbb.leagueContext(2026), ...mbbSquares()];
        const cells = squareCells(binsVsLeague(t.squares, leagueContextFromRows(context).hexIndex, SQUARE_SIDE, LEAGUE_PRIOR_ATTEMPTS, leagueSquaresFromRows(context)), SQUARE_SIDE);
        expect(cells.length).toBeGreaterThan(100);
        expect(expectSameCells(cells, fromShots(tex, 'mbb', context))).toEqual([]);
    });
});

describe('/nba/shots', () => {
    test('all 30 teams from ONE read; the Nets coloured against the exact league squares; a team with no rows is an empty card', async () => {
        const r = await prep('nba', '/nba/shots?season=2026');
        expect(r.teams).toHaveLength(30);
        expect(teamReads).toEqual([['nba', undefined]]);
        const nets = r.teams.find((t) => t.team.team_id === NETS)!;
        expect(nets.line.attempts).toBe(6933);
        expect(r.teams.filter((t) => t.team.team_id !== NETS).every((t) => t.cells?.length === 0 && t.line.attempts === 0)).toBe(true);
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
        // the shared size scale: the 95th percentile of every drawn cell's attempts
        expect(r.cap).toBe(Math.max(2, Math.ceil(quantile(nets.cells!, 0.95, (c) => c[2])!)));
        expect(r.court).toBeUndefined();
    });

    test('a failed read: every card says so', async () => {
        failTeamRead = true;
        const r = await prep('nba', '/nba/shots?season=2026');
        expect(r.teams).toHaveLength(30);
        expect(r.teams.every((t) => t.cells === null)).toBe(true);
    });
});

describe('/mbb/shots, one conference at a time', () => {
    test("?conference=sec is one read of the SEC's conference_id; Texas from its real rows", async () => {
        const r = await prep('mbb', '/mbb/shots?season=2026&conference=sec');
        expect(r.conference).toBe('sec');
        expect(teamReads).toEqual([['mbb', 'mbb:sec']]);
        const members = filterByConference(withSeasonMembers(teamsFromSeasonRows(mbb.seasonPlayers(2026), 2026, 'mbb'), mbb.conferences(2026), mbb.scheduleTeams(2026), 2026, 'mbb'), mbb.conferences(2026), 'sec');
        expect(members.length).toBe(16);
        expect(r.teams.map((t) => t.team.team_id).sort()).toEqual(members.map((t) => t.team_id).sort());
        // every SEC member has rows in the table, so no card is empty
        expect(r.teams.every((t) => (t.cells?.length ?? 0) > 0)).toBe(true);
        expect(r.teams.find((t) => t.team.team_id === mbb.TEX)!.line.attempts).toBe(2101);
        expect(r.conferences!.length).toBeGreaterThan(30);
    });

    test("no ?conference: the scatter's computed default, never 'all'", async () => {
        const r = await prep('mbb', '/mbb/shots?season=2026');
        expect(r.conference).toBe(defaultScatterConference(mbb.seasonPlayers(2026), mbb.conferences(2026), 2026, 'mbb'));
        expect(teamReads).toEqual([['mbb', `mbb:${r.conference}`]]);
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
        const render = () => container.renderToString(Page, { request: new Request('https://gameonpaper.com/nba/shots?season=2026'), locals: locals(true) });
        const html = await render();
        expect(html).toContain('Shot charts, 2025-26');
        expect(html).not.toContain('Shots unavailable right now.');
        failTeamRead = true;
        expect(await render()).toContain('Shots unavailable right now.');
        failTeamRead = false;
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
