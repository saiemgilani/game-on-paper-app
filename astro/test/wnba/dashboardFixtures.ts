// Readers for the real WNBA dashboard captures (fixtures/wnba/dashboards, plan 2026-10-11-wnba-shots-gop Task 2).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { LeagueContextRow, PlayerGameRow, SeasonPlayerRow, ShotApiRow } from '../../src/resources/nbaShots';

export const SEA = 1611661328;
export function readFix<T>(name: string): T {
    const bytes = readFileSync(new URL(`../fixtures/wnba/dashboards/${name}`, import.meta.url));
    return JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
}
export const seasonPlayers = (season: 2003 | 2008 | 2025 | 2026) => readFix<SeasonPlayerRow[]>(`season_players_${season}.json`);
export const leagueContext = (season: 2003 | 2026) => readFix<LeagueContextRow[]>(`league_context_${season}.json`);
export const leagueShots2003 = () => readFix<(ShotApiRow & { person_id: number; team_id: number })[]>('shots_2003.json.gz');
export const seaShots = (season: 2008 | 2026) => readFix<ShotApiRow[]>(`sea_shots_${season}.json`);
export const playerGames2026 = () => readFix<PlayerGameRow[]>('player_games_2026.json.gz');
export const player2026Shots = () => readFix<ShotApiRow[]>('player_2026_shots.json');
export const player2026Seasons = () => readFix<{ season: number }[]>('player_2026_seasons.json');
export const player2003Games = () => readFix<PlayerGameRow[]>('player_2003_games.json');
export const leagueOrigin2026 = () => readFix<ShotApiRow[]>('shots_2026_origin.json');
const top = (rows: SeasonPlayerRow[]) => [...rows].sort((a, b) => b.attempts - a.attempts || a.person_id - b.person_id)[0];
/** The capture's rules, so no test hard-codes a person id it could get wrong. */
export const p26 = () => top(seasonPlayers(2026).filter((r) => r.team_id === SEA));
export const p03 = () => top(seasonPlayers(2003).filter((r) => !r.headshot_href && r.team_id !== 0));
