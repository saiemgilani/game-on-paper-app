/**
 * 'bball-share-card' (preview), G-R5: the basketball player and team pages' link previews, as basketball/shareCard.ts is
 * the game page's. The image is the API's 1200x630 card (python/share_card.py render_basketball_stats) at
 * `/<league>/players/<id>/card.png` and `/<league>/team/<id>/card.png` (routes/basketball/statCard.ts), drawn from the
 * body below. Every number on it is a producer column, formatted only (as the page formats it): the player's
 * shot_season_players row (the page's own season read) and the team's team_strength row (the season block's read),
 * with the producer's `_rank` and `_pct`. The site ranks and sums nothing here.
 */
import { BASKETBALL, seasonLabelFor } from './config';
import { dashboardScope } from './dashboards';
import { fmtDec, fmtInt, fmtPct } from '../nba/format';
import type { SeasonPlayerRow } from '../resources/nbaShots';
import type { TeamStrengthRow } from '../resources/teamSeason';
import { formatRank, generateMarginalString, ordinal } from '../utils/misc';
import { LEAGUES, leaguePath, teamLogoUrl, type BasketballLeague } from '../utils/league';

export type StatCardKind = 'players' | 'team';

export interface StatCardTile { value: string; label: string; rank: string | null }

/** The POST body python/app.py's basketball stats card route reads: strings only. */
export interface StatCardBody {
    stamp: string; title: string; subtitle: string | null
    /** absolute logo: the API fetches art only from this site and ESPN's CDN (python/app.py LOGO_HOSTS) */
    team: { id: string; abbr: string; color: string | null; logo: string }
    tiles: StatCardTile[]
    note: string | null
}

/** The team page's own rank text (TeamSeasonBlock rankPct): "#4, 71st pctl", "#T-4"; null when the producer has no rank. */
export function rankText(rank: number | null | undefined, pct: number | null | undefined): string | null {
    if (rank == null) return null;
    return pct == null ? `#${formatRank(rank)}` : `#${formatRank(rank)}, ${ordinal(Math.round(pct))} pctl`;
}

/** A stats team id's ESPN id, as the team page keys its logo (routes/basketball/team.ts); 0 when unknown. */
export function espnTeamId(league: BasketballLeague, season: number, teamId: number): number {
    return BASKETBALL[league].teams.inSeason(teamId, season)?.espn_id ?? (BASKETBALL[league].currentMembers ? teamId : 0);
}

function cardTeam(league: BasketballLeague, season: number, teamId: number, abbr: string) {
    const espnId = espnTeamId(league, season, teamId);
    const color = BASKETBALL[league].teams.inSeason(teamId, season)?.color?.replace('#', '') ?? null;
    return { id: String(espnId), abbr, color, logo: new URL(teamLogoUrl(league, espnId, false, season), 'https://gameonpaper.com').href };
}

const stamp = (league: BasketballLeague, season: number) => `${LEAGUES[league].shortName} / ${seasonLabelFor(league, season)} ${dashboardScope(league, season).noun}`;

/** His primary team's row (the percentages and their ranks are the same on every team row of his, sdv-db#225). */
export function playerRow(rows: SeasonPlayerRow[], personId: number): SeasonPlayerRow | undefined {
    const his = rows.filter((r) => r.person_id === personId);
    return his.find((r) => r.is_primary) ?? his[0];
}

export function playerCardBody(row: SeasonPlayerRow, league: BasketballLeague, season: number): StatCardBody {
    const parts = [row.team_tricode, row.gp != null ? `${fmtInt(row.gp)} GP` : null, row.min_pg != null ? `${fmtDec(row.min_pg)} MIN` : null];
    return {
        stamp: stamp(league, season),
        title: row.player_name,
        subtitle: parts.filter(Boolean).join(' / '),
        team: cardTeam(league, season, row.team_id, row.team_tricode),
        tiles: [
            ...(row.pts_pg != null ? [{ value: fmtDec(row.pts_pg), label: 'Points per game', rank: null }] : []),
            ...(row.ts_pct != null ? [{ value: fmtPct(row.ts_pct), label: 'TS%', rank: null }] : []),
            { value: fmtPct(row.efg_pct), label: 'eFG%', rank: rankText(row.efg_pct_rank, row.efg_pct_pct) },
            ...(row.fg3_pct != null ? [{ value: fmtPct(row.fg3_pct), label: '3P%', rank: rankText(row.fg3_pct_rank, row.fg3_pct_pct) }] : []),
        ],
        note: 'Ranks and percentiles: the producer\'s, over its attempt minimum',
    };
}

export function teamCardBody(row: TeamStrengthRow, league: BasketballLeague, season: number, team: { team_id: number; tricode: string; name: string }): StatCardBody {
    const net = (v: number | null) => (v == null ? 'n/a' : generateMarginalString(v, 1, 1));
    const rtg = (v: number | null) => (v == null ? 'n/a' : fmtDec(v, 1));
    return {
        stamp: stamp(league, season),
        title: team.name,
        subtitle: row.wins != null && row.losses != null ? `${team.tricode} / ${row.wins}-${row.losses}` : team.tricode,
        team: cardTeam(league, season, team.team_id, team.tricode),
        tiles: [
            { value: net(row.adj_net_rtg), label: 'Adj. net rating', rank: rankText(row.adj_net_rtg_rank, row.adj_net_rtg_pct) },
            { value: rtg(row.adj_off_rtg), label: 'Adj. offense', rank: rankText(row.adj_off_rtg_rank, row.adj_off_rtg_pct) },
            { value: rtg(row.adj_def_rtg), label: 'Adj. defense', rank: rankText(row.adj_def_rtg_rank, row.adj_def_rtg_pct) },
            { value: net(row.sos), label: 'Strength of schedule', rank: rankText(row.sos_rank, row.sos_pct) },
        ],
        note: 'Ratings per 100 possessions, adjusted for opponents; ranks are the producer\'s',
    };
}

/**
 * The og:image tags. The URL names the season, and a day bucket (`v`) so a platform that cached yesterday's card
 * fetches today's after the nightly; the card route holds it six hours, the season pages' own hold.
 */
export function statShareImage(kind: StatCardKind, league: BasketballLeague, id: number, season: number, subject: string, now = Date.now()): { url: string; alt: string } {
    const query = new URLSearchParams({ season: String(season), v: new Date(now).toISOString().slice(0, 10) });
    const what = kind === 'players' ? 'scoring and shooting, with league ranks' : 'record and adjusted ratings, with league ranks';
    return {
        url: `https://gameonpaper.com${leaguePath(league, `/${kind}/${id}`)}/card.png?${query}`,
        alt: `${subject}, ${seasonLabelFor(league, season)}: ${what}`,
    };
}
