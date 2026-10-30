// astro/test/nba/byteIdentity.render.test.ts
// PR 0 (basketball generalization) gate: the rendered HTML of every /nba route state, snapshotted on 81dbaf1e before
// any code moved. A diff is a regression in the refactor; never regenerate these files in that PR.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer as svelteRenderer } from '@astrojs/svelte/container-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiSeasonPlayerRows, seasonPlayerRows } from './rows';

// A container render of eleven pages can exceed the 5 s default on a loaded host; a timeout must never read as a byte change.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const shots = read('shots') as any[];
const byPlayer = read('player_games') as Record<string, any[]>;
const oracle = read('league_context');
const PID = Number(Object.keys(byPlayer)[0]); // 1629008, a Net in seasonPlayerRows()
const proc = read('game_401766458_processor');
const api = read('game_401766458_api');
const board = read('scoreboard-20250115');
const otProc = read('game_401705127_processor'); // NY at PHI 2025-01-15, Final/OT (self-review on #324: no OT state was gated)

const contextRows = () => [
    ...oracle.hexes.map((h: any) => ({ season: 2026, kind: 'hex', key1: h.i, key2: h.j, attempts: h.attempts, makes: h.makes, fg3a: 0, fg3m: 0 })),
    { season: 2026, kind: 'total', key1: null, key2: null, attempts: 2000, makes: 890, fg3a: 0, fg3m: 0 },
];
const gameRow = (pid: number, g: any) => ({
    season: 2026, person_id: pid, game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN', attempts: g.attempts, makes: g.makes,
    fg3a: g.fg3a, fg3m: g.fg3m, game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
});
const lite = (s: any) => ({ game_id: s.game_id, x_legacy: s.x_legacy, y_legacy: s.y_legacy, shot_distance: s.shot_distance, shot_value: s.shot_value, shot_result: s.shot_result });
const state: { players: () => any[] } = { players: apiSeasonPlayerRows };

vi.mock('../../src/resources/nbaShots', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaShots')>()),
    retrieveSeasonPlayerRows: async () => state.players(),
    retrieveLeagueContextRows: async () => contextRows(),
    retrievePlayerShots: async (_s: number, id: number) => shots.filter((s) => s.person_id === id).map(lite),
    retrieveTeamShots: async (_s: number, teamId: number) => shots.filter((s) => s.team_id === teamId).map(lite),
    retrievePlayerGameRows: async (_s: number, id: number) => (byPlayer[String(id)] ?? []).map((g) => gameRow(id, g)),
    retrieveSeasonPlayerGameRows: async () => Object.entries(byPlayer).flatMap(([pid, gs]) => gs.map((g) => gameRow(Number(pid), g))),
    retrievePlayerSeasons: async () => [2025, 2026],
}));
const games = { schedule: vi.fn(), rows: vi.fn(), proc: vi.fn() };
vi.mock('../../src/resources/nbaGames', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/nbaGames')>()),
    retrieveNbaSchedule: (...a: unknown[]) => games.schedule(...a),
    retrieveNbaGameRows: (...a: unknown[]) => games.rows(...a),
    retrieveNbaProcessedGame: (...a: unknown[]) => games.proc(...a),
}));
const espn = { page: vi.fn(), summary: vi.fn(), day: vi.fn() };
vi.mock('../../src/resources/espn', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/espn')>()),
    retrieveGamePageGuarded: (...a: unknown[]) => espn.page(...a),
    retrieveGameSummary: (...a: unknown[]) => espn.summary(...a),
    getScoreboardForDay: (...a: unknown[]) => espn.day(...a),
}));

/** The astro/ checkout root: the container writes island `component-url`s as absolute paths, so strip it to keep the snapshots host-independent. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
/** The only bytes allowed to differ: the checkout root, random island uids and Astro's scoped-style ids. */
const normalize = (html: string) => html.replaceAll(ROOT, '<astro-root>').replace(/ uid="[^"]*"/g, ' uid=""').replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid-x');

let container: AstroContainer;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T16:00:00Z')); // the scoreboard picker max and the back-link "today" read the clock
    container = await AstroContainer.create({ renderers: await loadRenderers([svelteRenderer()]) });
});
afterAll(() => { vi.useRealTimers(); });
// Each test queues its own Once values (the scoreboard test sets its implementation inline); a queue left by a failed or
// timed-out test must not leak into the next one and show up as a false snapshot mismatch.
beforeEach(() => { for (const m of [...Object.values(games), ...Object.values(espn)]) m.mockReset(); });

async function page(path: string, url: string, params: Record<string, string> = {}) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/nba/${path}`);
    return normalize(await container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true } as App.Locals }));
}
const snap = (name: string) => `./__byte_identity__/${name}.html`;
const finalPage = { gameId: 401766458, gamepackageJSON: { header: proc.header } };
// D15: the pregame state renders a REAL scheduled-game capture (Step 0), never a final header flipped to scheduled.
const PREGAME_ID = 401898403;
const pregamePage = () => read(`pregame_${PREGAME_ID}`);
const withPlayers = async (rows: () => any[], fn: () => Promise<void>) => { state.players = rows; try { await fn(); } finally { state.players = apiSeasonPlayerRows; } };

describe('PR 0 byte-identity: every /nba route state', () => {
    test('home', () => withPlayers(seasonPlayerRows, async () => { await expect(await page('index.astro', '/nba?season=2026')).toMatchFileSnapshot(snap('home')); }));
    test('players', async () => { await expect(await page('players.astro', '/nba/players?season=2026')).toMatchFileSnapshot(snap('players')); });
    test('player', () => withPlayers(seasonPlayerRows, async () => {
        await expect(await page('players/[id].astro', `/nba/players/${PID}?season=2026`, { id: String(PID) })).toMatchFileSnapshot(snap('player'));
    }));
    test('teams', async () => { await expect(await page('teams.astro', '/nba/teams?season=2026')).toMatchFileSnapshot(snap('teams')); });
    test('team', async () => { await expect(await page('team/[id].astro', '/nba/team/1610612751?season=2026', { id: '1610612751' })).toMatchFileSnapshot(snap('team')); });
    test('scatter', async () => { await expect(await page('scatter.astro', '/nba/scatter?season=2026')).toMatchFileSnapshot(snap('scatter')); });
    test('leaders', () => withPlayers(seasonPlayerRows, async () => { await expect(await page('leaders.astro', '/nba/leaders?season=2026')).toMatchFileSnapshot(snap('leaders')); }));
    test('scoreboard (a dated past day)', async () => {
        espn.day.mockImplementation(async (_lg: string, d: string | null) => (d === null
            ? { day: '2026-10-12', events: [], degraded: false }
            : { day: '2025-01-15', events: board.content.sbData.events, degraded: false }));
        await expect(await page('scoreboard.astro', '/nba/scoreboard?date=2025-01-15')).toMatchFileSnapshot(snap('scoreboard'));
    });
    // Self-review on #324: the states below were captured the same way, on 7c8ac627 (pre-refactor source), on 2026-10-25.
    test('scoreboard: tonight (no ?date=, a fresh live read)', async () => {
        espn.day.mockResolvedValue({ day: '2025-01-15', events: board.content.sbData.events, degraded: false });
        await expect(await page('scoreboard.astro', '/nba/scoreboard')).toMatchFileSnapshot(snap('scoreboard-live'));
    });
    test('scoreboard: no ?date= and a degraded read (no trustworthy day)', async () => {
        espn.day.mockResolvedValue({ day: '2026-10-12', events: [], degraded: true });
        await expect(await page('scoreboard.astro', '/nba/scoreboard')).toMatchFileSnapshot(snap('scoreboard-degraded'));
    });
    test('scoreboard: a date before the first NBA day', async () => {
        await expect(await page('scoreboard.astro', '/nba/scoreboard?date=1990-01-01')).toMatchFileSnapshot(snap('scoreboard-bad-date'));
    });
    test('game: an overtime final, from the processor', async () => {
        games.schedule.mockResolvedValueOnce(null);
        espn.page.mockResolvedValueOnce({ page: { gameId: 401705127, gamepackageJSON: { header: otProc.header } }, regressed: false, fetchFailed: false });
        games.proc.mockResolvedValueOnce(otProc);
        await expect(await page('game/[id].astro', '/nba/game/401705127', { id: '401705127' })).toMatchFileSnapshot(snap('game-overtime'));
    });
    test('game: a final the Data API has not ingested, from the processor', async () => {
        games.schedule.mockResolvedValueOnce(null);
        espn.page.mockResolvedValueOnce({ page: finalPage, regressed: false, fetchFailed: false });
        games.proc.mockResolvedValueOnce(proc);
        await expect(await page('game/[id].astro', '/nba/game/401766458', { id: '401766458' })).toMatchFileSnapshot(snap('game-processor'));
    });
    test('game: an ingested final, from the Data API', async () => {
        games.schedule.mockResolvedValueOnce(api.schedule[0]);
        games.rows.mockResolvedValueOnce(api);
        await expect(await page('game/[id].astro', '/nba/game/401766458', { id: '401766458' })).toMatchFileSnapshot(snap('game-data-api'));
    });
    test('pregame (real scheduled capture, D15)', async () => {
        games.schedule.mockResolvedValueOnce(null);
        espn.page.mockResolvedValueOnce({ page: pregamePage(), regressed: false, fetchFailed: false });
        espn.summary.mockResolvedValueOnce(null);
        await expect(await page('game/[id].astro', `/nba/game/${PREGAME_ID}`, { id: String(PREGAME_ID) })).toMatchFileSnapshot(snap('pregame'));
    });
});
