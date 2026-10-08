import { leaguePath, type League } from './league';
import { cleanTextForTeam } from './misc';
import { playerPath } from './players';

/** What the header search returns, in the order its groups are shown. */
export const SEARCH_TYPES = ['team', 'player', 'game'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
export const MAX_HITS = 8;

/** One row of the Data API's `GET /v1/search`. Its `path` is ignored: GOP builds its own hrefs. */
export interface SearchRow {
    type: string;
    id: string | number;
    label: string;
    sublabel?: string | null;
    league: string;
    season?: number | null;
    score?: number;
}

export interface SearchHit { type: SearchType; id: string; label: string; sublabel: string; href: string }

export function hrefFor(row: { type: SearchType; id: string; league: League }): string {
    return row.type === 'player' ? playerPath(row.league, row.id) : leaguePath(row.league, `/${row.type}/${row.id}`);
}

/**
 * The query sent upstream, or null when there is nothing to send: trimmed and 2-64
 * characters. One-letter words are dropped, since the Data API answers 400 to them and
 * "texas a" on the way to "texas a&m" should still find Texas.
 */
export function searchQuery(raw: string | null): string | null {
    const q = (raw ?? '').trim();
    if (q.length < 2 || q.length > 64) return null;
    const kept = q.split(/\s+/).filter((t) => t.length >= 2).join(' ');
    return kept.length >= 2 ? kept : null;
}

const typeOrder = (t: string) => (SEARCH_TYPES as readonly string[]).indexOf(t);

/**
 * Upstream rows to the hits this viewer may follow: teams, then players, then games,
 * each group by score, capped at MAX_HITS. Players are dropped unless player pages are
 * enabled for the viewer, and NFL rows unless the NFL is: a link into a 404 namespace
 * is worse than no link.
 */
export function rankHits(rows: SearchRow[], opts: { players: boolean; nfl: boolean }): SearchHit[] {
    return rows
        .filter((r) => typeOrder(r.type) >= 0 && (r.league === 'cfb' || r.league === 'nfl')
            && /^\d{1,12}$/.test(String(r.id)) && !!r.label
            && (opts.players || r.type !== 'player') && (opts.nfl || r.league !== 'nfl'))
        .sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || (b.score ?? 0) - (a.score ?? 0))
        .slice(0, MAX_HITS)
        .map((r) => {
            const type = r.type as SearchType;
            const id = String(r.id);
            return {
                type,
                id,
                // a team's own name follows the meme list, as cleanField does everywhere else
                label: type === 'team' ? cleanTextForTeam(r.label, id) : r.label,
                // the site separates with slashes, not dots (docs/design-conventions.md §8)
                sublabel: (r.sublabel ?? '').replaceAll(' · ', ' / '),
                href: hrefFor({ type, id, league: r.league as League }),
            };
        });
}
