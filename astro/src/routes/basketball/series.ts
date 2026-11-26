/**
 * Page-side steps of /<league>/series (a season's playoff series by round) and /<league>/series/<id> (one series), NBA and
 * WNBA, behind 'bball-series' (BB-G59). The rows are sdv-db's playoff_series_games / _teams / _players (sdv-py BB-D43,
 * sportsdataverse._common.playoff_series), in the ESPN-keyed game schema (BASKETBALL[league].gamesSource), so a game id is
 * the game page's. Every number is the producer's: the series score after each game, the team and player totals, the
 * per-game lines and the regular-season shift. The pages pick rows and order them; nothing is summed here (rule B6).
 * A failed read is the page's 503; an id that is not a series is the 404.
 */
import type { AstroGlobal } from 'astro';
import { BASKETBALL } from '../../basketball/config';
import { retrieveRowsFrom } from '../../resources/sdv';
import { NBA_READ_TIMEOUT_MS } from '../../resources/nbaGames';
import { isFeatureEnabled } from '../../utils/features';
import { LEAGUES, leaguePath } from '../../utils/league';
import type { ProLeague } from '../../utils/playoffPicture';
import { seasonCache, setCache, uncacheable } from './cache';

/** The series tables follow the nightly season products. */
const TTL = 6 * 60 * 60;
/** The first season sdv-db's playoff_series_games is built for (the ESPN schedule release's first postseason). */
export const SERIES_FIRST_SEASON: Record<ProLeague, number> = { nba: 2002, wnba: 2003 };

export interface SeriesGameRow {
    season: number;
    series_id: string;
    /** 1 first round .. 4 Finals; null where ESPN gives no round (older seasons) */
    round: number | null;
    round_code: string | null;
    round_name: string | null;
    game_number: number;
    game_id: number;
    game_date: string | null;
    completed: boolean | null;
    home_team_id: number;
    home_abbreviation: string | null;
    home_display_name: string | null;
    home_score: number | null;
    away_team_id: number;
    away_abbreviation: string | null;
    away_display_name: string | null;
    away_score: number | null;
    winner_team_id: number | null;
    /** game 1's home side */
    team_a_id: number;
    team_b_id: number;
    /** the series score after this game */
    team_a_wins: number;
    team_b_wins: number;
    series_games: number;
    decided: boolean | null;
    series_winner_team_id: number | null;
}

export interface SeriesTeamRow {
    team_id: number;
    opponent_team_id: number;
    team_abbreviation: string | null;
    games: number;
    wins: number;
    losses: number;
    pts: number;
    opp_pts: number;
    fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number;
    oreb: number; dreb: number; reb: number; ast: number; stl: number; blk: number; tov: number; pf: number;
}

/** the per-game stats the producer compares with the regular season */
export const SHIFT_STATS = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m'] as const;
export type ShiftStat = (typeof SHIFT_STATS)[number];

export type SeriesPlayerRow = {
    team_id: number;
    athlete_id: number;
    athlete_display_name: string | null;
    games: number;
    ts_pct: number | null;
    reg_games: number | null;
    reg_ts_pct: number | null;
    ts_pct_diff: number | null;
} & { [K in `${ShiftStat}_pg` | `reg_${ShiftStat}_pg` | `${ShiftStat}_pg_diff`]: number | null };

/** "2025-11-25": the season and the two ESPN team ids, lower first (the producer's key). */
const SERIES_ID = /^(\d{4})-(\d{1,9})-(\d{1,9})$/;

export function parseSeriesId(raw: string | undefined): { season: number; id: string } | null {
    const m = SERIES_ID.exec(raw ?? '');
    if (!m || Number(m[2]) >= Number(m[3])) return null;
    return { season: Number(m[1]), id: raw! };
}

export const seriesHref = (league: ProLeague, id: string) => leaguePath(league, `/series/${id}`);
export const seriesIndexHref = (league: ProLeague, season: number, current: number) =>
    leaguePath(league, '/series') + (season === current ? '' : `?season=${season}`);

/** The side with home court is team A; a side's display name and abbreviation from its first game row. */
export function seriesSide(games: SeriesGameRow[], teamId: number): { id: number; name: string; abbreviation: string } {
    const g = games[0];
    const home = g.home_team_id === teamId;
    return { id: teamId, name: (home ? g.home_display_name : g.away_display_name) ?? `Team ${teamId}`, abbreviation: (home ? g.home_abbreviation : g.away_abbreviation) ?? '' };
}

/**
 * The series as a headline, from its latest game row: "OKC wins 4-3", "BOS leads 2-1", "Tied 2-2", or "Game 1 ahead" before the
 * first final. `decided` is the series' own (the same on every row), so an earlier row is not a mid-series headline.
 */
export function seriesStatus(last: SeriesGameRow, a: { abbreviation: string }, b: { abbreviation: string }): string {
    const [wa, wb] = [last.team_a_wins, last.team_b_wins];
    if (wa === 0 && wb === 0) return 'Game 1 ahead';
    const hi = Math.max(wa, wb), lo = Math.min(wa, wb);
    if (wa === wb) return `Tied ${hi}-${lo}`;
    const leader = wa > wb ? a : b;
    return `${leader.abbreviation} ${last.decided ? 'wins' : 'leads'} ${hi}-${lo}`;
}

async function read<T>(league: ProLeague, table: string, query: Record<string, string>): Promise<T[]> {
    return retrieveRowsFrom<T>(BASKETBALL[league].gamesSource, table, query, TTL, true, NBA_READ_TIMEOUT_MS);
}

export interface SeriesParams {
    league: ProLeague;
    id: string;
    season: number;
    games: SeriesGameRow[];
    teams: SeriesTeamRow[];
    players: SeriesPlayerRow[];
    /** the page's ?spoilers=off: the head names the matchup and round but not the result */
    spoilerFree: boolean;
}

export type SeriesPrep = { notFound: true } | { unavailable: true } | SeriesParams;

export async function prepareSeries(Astro: AstroGlobal, league: ProLeague): Promise<SeriesPrep> {
    Astro.locals.league = league;
    const key = parseSeriesId(Astro.params.id);
    if (!isFeatureEnabled('bball-series', Astro.locals) || !key) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const q = { season: String(key.season), series_id: key.id };
    let games: SeriesGameRow[], teams: SeriesTeamRow[], players: SeriesPlayerRow[];
    try {
        [games, teams, players] = await Promise.all([
            read<SeriesGameRow>(league, 'playoff_series_games', { ...q, order: 'game_number', limit: '20' }),
            read<SeriesTeamRow>(league, 'playoff_series_teams', { ...q, limit: '2' }),
            read<SeriesPlayerRow>(league, 'playoff_series_players', { ...q, order: '-pts', limit: '80' }),
        ]);
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} series ${key.id}: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    if (games.length === 0) {
        uncacheable(Astro);
        return { notFound: true };
    }
    setCache(Astro, seasonCache(league));
    return { league, id: key.id, season: key.season, games, teams, players, spoilerFree: Astro.url.searchParams.get('spoilers') === 'off' };
}

export interface SeriesIndexEntry {
    id: string;
    round: number | null;
    roundName: string | null;
    /** the series' latest game row: its score, decided and winner */
    last: SeriesGameRow;
    a: ReturnType<typeof seriesSide>;
    b: ReturnType<typeof seriesSide>;
}

export interface SeriesIndexParams {
    league: ProLeague;
    season: number;
    seasons: number[];
    current: number;
    /** newest round first; a round's series in the order of their first game */
    rounds: { round: number | null; name: string | null; series: SeriesIndexEntry[] }[];
}

export type SeriesIndexPrep = { notFound: true } | { unavailable: true } | SeriesIndexParams;

/** The season's series from its game rows: each series' latest row, grouped by round, the latest round first (rows are only
 * picked, never summed). Series sort by their first game, so the rounds come out in the order they began. */
export function seriesIndex(rows: SeriesGameRow[]): SeriesIndexParams['rounds'] {
    const bySeries = new Map<string, SeriesGameRow[]>();
    for (const r of [...rows].sort((x, y) => x.game_number - y.game_number)) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), r]);
    const series = [...bySeries.values()]
        .sort((x, y) => (x[0].game_date ?? '').localeCompare(y[0].game_date ?? '') || x[0].series_id.localeCompare(y[0].series_id))
        .map((gs): SeriesIndexEntry => {
            const last = gs[gs.length - 1];
            return { id: last.series_id, round: last.round, roundName: last.round_name, last, a: seriesSide(gs, last.team_a_id), b: seriesSide(gs, last.team_b_id) };
        });
    // an older season has no round numbers: its rounds group by the headline's name
    const rounds = new Map<string, SeriesIndexEntry[]>();
    for (const e of series) {
        const k = e.round != null ? `r${e.round}` : `n${e.roundName ?? ''}`;
        rounds.set(k, [...(rounds.get(k) ?? []), e]);
    }
    return [...rounds.values()].reverse().map((list) => ({ round: list[0].round, name: list[0].roundName, series: list }));
}

export async function prepareSeriesIndex(Astro: AstroGlobal, league: ProLeague): Promise<SeriesIndexPrep> {
    Astro.locals.league = league;
    if (!isFeatureEnabled('bball-series', Astro.locals)) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const all = LEAGUES[league].seasons.filter((s) => s >= SERIES_FIRST_SEASON[league]);
    const current = all[all.length - 1];
    const asked = Number(Astro.url.searchParams.get('season'));
    let season = all.includes(asked) ? asked : current;
    const columns = 'season,series_id,round,round_code,round_name,game_number,game_id,game_date,completed,home_team_id,home_abbreviation,home_display_name,home_score,away_team_id,away_abbreviation,away_display_name,away_score,winner_team_id,team_a_id,team_b_id,team_a_wins,team_b_wins,series_games,decided,series_winner_team_id';
    let rows: SeriesGameRow[];
    try {
        const seasonRows = (s: number) => read<SeriesGameRow>(league, 'playoff_series_games', { season: String(s), select: columns, limit: '500' });
        rows = await seasonRows(season);
        // the bare index before this season's playoffs shows last season's, as the best-games board falls back
        if (rows.length === 0 && season === current && !all.includes(asked) && all.length > 1) {
            season = all[all.length - 2];
            rows = await seasonRows(season);
        }
    } catch (e: any) {
        console.error(`ERROR while loading the ${league} ${season} playoff series: ${e}, ${e?.stack}`);
        uncacheable(Astro);
        return { unavailable: true };
    }
    setCache(Astro, seasonCache(league));
    return { league, season, seasons: all, current, rounds: seriesIndex(rows) };
}
