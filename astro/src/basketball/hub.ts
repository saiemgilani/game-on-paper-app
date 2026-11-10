// BB-G47's league hub (/nba, /wnba, /mbb, /wbb behind 'bball-hub'): the pure parts, the market line a card prints and the page
// index. The route is routes/basketball/hub.ts, the template components/routes/BasketballHubRoute.astro.
import type { ESPNCompetition } from '../resources/espn';
import type { GameLineRow } from '../resources/gameLines';
import { BASKETBALL } from './config';
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
