// test/nba/rows.ts
// The two SeasonPlayerRow sources the route and render tests share: the Nets dump mapped to
// API rows (PR 1's tests each inlined this mapping) and the real 2026 capture.
import { readFileSync } from 'node:fs';
import type { SeasonPlayerRow } from '../../src/resources/nbaShots';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/nba/${name}.json`, import.meta.url)).toString());

/** blazing's 2025-26 Nets dump (season_players.json) as shot_season_players rows, every player primary on the Nets. */
export function seasonPlayerRows(): SeasonPlayerRow[] {
    return (read('season_players') as any[]).map((p) => ({
        season: 2026, person_id: p.person_id, player_name: p.player_name, team_id: p.team_id, team_tricode: p.team_tricode,
        attempts: p.attempts, makes: p.makes, fg3a: p.fg3a, fg3m: p.fg3m, ra_attempts: 0, ra_makes: 0, mid_attempts: 0, mid_makes: 0,
        is_primary: true, n_teams: 1, has_stats: p.stats !== null, gp: p.stats?.gp ?? null, min_pg: p.stats?.min ?? null,
        fga_total: p.stats?.fga ?? null, fg_pct: p.stats?.fg_pct ?? null, efg_pct: p.stats?.efg_pct ?? null, ts_pct: p.stats?.ts_pct ?? null,
        usg_pct: p.stats?.usg_pct ?? null, pie: p.stats?.pie ?? null, pts_pg: p.stats?.pts_pg ?? null, fga_pg: p.stats?.fga_pg ?? null,
        min_total: p.stats?.min_total ?? null, headshot_href: null,
    }));
}

/** Every 2026 shot_season_players row from the live API (season_players_2026_api.json): 30 teams, traded players included. */
export function apiSeasonPlayerRows(): SeasonPlayerRow[] {
    return read('season_players_2026_api') as SeasonPlayerRow[];
}
