// BB-G47's league hub (/nba, /wnba, /mbb, /wbb behind 'bball-hub'): the pure parts, the market line a card prints and the page
// index. The route is routes/basketball/hub.ts, the template components/routes/BasketballHubRoute.astro.
import type { ESPNCompetition } from '../resources/espn';
import type { GameLineRow } from '../resources/gameLines';
import { BASKETBALL } from './config';
import { playerHref, teamHrefFromEspn } from '../nba/links';
import type { BasketballLeague } from '../utils/league';

/** What one card prints under its teams. Every field is null when game_lines has no value for it. */
export interface HubLine {
    /** the favourite and the closing spread ('BOS -5.5', 'Pick'); the opening one when no book closed */
    spread: string | null;
    total: number | null;
    /** the market favourite and its no-vig win probability, a whole percent ('BOS 63%') */
    wp: string | null;
    /** finals: who covered the closing spread ('BOS covered', 'Push') */
    cover: string | null;
    /** finals: the market's underdog (no-vig WP under 50%) won */
    upset: boolean;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * A game_lines row as card copy. `abbr` names ESPN's home and away sides (every `_home` column is ESPN's home team);
 * `winner` is the final's winning side, null for a game not final (or a tie the feed should never send).
 */
export function hubLine(row: GameLineRow | undefined, abbr: { home: string; away: string }, winner: 'home' | 'away' | null): HubLine | null {
    if (!row) return null;
    const spread = num(row.spread_home_close) ?? num(row.spread_home_open);
    const homeWp = num(row.market_home_wp_close) ?? num(row.market_home_wp_open);
    const total = num(row.total_close) ?? num(row.total_open);
    const out: HubLine = {
        // negative = home favoured (betting convention)
        spread: spread === null ? null : spread === 0 ? 'Pick' : `${spread < 0 ? abbr.home : abbr.away} -${Math.abs(spread)}`,
        total,
        wp: homeWp === null ? null : homeWp >= 0.5 ? `${abbr.home} ${Math.round(homeWp * 100)}%` : `${abbr.away} ${Math.round((1 - homeWp) * 100)}%`,
        cover: winner === null || row.ats_result == null ? null : row.ats_result === 'push' ? 'Push' : `${abbr[row.ats_result]} covered`,
        upset: winner !== null && homeWp !== null && (winner === 'home' ? homeWp < 0.5 : homeWp > 0.5),
    };
    return out.spread === null && out.total === null && out.wp === null ? null : out;
}

/** The card's neutral-site and TV tags, from the scoreboard's own competition. */
export function hubTags(comp: Pick<ESPNCompetition, 'neutralSite' | 'broadcasts' | 'broadcast'>): string[] {
    const tv = [...new Set((comp.broadcasts ?? []).flatMap((b) => b.names ?? []))];
    return [...(comp.neutralSite ? ['Neutral site'] : []), ...(tv.length ? [`TV: ${tv.join(', ')}`] : comp.broadcast ? [`TV: ${comp.broadcast}`] : [])];
}

export interface HubLink { label: string; path: string; blurb?: string }

/** The index's words for the league pages it knows; a Header entry without one is listed by its label alone. */
const BLURBS: Record<string, string> = {
    '/scoreboard': 'Every game of any day, with win probability, four factors and shot charts.',
    '/players': "Every player's shooting for the season, with a shot chart for each.",
    '/teams': "Every team's shooting line, with a shot chart and roster for each.",
    '/scatter': 'Every player plotted on two shooting or volume numbers.',
    '/leaders': 'Who is shooting best over their last games, and who is most improved.',
};

/**
 * The hub's page index: the league's Header pages, so a page lands here when it lands in the Header. The NBA's featured-team
 * entry ('/') is the landing the hub replaces, so it is left out. A page that is not in the Header (behind its own flag on
 * the stack: standings, bracketology, the Cup, best games) is added here with its flag when it reaches main.
 */
export function hubIndex(league: BasketballLeague): HubLink[] {
    return BASKETBALL[league].headerMenu.filter((m) => m.path !== '/').map((m) => ({ ...m, ...(BLURBS[m.path] ? { blurb: BLURBS[m.path] } : {}) }));
}

/** BB-G48: the player_box columns a standout needs. */
export interface StandoutBoxRow {
    game_id: number | string; athlete_id: number | string; athlete_display_name: string;
    team_abbreviation: string | null; opponent_team_abbreviation: string | null; minutes: number | null;
    points: number | null; field_goals_made: number | null; field_goals_attempted: number | null;
    free_throws_made: number | null; free_throws_attempted: number | null;
    offensive_rebounds: number | null; defensive_rebounds: number | null; rebounds: number | null;
    assists: number | null; steals: number | null; blocks: number | null; turnovers: number | null; fouls: number | null;
}
export interface Standout { gameId: string; name: string; team: string; opponent: string; line: string; gameScore: number }

/** Game score, the box-score summary of one player's game (points plus weighted makes, misses, boards, stocks, fouls, turnovers). */
export function gameScore(r: StandoutBoxRow): number {
    const n = (v: number | null) => Number(v ?? 0);
    return n(r.points) + 0.4 * n(r.field_goals_made) - 0.7 * n(r.field_goals_attempted) - 0.4 * (n(r.free_throws_attempted) - n(r.free_throws_made))
        + 0.7 * n(r.offensive_rebounds) + 0.3 * n(r.defensive_rebounds) + n(r.steals) + 0.7 * n(r.assists) + 0.7 * n(r.blocks) - 0.4 * n(r.fouls) - n(r.turnovers);
}

/** The night's best `n` games by game score (ties: more points first), from a day's player_box rows; DNPs never count. */
export function standouts(rows: readonly StandoutBoxRow[], n = 5): Standout[] {
    return rows.filter((r) => Number(r.minutes ?? 0) > 0)
        .map((r) => ({ r, gs: gameScore(r) }))
        .sort((a, b) => b.gs - a.gs || Number(b.r.points ?? 0) - Number(a.r.points ?? 0))
        .slice(0, n)
        .map(({ r, gs }) => ({
            gameId: String(r.game_id), name: r.athlete_display_name, team: r.team_abbreviation ?? '', opponent: r.opponent_team_abbreviation ?? '',
            line: `${r.points ?? 0} PTS, ${r.rebounds ?? 0} REB, ${r.assists ?? 0} AST`,
            gameScore: Math.round(gs * 10) / 10,
        }));
}

/** SVG polyline points (a 100 x 24 box, the home side's win probability rising up) for a game's play-by-play WP; null under two plays. */
export function sparkline(homeWp: readonly (number | null)[], maxPoints = 80): string | null {
    const wp = homeWp.filter((v): v is number => v != null && Number.isFinite(v));
    if (wp.length < 2) return null;
    const step = Math.max(1, Math.ceil(wp.length / maxPoints));
    const idx = wp.map((_, i) => i).filter((i) => i % step === 0 || i === wp.length - 1);
    return idx.map((i) => `${(i / (wp.length - 1) * 100).toFixed(1)},${((1 - Math.min(1, Math.max(0, wp[i]))) * 24).toFixed(1)}`).join(' ');
}

/** BB-G49: a player_war row (the stats id and team id of the league's player pages: stats.nba.com for the pros, ESPN for college). */
export interface WarRow { player_id: number | string; player_name: string; team_id: number | string | null; war: number | null; min: number | null }
export interface WarLeader { name: string; team: string; war: number; href: string | null }

/** The WAR board as rows of copy, best first, each linked to its player page. A row without a WAR number is left out. */
export function warLeaders(league: BasketballLeague, rows: readonly WarRow[]): WarLeader[] {
    const cfg = BASKETBALL[league];
    const pages = cfg.headerMenu.some((m) => m.path === '/players');
    return rows.filter((r) => r.war != null && Number.isFinite(Number(r.war))).sort((a, b) => Number(b.war) - Number(a.war)).map((r) => ({
        name: r.player_name,
        team: cfg.teams.all.find((t) => t.team_id === Number(r.team_id))?.tricode ?? '',
        war: Math.round(Number(r.war) * 10) / 10,
        href: pages && Number.isFinite(Number(r.player_id)) ? playerHref(Number(r.player_id), '', league) : null,
    }));
}

/** BB-G49: the schedule columns "follow a team" reads (the college ones also carry ESPN's poll rank, 99 = unranked). */
export interface FollowScheduleRow {
    game_id: number | string; game_date: string; season_type: number | null; type_abbreviation: string | null; status_type_name: string | null; status_type_completed: boolean | null;
    home_id: number | string; away_id: number | string; home_abbreviation: string | null; away_abbreviation: string | null;
    home_score: number | null; away_score: number | null; home_current_rank?: number | null; away_current_rank?: number | null;
}
export interface FollowGame { id: string; date: string; opp: string; home: boolean; /** finals: 'W 112-104' */ result: string | null }
export interface FollowTeam { id: string; name: string; href: string | null; record: string | null; rank: string | null; last: FollowGame | null; next: FollowGame | null }

const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
/** a game that will not be played as listed is never "next" */
const NOT_NEXT = /POSTPONED|CANCELED|FORFEIT|SUSPENDED/;

/**
 * Every team the picker offers (the league's teams, college: the current D-I members), as of `today` (ESPN's day): its last final
 * on or before it, its next game on or after it (today's game while it is not final), its record and its rank. The record is the regular season for the pros (the standings') and every final for
 * college; the rank is the pros' place by win percentage, college's ESPN poll rank as of the latest regular-season row.
 */
export function followTeams(league: BasketballLeague, rows: readonly FollowScheduleRow[], today: string): FollowTeam[] {
    const cfg = BASKETBALL[league];
    const college = cfg.currentMembers != null;
    const members = new Set(cfg.currentMembers?.ids ?? []); // a college season is ~6,300 rows x 2 sides against 364 ids
    const known = (id: number) => (college ? members.has(id) : cfg.teams.byEspnId(id) != null);
    type Acc = { w: number; l: number; last: FollowGame | null; next: FollowGame | null; poll: number | null; nextPoll: number | null };
    const acc = new Map<number, Acc>();
    for (const g of [...rows].sort((a, b) => a.game_date.localeCompare(b.game_date))) {
        for (const home of [true, false]) {
            const id = Number(home ? g.home_id : g.away_id);
            if (!known(id)) continue;
            const a = acc.get(id) ?? { w: 0, l: 0, last: null, next: null, poll: null, nextPoll: null };
            acc.set(id, a);
            const opp = (home ? g.away_abbreviation : g.home_abbreviation) ?? '';
            const poll = Number(home ? g.home_current_rank : g.away_current_rank);
            // the NBA Cup final ('CC') is a regular-season game the standings leave out
            const regular = Number(g.season_type) === 2 && g.type_abbreviation !== 'CC';
            const final = g.status_type_completed === true && g.game_date <= today;
            if (final) {
                const us = Number(home ? g.home_score : g.away_score), them = Number(home ? g.away_score : g.home_score);
                if (regular || (college && Number(g.season_type) === 3)) { if (us > them) a.w++; else if (us < them) a.l++; }
                a.last = { id: String(g.game_id), date: g.game_date, opp, home, result: `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them}` };
                if (regular && Number.isFinite(poll)) a.poll = poll;
            } else if (!a.next && g.game_date >= today && !NOT_NEXT.test(g.status_type_name ?? '')) {
                a.next = { id: String(g.game_id), date: g.game_date, opp, home, result: null };
                if (regular && Number.isFinite(poll)) a.nextPoll = poll;
            }
        }
    }
    const pct = (a: Acc) => (a.w + a.l ? a.w / (a.w + a.l) : null);
    const pcts = [...acc.values()].map(pct).filter((p): p is number => p !== null);
    return [...acc.entries()].map(([id, a]) => {
        const p = pct(a);
        const poll = a.nextPoll ?? a.poll;
        const rank = college
            ? (poll !== null && poll >= 1 && poll <= 25 ? `No. ${poll} in the poll` : null)
            : (p === null ? null : `${ordinal(1 + pcts.filter((x) => x > p).length)} of ${pcts.length} by record`);
        return { id: String(id), name: cfg.teams.byEspnId(id)?.name ?? String(id), href: teamHrefFromEspn({ id }, league), record: a.w + a.l ? `${a.w}-${a.l}` : null, rank, last: a.last, next: a.next };
    }).sort((x, y) => x.name.localeCompare(y.name));
}
