/**
 * Page-side steps of /<league>/tournaments (a college season's tournaments, each with its teams' runs) and
 * /<league>/tournaments/<run_id> (one team's run), MBB and WBB, behind 'bball-series' (BB-G59). The rows are sdv-db's
 * tournament_run_games / _teams / _players (sdv-py BB-D43, sportsdataverse._common.tournament_runs), in the ESPN-keyed game
 * schema, so a game id is the game page's. A run is one team's games in one tournament: the NCAA tournament, a conference
 * tournament, the NIT / WNIT, CBI, Crown, WBIT ... Every number is the producer's; the pages pick rows and order them
 * (rule B6). A failed read is the 503; an id that is not a run is the 404.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { retrieveRowsFrom } from '../../resources/sdv';
import { NBA_READ_TIMEOUT_MS } from '../../resources/nbaGames';
import { isFeatureEnabled } from '../../utils/features';
import { LEAGUES, leaguePath } from '../../utils/league';
import { playerCache, seasonCache, setCache, uncacheable } from './cache';
import type { SeriesPlayerRow, SeriesTeamRow } from './series';

export type CollegeLeague = 'mbb' | 'wbb';

const TTL = 6 * 60 * 60;
/** The first season sdv-db's tournament_run_games is built for (the ESPN schedule release's first postseason). */
export const RUNS_FIRST_SEASON: Record<CollegeLeague, number> = { mbb: 2003, wbb: 2006 };

export interface RunGameRow {
    season: number;
    run_id: string;
    tournament_key: string;
    tournament_id: number | null;
    tournament_name: string | null;
    /** 'ncaa' | 'conference' | 'postseason' */
    tournament_kind: string;
    conference_id: number | null;
    round_name: string | null;
    game_number: number;
    game_id: number;
    game_date: string | null;
    completed: boolean | null;
    /** 'home' | 'away' | 'neutral' */
    home_away: string | null;
    team_id: number;
    team_abbreviation: string | null;
    team_display_name: string | null;
    team_score: number | null;
    opponent_team_id: number;
    opponent_abbreviation: string | null;
    opponent_display_name: string | null;
    opponent_score: number | null;
    winner_team_id: number | null;
    /** the run's record after this game */
    wins: number;
    losses: number;
    run_games: number;
    /** 'champion' | 'eliminated' | 'alive', the same on every row of the run */
    run_result: string;
}

export type RunTeamRow = Omit<SeriesTeamRow, 'opponent_team_id'>;

/** "2025-22-57": the season, the tournament key (ESPN's id, or an event-name slug) and the ESPN team id. */
const RUN_ID = /^(\d{4})-([a-z0-9-]{1,60})-(\d{1,9})$/;

export function parseRunId(raw: string | undefined): { season: number; id: string } | null {
    const m = RUN_ID.exec(raw ?? '');
    return m ? { season: Number(m[1]), id: raw! } : null;
}

export const runHref = (league: CollegeLeague, id: string) => leaguePath(league, `/tournaments/${id}`);
export const runsIndexHref = (league: CollegeLeague, season: number, current: number) =>
    leaguePath(league, '/tournaments') + (season === current ? '' : `?season=${season}`);

const KIND_ORDER: Record<string, number> = { ncaa: 0, postseason: 1, conference: 2 };
const RESULT_LABEL: Record<string, string> = { champion: 'Champion', eliminated: 'Out', alive: 'Alive' };

/** A run's headline from its latest row: "Champion, 6-0", "Out, 3-1", "Alive, 2-0". */
export function runStatus(last: RunGameRow): string {
    return `${RESULT_LABEL[last.run_result] ?? last.run_result}, ${last.wins}-${last.losses}`;
}

async function read<T>(league: CollegeLeague, table: string, query: Record<string, string>): Promise<T[]> {
    return retrieveRowsFrom<T>(BASKETBALL[league].gamesSource, table, query, TTL, true, NBA_READ_TIMEOUT_MS);
}

export interface RunParams {
    league: CollegeLeague;
    id: string;
    season: number;
    games: RunGameRow[];
    team: RunTeamRow | null;
    players: SeriesPlayerRow[];
    spoilerFree: boolean;
}

export type RunPrep = { notFound: true } | { unavailable: true } | RunParams;

export async function prepareRun(Astro: AstroGlobal, league: CollegeLeague): Promise<RunPrep> {
    Astro.locals.league = league;
    const key = parseRunId(Astro.params.id);
    if (!isFeatureEnabled('bball-series', Astro.locals) || !key) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const q = { season: String(key.season), run_id: key.id };
    let games: RunGameRow[], teams: RunTeamRow[], players: SeriesPlayerRow[];
    try {
        [games, teams, players] = await Promise.all([
            read<RunGameRow>(league, 'tournament_run_games', { ...q, order: 'game_number', limit: '20' }),
            read<RunTeamRow>(league, 'tournament_run_teams', { ...q, limit: '1' }),
            read<SeriesPlayerRow>(league, 'tournament_run_players', { ...q, order: '-pts', limit: '40' }),
        ]);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} run ${key.id}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    if (games.length === 0) {
        uncacheable(Astro);
        return { notFound: true };
    }
    // a run whose games are in but whose totals are not (a part-written load) is never held for the cache window
    if (teams.length === 0 || players.length === 0) uncacheable(Astro);
    else setCache(Astro, seasonCache(league));
    return { league, id: key.id, season: key.season, games, team: teams[0] ?? null, players, spoilerFree: Astro.url.searchParams.get('spoilers') === 'off' };
}

export interface TournamentEntry {
    key: string;
    name: string;
    kind: string;
    /** each run's latest row: the champion first, then by wins, then by name */
    runs: RunGameRow[];
}

/** The season's tournaments from the run rows: the NCAA tournament first, then the other postseason events, then the
 * conference tournaments, each by name; a tournament's runs are each run's latest row (rows are only picked, never summed). */
export function tournaments(rows: RunGameRow[]): TournamentEntry[] {
    const last = new Map<string, RunGameRow>();
    for (const r of rows) {
        const seen = last.get(r.run_id);
        if (!seen || r.game_number > seen.game_number) last.set(r.run_id, r);
    }
    const byKey = new Map<string, RunGameRow[]>();
    for (const r of last.values()) byKey.set(r.tournament_key, [...(byKey.get(r.tournament_key) ?? []), r]);
    const rank = (r: RunGameRow) => (r.run_result === 'champion' ? 0 : 1);
    return [...byKey.entries()]
        .map(([key, runs]) => ({
            key,
            name: runs[0].tournament_name ?? key,
            kind: runs[0].tournament_kind,
            runs: runs.sort((x, y) => rank(x) - rank(y) || y.wins - x.wins || x.losses - y.losses || (x.team_display_name ?? '').localeCompare(y.team_display_name ?? '')),
        }))
        .sort((x, y) => (KIND_ORDER[x.kind] ?? 9) - (KIND_ORDER[y.kind] ?? 9) || x.name.localeCompare(y.name));
}

export interface RunsIndexParams {
    league: CollegeLeague;
    season: number;
    seasons: number[];
    current: number;
    tournaments: TournamentEntry[];
    spoilerFree: boolean;
}

export type RunsIndexPrep = { notFound: true } | { unavailable: true } | RunsIndexParams;

const INDEX_COLUMNS = 'season,run_id,tournament_key,tournament_name,tournament_kind,game_number,team_id,team_abbreviation,team_display_name,wins,losses,run_result';

export async function prepareRunsIndex(Astro: AstroGlobal, league: CollegeLeague): Promise<RunsIndexPrep> {
    Astro.locals.league = league;
    if (!isFeatureEnabled('bball-series', Astro.locals)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const all = LEAGUES[league].seasons.filter((s) => s >= RUNS_FIRST_SEASON[league]);
    const current = all[all.length - 1];
    const asked = Number(Astro.url.searchParams.get('season'));
    let season = all.includes(asked) ? asked : current;
    let rows: RunGameRow[];
    let fellBack = false;
    try {
        // a men's season is ~850 rows (two per game)
        const seasonRows = (s: number) => read<RunGameRow>(league, 'tournament_run_games', { season: String(s), select: INDEX_COLUMNS, limit: '5000' });
        rows = await seasonRows(season);
        if (rows.length === 0 && season === current && !all.includes(asked) && all.length > 1) {
            season = all[all.length - 2];
            rows = await seasonRows(season);
            fellBack = true;
        }
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} tournament runs: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    setCache(Astro, fellBack ? playerCache(league) : seasonCache(league));
    return { league, season, seasons: all, current, tournaments: tournaments(rows), spoilerFree: Astro.url.searchParams.get('spoilers') === 'off' };
}
