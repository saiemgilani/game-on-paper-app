/**
 * The Data API read behind BB-G32's season context (behind 'bball-team-grid'): sdv-db's season team rates (BB-D3,
 * `team_season_rates`, split `all`) in the league's season schema (`nba_stats` / `wnba_stats`, keyed by the stats.nba.com /
 * stats.wnba.com team id; `mbb` / `wbb`, keyed by the ESPN id). One read of the whole league's season gives both sides'
 * season rates and the league average the four-factor accounting is priced against. Every rate is the producer's,
 * counted from possessions; the league average is their possession-weighted mean. Strict: an outage is never a team
 * with no season.
 */
import { retrieveRowsFrom } from './sdv';
import { NBA_READ_TIMEOUT_MS } from './nbaGames';
import { BASKETBALL } from '../basketball/config';
import { PRO_LEAGUES, leagueSource, type BasketballLeague } from '../utils/league';

/** The season products move once a day (16:00 UTC): the season pages' window. */
const TTL = 6 * 60 * 60;
/** One row a team: 30 NBA, 13-15 WNBA, ~365 D-I teams in college. A read at the cap is truncated, so it fails loud. */
const LIMIT = '1000';
const SELECT = 'team_id,games,poss,pts,efg_pct,tov_pct,orb_pct,ft_rate,off_rtg,def_rtg,pace';

/** A team's (or the league's) season rates, as fractions; ratings per 100 counted possessions. */
export interface SeasonRates {
    efg_pct: number | null; tov_pct: number | null; orb_pct: number | null; ft_rate: number | null
    off_rtg: number | null; def_rtg: number | null; pace: number | null
}

export interface TeamGridSeason {
    /** null: the producer has no row for the side (not built yet, or an unmapped franchise) */
    home: SeasonRates | null
    away: SeasonRates | null
    /** the possession-weighted league average; null with no rows. `ppp` is points per counted possession. */
    league: (SeasonRates & { ppp: number }) | null
}

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const RATE_KEYS = ['efg_pct', 'tov_pct', 'orb_pct', 'ft_rate', 'off_rtg', 'def_rtg', 'pace'] as const;
const rates = (r: Row): SeasonRates => Object.fromEntries(RATE_KEYS.map((k) => [k, num(r[k])])) as unknown as SeasonRates;

/** Both sides' rows (by the season tables' team id) and the league's possession-weighted mean of every rate. */
export function teamGridSeason(rows: readonly Row[], homeId: number | null, awayId: number | null): TeamGridSeason {
    const side = (id: number | null) => { const r = id == null ? undefined : rows.find((x) => num(x.team_id) === id); return r ? rates(r) : null; };
    const played = rows.filter((r) => (num(r.poss) ?? 0) > 0);
    const poss = played.reduce((s, r) => s + num(r.poss)!, 0);
    const mean = (k: (typeof RATE_KEYS)[number]) => {
        const w = played.filter((r) => num(r[k]) != null);
        const n = w.reduce((s, r) => s + num(r.poss)!, 0);
        return n > 0 ? w.reduce((s, r) => s + num(r[k])! * num(r.poss)!, 0) / n : null;
    };
    const league = poss > 0 ? { ...(Object.fromEntries(RATE_KEYS.map((k) => [k, mean(k)])) as unknown as SeasonRates), ppp: played.reduce((s, r) => s + (num(r.pts) ?? 0), 0) / poss } : null;
    return { home: side(homeId), away: side(awayId), league };
}

/** The season tables' team id of an ESPN team: the stats id for the pros (the league's team list), the ESPN id in college. */
export function seasonTeamId(league: BasketballLeague, espnId: number): number | null {
    return PRO_LEAGUES.includes(league) ? (BASKETBALL[league].teams.byEspnId(espnId)?.team_id ?? null) : espnId;
}

/** The readPanel signature: league, season, ESPN game id, home and away ESPN ids. */
export async function retrieveTeamGridSeason(league: BasketballLeague, season: number, _espnGameId: string, homeId: number, awayId: number): Promise<TeamGridSeason> {
    const rows = await retrieveRowsFrom<Row>(leagueSource(league), 'team_season_rates', { season: String(season), split: 'all', select: SELECT, limit: LIMIT }, TTL, true, NBA_READ_TIMEOUT_MS);
    if (rows.length >= Number(LIMIT)) throw new Error(`team_season_rates: ${rows.length} rows for ${league} ${season}, at the ${LIMIT} cap`);
    return teamGridSeason(rows, seasonTeamId(league, homeId), seasonTeamId(league, awayId));
}
