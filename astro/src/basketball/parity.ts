// Football features carried to basketball: the pregame "Players to Watch", the scoreboard's spice borders and the game
// page's SportsEvent JSON-LD. Pure, so each is tested without a render.
import { eventStatus, ORIGIN } from '../utils/seo';
import { SpiceLevel } from '../utils/misc';
import type { SeasonPlayerRow } from '../resources/nbaShots';
import type { BasketballLeague } from '../utils/league';

export interface WatchPlayer {
    personId: number;
    name: string;
    ptsPg: number;
    tsPct: number | null;
    usgPct: number | null;
    gp: number;
}

/**
 * Like football's Players to Watch (our numbers, not ESPN's leaders): a team's top scorers this season from the Data API's
 * season rows, among players with at least half the games of its most-used player, so a two-game cameo never leads. A
 * traded player counts only for his primary team (`is_primary`), so he is on one card and in one team's games cutoff.
 */
export function playersToWatch(rows: readonly SeasonPlayerRow[], teamId: number, n = 3): WatchPlayer[] {
    const mine = rows.filter((r) => r.team_id === teamId && r.is_primary && r.has_stats && r.pts_pg != null && (r.gp ?? 0) > 0);
    const most = Math.max(0, ...mine.map((r) => r.gp ?? 0));
    return mine
        .filter((r) => (r.gp ?? 0) * 2 >= most)
        .sort((a, b) => b.pts_pg! - a.pts_pg! || a.person_id - b.person_id)
        .slice(0, n)
        .map((r) => ({ personId: r.person_id, name: r.player_name, ptsPg: r.pts_pg!, tsPct: r.ts_pct, usgPct: r.usg_pct, gp: r.gp ?? 0 }));
}

export interface SpiceInput {
    /** ESPN status.type.state */
    state: string;
    period: number;
    /** seconds left in the period */
    clock: number;
    regulationPeriods: number;
    home: { score: number; rank?: number };
    away: { score: number; rank?: number };
}

/**
 * The football scoreboard's spice borders (GameThumb's calculateSpiceLevel), in basketball terms: a live game within two
 * possessions (6 points) in the last 5 minutes of regulation or in overtime is close-late (ranked-close-late when both are
 * ranked); a ranked team trailing an unranked one in the second half is a ranked upset. Anything else, or a blowout, is none.
 */
export function basketballSpice(g: SpiceInput): SpiceLevel {
    if (g.state !== 'in' || g.period < 1) return SpiceLevel.BELL;
    const margin = Math.abs(g.home.score - g.away.score);
    const late = g.period > g.regulationPeriods || (g.period === g.regulationPeriods && g.clock <= 300);
    const ranked = (r?: number) => r !== undefined && r < 26;
    if (late && margin <= 6) return ranked(g.home.rank) && ranked(g.away.rank) ? SpiceLevel.GHOST : SpiceLevel.SERRANO;
    const secondHalf = g.period > g.regulationPeriods / 2;
    const leader = g.home.score > g.away.score ? g.home : g.away.score > g.home.score ? g.away : null;
    const trailer = leader === g.home ? g.away : g.home;
    if (secondHalf && leader && !ranked(leader.rank) && ranked(trailer.rank) && margin <= 15) return SpiceLevel.CAYENNE;
    return SpiceLevel.BELL;
}

const ORGANIZER: Record<BasketballLeague, string> = { nba: 'NBA', wnba: 'WNBA', mbb: 'NCAA', wbb: 'NCAA' };

export interface BasketballEventSpec {
    league: BasketballLeague;
    /** the game page's path */
    path: string;
    date: string;
    description: string;
    venue: string | null;
    statusDetail: string | null;
    home: { name: string; href: string | null; score: number | null };
    away: { name: string; href: string | null; score: number | null };
}

/** utils/seo's sportsEventJsonLd for a basketball game: the one schema.org type Google shows sports rich results for. */
export function basketballEventJsonLd(g: BasketballEventSpec) {
    const url = new URL(g.path, ORIGIN).href;
    const team = (t: BasketballEventSpec['home']) => ({ '@type': 'SportsTeam', name: t.name, sport: 'Basketball', ...(t.href ? { url: new URL(t.href, ORIGIN).href } : {}) });
    const home = team(g.home);
    const away = team(g.away);
    const scored = g.home.score !== null && g.away.score !== null;
    return {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        '@id': url,
        url,
        name: `${away.name} at ${home.name}`,
        description: g.description,
        sport: 'Basketball',
        startDate: g.date,
        eventStatus: eventStatus(g.statusDetail ?? undefined),
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        ...(g.venue ? { location: { '@type': 'Place', name: g.venue } } : {}),
        homeTeam: home,
        awayTeam: away,
        competitor: [away, home],
        organizer: { '@type': 'SportsOrganization', name: ORGANIZER[g.league] },
        ...(scored
            ? { subjectOf: { '@type': 'Dataset', name: `${away.name} ${g.away.score}, ${home.name} ${g.home.score} advanced box score`, url, keywords: ['basketball', 'four factors', 'win probability', 'shot chart'] } }
            : {}),
    };
}
