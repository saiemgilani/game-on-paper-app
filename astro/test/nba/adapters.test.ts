// test/nba/adapters.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { leagueContextFromRows, playerGamesFromRows, playerSeasonsFromRows, shotsFromRows } from '../../src/nba/adapters';
import { ZONES } from '../../src/nba/data/aggregate';
import { HEX_RADIUS } from '../../src/nba/dashboard';
import type { LeagueContextRow, PlayerGameRow, SeasonPlayerRow } from '../../src/resources/nbaShots';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());
const oracle = read('league_context');

/** The table rows sdv-db's SELECT emits for the oracle's league context (the same contract). */
function contextRows(): LeagueContextRow[] {
  const rows: LeagueContextRow[] = [];
  const push = (kind: string, key1: number | null, key2: number | null, s: { attempts: number; makes: number }) =>
    rows.push({ season: 2026, kind, key1, key2, attempts: s.attempts, makes: s.makes, fg3a: 0, fg3m: 0 });
  for (const h of oracle.hexes) push('hex', h.i, h.j, h);
  for (const [z, s] of Object.entries(oracle.zones) as [string, { attempts: number; makes: number }][]) if (s.attempts) push('zone', ZONES.indexOf(z as never), null, s);
  for (const b of oracle.byFoot) if (b.attempts) push('distance_1ft', b.distance, null, b);
  for (const b of oracle.byBin) if (b.attempts) push('distance_3ft', b.distance / 3, null, b);
  for (const b of oracle.sides) for (const [k, side] of (['left', 'centre', 'right'] as const).entries()) if (b[side].attempts) push('side_3ft', b.distance / 3, k, b[side]);
  push('total', null, null, { attempts: 2000, makes: 890 });
  return rows;
}

test('league context rebuilt from rows equals blazing\'s on the same shots', () => {
  const ctx = leagueContextFromRows(contextRows());
  const dx = HEX_RADIUS * 2 * Math.sin(Math.PI / 3);
  const dy = HEX_RADIUS * 1.5;
  const key = (h: { x: number; y: number }) => `${h.x},${h.y}`;
  const want = new Map<string, any>(oracle.hexes.map((h: any) => [key({ x: (h.i + (h.j & 1) / 2) * dx || 0, y: h.j * dy || 0 }), h]));
  assert.equal(ctx.hexIndex.radius, HEX_RADIUS);
  assert.equal(ctx.hexIndex.hexes.length, oracle.hexes.length);
  for (const h of ctx.hexIndex.hexes) {
    const o = want.get(key(h));
    assert.ok(o, `unexpected hex ${key(h)}`);
    assert.equal(h.attempts, o.attempts);
    assert.equal(h.fgPct, o.makes / o.attempts);
  }
  assert.deepEqual(ctx.hexIndex.zones, oracle.zones);
  assert.deepEqual(ctx.byFoot, oracle.byFoot);
  assert.deepEqual(ctx.byBin, oracle.byBin);
  assert.deepEqual(ctx.sides, oracle.sides);
  assert.equal(ctx.fgPct, oracle.fgPct);
});

const playerRow = (over: Partial<SeasonPlayerRow>): SeasonPlayerRow => ({
  season: 2026, person_id: 1, player_name: 'A B', team_id: 1610612751, team_tricode: 'BKN',
  attempts: 100, makes: 50, fg3a: 20, fg3m: 8, ra_attempts: 30, ra_makes: 20, mid_attempts: 20, mid_makes: 8,
  is_primary: true, n_teams: 1, has_stats: true, gp: 60, min_pg: 30, fga_total: 100, fg_pct: 0.5, efg_pct: 0.54,
  ts_pct: 0.58, usg_pct: 0.2, pie: 0.1, pts_pg: 15, fga_pg: 12, min_total: 1800, headshot_href: null, ...over,
});

test('season players: the fixture rows reproduce blazing\'s seasonPlayers', () => {
  const want = read('season_players');
  const rows: SeasonPlayerRow[] = want.map((p: any) => playerRow({
    person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
    attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, has_stats: p.stats !== null,
    gp: p.stats?.gp ?? null, min_pg: p.stats?.min ?? null, fga_total: p.stats?.fga ?? null, fg_pct: p.stats?.fg_pct ?? null,
    efg_pct: p.stats?.efg_pct ?? null, ts_pct: p.stats?.ts_pct ?? null, usg_pct: p.stats?.usg_pct ?? null, pie: p.stats?.pie ?? null,
    pts_pg: p.stats?.pts_pg ?? null, fga_pg: p.stats?.fga_pg ?? null, min_total: p.stats?.min_total ?? null,
  }));
  assert.deepEqual(playerSeasonsFromRows(rows), want);
});

test('test_traded_player_sums_teams: league-wide sums the teams, primary first; a team view scopes attempts and flags all-teams', () => {
  const rows = [
    playerRow({ person_id: 7, team_id: 1610612751, team_tricode: 'BKN', attempts: 300, makes: 150, is_primary: true, n_teams: 2 }),
    playerRow({ person_id: 7, team_id: 1610612737, team_tricode: 'ATL', attempts: 100, makes: 40, is_primary: false, n_teams: 2 }),
    playerRow({ person_id: 8, attempts: 50, makes: 25 }),
  ];
  const league = playerSeasonsFromRows(rows);
  assert.deepEqual(league.map((p) => [p.person_id, p.attempts, p.team_tricode, p.statsScope]), [[7, 400, 'BKN', 'matching'], [8, 50, 'BKN', 'matching']]);
  const atl = playerSeasonsFromRows(rows, 1610612737);
  assert.deepEqual(atl.map((p) => [p.person_id, p.attempts, p.statsScope]), [[7, 100, 'all-teams']]);
  const bkn = playerSeasonsFromRows(rows, 1610612751);
  assert.deepEqual(bkn.map((p) => [p.person_id, p.attempts, p.statsScope]), [[7, 300, 'all-teams'], [8, 50, 'matching']]);
});

test('player games: date order, and null dates mean the per-game views are unavailable', () => {
  const want = read('player_games');
  const [pid, games] = Object.entries(want)[0] as [string, any[]];
  const rows: PlayerGameRow[] = games.map((g) => ({
    season: 2026, person_id: Number(pid), game_id: g.game_id, team_id: g.team_id, team_tricode: 'BKN',
    attempts: g.attempts, makes: g.makes, fg3a: g.fg3a, fg3m: g.fg3m,
    game_date: g.date, opponent_id: g.opponent_id, opponent: g.opponent, venue: g.venue, win: g.win,
  })).reverse(); // the API's order is not date order
  assert.deepEqual(playerGamesFromRows(rows), games);
  const broken = rows.map((r, i) => (i === 0 ? { ...r, game_date: null, opponent_id: null, opponent: null, venue: null, win: null } : r));
  assert.equal(playerGamesFromRows(broken), null, 'test_player_games_null_date_means_unavailable');
  assert.deepEqual(playerGamesFromRows([]), []);
});

test('shots: only the lite fields, as numbers', () => {
  const lite = shotsFromRows([{ game_id: '0022500031', x_legacy: -10, y_legacy: 20, shot_distance: 2, shot_value: 2, shot_result: 'Made' }]);
  assert.deepEqual(lite, [{ game_id: '0022500031', x_legacy: -10, y_legacy: 20, shot_distance: 2, shot_value: 2, shot_result: 'Made' }]);
});
