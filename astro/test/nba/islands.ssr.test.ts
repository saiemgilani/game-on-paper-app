// Server-render smoke: the Svelte islands compile and render with real fixture data.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { render } from 'svelte/server';
import Dashboard from '../../src/components/nba/Dashboard.svelte';
import PlayerExplorer from '../../src/components/nba/PlayerExplorer.svelte';
import { leagueContextFromRows } from '../../src/nba/adapters';
import { ZONES } from '../../src/nba/data/aggregate';
import { buildDashboard } from '../../src/nba/dashboard';
import { toLite } from '../../src/nba/data/shots';
import type { LeagueContextRow } from '../../src/resources/nbaShots';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());

function contextRows(): LeagueContextRow[] {
  const oracle = read('league_context');
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

const league = leagueContextFromRows(contextRows());
const shots = read('shots').map(toLite);
const games = Object.values(read('player_games') as Record<string, any[]>)[0];

test('Dashboard and PlayerExplorer server-render', () => {
  const dash = render(Dashboard, { props: { data: buildDashboard(shots, league), subject: 'Test' } }).body;
  expect(dash).toContain('id="nba-hex-panel"');
  expect(dash).not.toContain('undefined');
  const ex = render(PlayerExplorer, { props: { data: { shots, games, league, seasonFgPct: 0.45 }, subject: 'Test' } }).body;
  expect(ex).toContain('id="nba-hex-panel"');
  expect(ex).toContain('id="nba-games-panel"');
  expect(ex).not.toContain('undefined');
});
