// Readers for the real WBB dashboard fixtures (fixtures/wbb/dashboards, plan 2026-10-11-wbb-shots-gop Task 2).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { LeagueContextRow, PlayerGameRow, SeasonPlayerRow, ShotApiRow } from '../../src/resources/nbaShots';

export const SC = 2579;
export type Season = 2019 | 2022 | 2026;
export function readFix<T>(name: string): T {
    // a path, not `new URL(…, import.meta.url)`: under `@vitest-environment jsdom` Vite rewrites that form to a web asset URL
    const bytes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/wbb/dashboards', name));
    return JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
}
export type FixtureShotRow = ShotApiRow & { season: number };
export interface ApiCoverageRow {
    season: number; source_shots: number; d1_shots: number; placed_shots: number; attributed_shots: number;
    placed_share: number; attributed_share: number; meets_floor: boolean | string;
}
export const fixtureShotRows = () => readFix<FixtureShotRow[]>('ncaa_fixture_shot_rows.json');
export const fixtureLeagueContext = () => readFix<LeagueContextRow[]>('ncaa_fixture_league_context.json');
export const seasonPlayers = (season: Season) => readFix<SeasonPlayerRow[]>(`season_players_${season}.json.gz`);
export const leagueContext = (season: Season) => readFix<LeagueContextRow[]>(`league_context_${season}.json`);
export const scShots = (season: Season) => readFix<(ShotApiRow & { person_id: number | null })[]>(`sc_shots_${season}.json`);
/** R-S14: New Orleans (2443) 2025-26 by team, the six lite columns: placed shots, no season-player row */
export const NOLA = 2443;
export const nolaShots2026 = () => readFix<ShotApiRow[]>('new_orleans_shots_2026.json');
export const player2026Shots = () => readFix<ShotApiRow[]>('player_2026_shots.json');
export const player2026Seasons = () => readFix<{ season: number }[]>('player_2026_seasons.json');
export const player2026Games = () => readFix<PlayerGameRow[]>('player_2026_games.json');
export const player2019Games = () => readFix<PlayerGameRow[]>('player_2019_games.json');
export const coverage = () => readFix<ApiCoverageRow[]>('coverage.json');
export const conferences = (season: Season | 2021) => readFix<{ team_id: string; conference_id: string }[]>(`conferences_${season}.json`);
export const scheduleTeams = (season: Season | 2021) => readFix<{ home_id: number | null; away_id: number | null }[]>(`schedule_teams_${season}.json`);
export const conferenceNames = (season: Season) => readFix<{ group_id: string; short_name: string }[]>(`conference_names_${season}.json`);
export const leadersLatest2026 = () => readFix<{ game_date: string }[]>('leaders_latest_2026.json');
export const leadersGames2026 = () => readFix<PlayerGameRow[]>('leaders_games_2026.json.gz');
export const windowRows = () => readFix<{ season: number; max42: number; max49: number; max56: number; at_end49: number; season_rows: number }[]>('leaders_window_rows.json');
export const postseasonGames = () => readFix<{ season: number; games: number }[]>('postseason_games.json');
export const placeholderCheck = () =>
    readFix<{ season: number; shots: number; top_share: number; top_x: number; top_y: number; max_team_game_share: number }[]>('placeholder_check.json');
export const unlinkedPrograms = () =>
    readFix<{ season: number; members_without_shots: number[] | null; unlinked: { name: string; shots: number }[] | null }[]>('unlinked_programs.json');
const top = (rows: SeasonPlayerRow[]) => [...rows].sort((a, b) => b.attempts - a.attempts || a.person_id - b.person_id)[0];
/** The capture's rules, so no test hard-codes a person id it could get wrong. */
export const p26 = () => top(seasonPlayers(2026).filter((r) => r.team_id === SC));
export const p19 = () => top(seasonPlayers(2019).filter((r) => r.team_id === SC));
