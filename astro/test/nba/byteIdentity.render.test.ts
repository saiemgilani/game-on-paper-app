// astro/test/nba/byteIdentity.render.test.ts
// PR 0 (basketball generalization) gate: the rendered HTML of every /nba route state. A diff is a regression in the
// refactor, so these files are never regenerated from the branch. When main itself changes the NBA render (a header
// island, a dependency bump), re-capture them ON MAIN: a detached worktree of main, with only this harness and its
// fixtures copied in, then copy the snapshots back. First captured on 81dbaf1e, then re-captured on main 7e71f2d6.
// The Plausible markup alone was carried over from renders on main 06d88c0c after #419 changed the shared layout.
// player.html and team.html were re-captured on feat/basketball-square-bins, which changes the shot chart on purpose
// (square bins, the distance link): that diff is the shot-chart island and its Squares button, nothing else.
// game-*.html and pregame.html were re-captured on feat/basketball-parity: a SportsEvent JSON-LD script on each, and the
// pregame's Players to Watch card (with DarkModeLogos' CSS for its two team logos).
// home, leaders, player, players, scatter, team and teams .html were re-captured on feat/basketball-2026-27: the NBA lists
// 2026-27, so each season picker gains it and the 2025-26 pages these captures load carry ?season=2026 in canonical and links.
// Every capture was re-captured on feat/about-page: the shared footer gains "Meet the team on our About page." behind the
// 'about-page' preview flag (these renders hold the preview cookie). That one footer line is the whole diff.
// pregame.html was re-captured on feat/basketball-playoff-picture: its watch card's two dark logos move from nba/500-dark/<id>.png
// (a 404 for every NBA team) to ESPN's abbreviation (utils/league.ts NBA_LOGO_ABBR), nothing else.
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

// BB-G51's Shot profile reads the Data API with 'bball-shot-profile' on (preview): never from a test
vi.mock('../../src/resources/shotZones', async (orig) => ({ ...(await orig<typeof import('../../src/resources/shotZones')>()), retrievePlayerShotZones: async () => [], retrieveTeamPlayerShotZones: async () => [], retrieveTeamShotZones: async () => ({ zones: null, rates: [] }), retrieveSeasonFt: async () => null }));
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
// BB-G25's Situations section is forced off below; mocked anyway, so a run with the flag flipped on (the mutation check) never reads the Data API
vi.mock('../../src/resources/situational', async (orig) => ({
    ...(await orig<typeof import('../../src/resources/situational')>()),
    retrieveSituational: async () => ({ team: [], players: [], units: [], names: [] }),
    retrievePlayerSituational: async () => [],
}));
// 'bball-poe' is off here, so a shot quality read is a bug: it throws, the page would say "unavailable" and the snapshot breaks
vi.mock('../../src/resources/shotQuality', () => {
    const no = async () => { throw new Error('a shot quality read with bball-poe off'); };
    return { retrieveGameShotQuality: no, retrieveTeamShotQuality: no, retrievePlayerShotQuality: no };
});
// 'bball-impact' is off here too: an impact read throws and would put "unavailable" in the snapshot
vi.mock('../../src/resources/playerImpact', () => ({ retrievePlayerImpact: async () => { throw new Error('an impact read with bball-impact off'); } }));
// 'bball-player-on-off' (BB-G7) is off too: an on/off read throws and would put "unavailable" in the snapshot
vi.mock('../../src/resources/playerOnOff', () => ({ retrievePlayerOnOff: async () => { throw new Error('an on/off read with bball-player-on-off off'); } }));
// 'bball-play-styles' (BB-G17) is off too: a play-style read throws and would put "unavailable" in the snapshot
vi.mock('../../src/resources/playStyles', async (orig) => {
    const no = async () => { throw new Error('a play-style read with bball-play-styles off'); };
    return { ...(await orig<typeof import('../../src/resources/playStyles')>()), retrievePlayerPlayStyle: no, retrieveTeamPlayStyle: no };
});
// 'bball-war' is off here too: a WAR or EPV read throws and would put "unavailable" in the snapshot
vi.mock('../../src/resources/playerWar', async (orig) => {
    const no = async () => { throw new Error('a WAR or EPV read with bball-war off'); };
    return { ...(await orig<typeof import('../../src/resources/playerWar')>()), retrievePlayerWar: no, retrievePlayerEpv: no };
});
// 'bball-play-types' is off here too: a play-types read throws and would put "unavailable" in the snapshot
vi.mock('../../src/resources/playerPlayTypes', async (orig) => {
    const no = async () => { throw new Error('a play-types read with bball-play-types off'); };
    return { ...(await orig<typeof import('../../src/resources/playerPlayTypes')>()), retrievePlayerSynergy: no, retrievePlayerHustle: no, retrievePlayerMatchupRollup: no, retrievePlayerTopMatchups: no };
});
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

// 'bball-hub' (BB-G47) and BB-G52's lineup shot chart ('bball-lineup-shotchart') are off here, so these pages stay byte for byte main's; a test can turn more flags on or off
async function page(path: string, url: string, params: Record<string, string> = {}, flagOverrides?: Record<string, boolean>) {
    const { default: Page } = await import(/* @vite-ignore */ `../../src/pages/nba/${path}`);
    // BB-G23's Header entry (Standings) is behind 'bball-playoff-picture', BB-G30's (NBA Cup, November and December only)
    // behind 'bball-nba-cup' and BB-G10's scatter views behind 'bball-impact-scatter': all off here, so these pages stay byte
    // for byte main's on any day
    return normalize(await container.renderToString(Page, { params, request: new Request(`https://gameonpaper.com${url}`), locals: { preview: true, flagOverrides: { 'bball-hub': false, 'bball-lineup-shotchart': false, 'bball-playoff-picture': false, 'bball-best-games': false, 'bball-nba-cup': false, 'bball-rolling-movers': false, 'bball-team-season': false, 'bball-lineups': false, 'bball-on-off': false, 'bball-situational': false, 'bball-poe': false, 'bball-impact': false, 'bball-player-on-off': false, 'bball-play-styles': false, 'bball-war': false, 'bball-compare': false, 'bball-play-types': false, 'bball-career': false, 'bball-shot-profile': false, 'bball-current-impact': false, 'bball-game-set': false, 'bball-game-logs': false, 'bball-rank-neighbors': false, 'bball-coaches': false, 'bball-impact-box': false, 'bball-game-flow': false, 'bball-epv': false, 'bball-pregame-projection': false, 'bball-garbage-time': false, 'bball-pbp-controls': false, 'bball-game-leaders': false, 'bball-game-shooting': false, 'bball-shot-filters': false, 'bball-shift-chart': false, 'bball-team-grid': false, 'bball-situational-box': false, 'bball-player-box-views': false, 'bball-game-info': false, 'bball-props': false, 'bball-lines': false, 'bball-wp-lenses': false, 'bball-league-shots': false, 'bball-leaderboards-v2': false, 'bball-impact-scatter': false, 'bball-share-card': false, 'bball-series': false, ...flagOverrides } } as App.Locals }));
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
    test("game: 'bball-gei' off, a payload carrying excitement renders the processor snapshot byte for byte", async () => {
        games.schedule.mockResolvedValueOnce(null);
        espn.page.mockResolvedValueOnce({ page: finalPage, regressed: false, fetchFailed: false });
        games.proc.mockResolvedValueOnce({ ...proc, excitement: { gei: 3.54, lead_changes: 6, max_swing_pts: 9.34, completed: true } });
        await expect(await page('game/[id].astro', '/nba/game/401766458', { id: '401766458' }, { 'bball-gei': false })).toMatchFileSnapshot(snap('game-processor'));
    });
    test("game: 'bball-share-card' on changes the head's image tags and nothing else", async () => {
        games.schedule.mockResolvedValueOnce(null);
        espn.page.mockResolvedValueOnce({ page: finalPage, regressed: false, fetchFailed: false });
        games.proc.mockResolvedValueOnce(proc);
        const on = await page('game/[id].astro', '/nba/game/401766458', { id: '401766458' }, { 'bball-share-card': true });
        const card = 'https://gameonpaper.com/nba/game/401766458/card.png?state=final';
        expect(on).toContain(`<meta property="og:image" content="${card}"><meta property="og:image:alt" content="Atlanta 95 @ Orlando 120, final: win probability chart">`);
        expect(on).toContain(`<meta name="twitter:image" content="${card}">`);
        const social = 'https://gameonpaper.com/assets/img/social-card.png';
        const off = on.replace(/<meta property="og:image:alt" content="[^"]*">/, '').replaceAll(card, social);
        await expect(off).toMatchFileSnapshot(snap('game-processor'));
    });
    // G-R5: the player and team pages under 'bball-share-card': the head's image tags and a Share island, and nothing else
    const social = 'https://gameonpaper.com/assets/img/social-card.png';
    const shareIsland = /<astro-island uid="" component-url="<astro-root>\/src\/components\/game\/ShareButton\.svelte"[\s\S]*?<\/astro-island>/;
    // the client:load directive script rides before the page's first client:load island, which the Share button becomes
    const loadScript = /<script>\(function\(\)\{let e=async e=>\{await\(await e\(\)\)\(\)\};\(self\.Astro\|\|\(self\.Astro=\{\}\)\)\.load=e[^<]*<\/script>/;
    // and the snapshot file's line ends are the checkout's (toMatchFileSnapshot ignores them too)
    const withoutShare = (html: string) => html.replaceAll('\r\n', '\n').replace(shareIsland, '').replace(loadScript, '');
    const snapshotOf = (name: string) => readFileSync(new URL(snap(name), import.meta.url), 'utf8');
    test("player: 'bball-share-card' on adds the card as og:image and a Share button, and nothing else", () => withPlayers(seasonPlayerRows, async () => {
        const on = await page('players/[id].astro', `/nba/players/${PID}?season=2026`, { id: String(PID) }, { 'bball-share-card': true });
        const card = `https://gameonpaper.com/nba/players/${PID}/card.png?season=2026&amp;v=2026-10-12`;
        expect(on).toContain(`<meta property="og:image" content="${card}"><meta property="og:image:alt" content="`);
        expect(on).toContain(`<meta name="twitter:image" content="${card}">`);
        expect(on).toMatch(shareIsland);
        const off = on.replace(/<meta property="og:image:alt" content="[^"]*">/, '').replaceAll(card, social);
        expect(withoutShare(off)).toBe(withoutShare(snapshotOf('player')));
    }));
    test("team: 'bball-share-card' on adds the card as og:image and a Share button, and nothing else", async () => {
        const on = await page('team/[id].astro', '/nba/team/1610612751?season=2026', { id: '1610612751' }, { 'bball-share-card': true });
        const card = 'https://gameonpaper.com/nba/team/1610612751/card.png?season=2026&amp;v=2026-10-12';
        expect(on).toContain(`<meta property="og:image" content="${card}"><meta property="og:image:alt" content="Brooklyn Nets, 2025-26: record and adjusted ratings, with league ranks">`);
        expect(on).toMatch(shareIsland);
        const off = on.replace(/<meta property="og:image:alt" content="[^"]*">/, '').replaceAll(card, social);
        expect(withoutShare(off)).toBe(withoutShare(snapshotOf('team')));
    });
    // the #470 stack merge left four copies of the season block on the team page (one per stacked branch); one, with every flag's props
    test("team: 'bball-team-season' on renders the season block once", async () => {
        const on = await page('team/[id].astro', '/nba/team/1610612751?season=2026', { id: '1610612751' }, { 'bball-team-season': true });
        expect(on.match(/<section id="season"/g)).toHaveLength(1);
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
