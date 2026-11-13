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
    /** finals: the winner's no-vig pregame win probability was under UPSET_WP (35%) */
    upset: boolean;
}

/** An upset is a final whose winner the market gave under this no-vig pregame win probability (Saiem, 2026-11-13). */
export const UPSET_WP = 0.35;

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
        upset: winner !== null && homeWp !== null && (winner === 'home' ? homeWp : 1 - homeWp) < UPSET_WP,
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
 * entry ('/') is the landing the hub replaces, so it is left out, and the featured team's page is listed last instead
 * (/nba/team/17 holds the roster and shot chart the landing had). It keys off `featuredTeam`, not the Header entry, so it
 * stays when #438 drops that entry. A page that is not in the Header (behind its own flag on
 * the stack: standings, bracketology, the Cup, best games) is added here with its flag when it reaches main.
 */
export function hubIndex(league: BasketballLeague): HubLink[] {
    const ft = BASKETBALL[league].featuredTeam;
    return [
        ...BASKETBALL[league].headerMenu.filter((m) => m.path !== '/').map((m) => ({ ...m, ...(BLURBS[m.path] ? { blurb: BLURBS[m.path] } : {}) })),
        ...(ft ? [{ label: ft.menuLabel, path: `/team/${ft.espnTeamId}`, blurb: `The ${ft.menuLabel} roster's shooting, with the team shot chart.` }] : []),
    ];
}
