/**
 * The sitemap's shared pieces: the XML both files write, the season `lastmod`
 * rule, and the player sitemaps (`/sitemap-players-<league>-<season|career>-<page>.xml`)
 * that `/sitemap-index.xml` lists beside the prerendered `/sitemap.xml`.
 *
 * Pure: the pages under `src/pages/sitemap*` do the Data API reads
 * (`retrievePlayerSitemapIds`) and hand the ids here.
 */

import { CURRENT_YEAR } from './constants';
import { FLAGS } from './features';
import { LEAGUES, type League } from './league';
import { playerPath } from './players';

export const ORIGIN = 'https://gameonpaper.com';

/**
 * `lastmod` is the whole point of the sitemap.
 *
 * Googlebot was fetching 407 distinct game pages in 12 hours -- essentially all
 * cache misses, each costing a full model run -- because with no sitemap it
 * discovers by exhaustive crawling and re-crawls to test freshness. A finished
 * season cannot change, so pinning its pages to a date in the past tells Google
 * to stop re-fetching them. Note Crawl-delay in robots.txt does NOT apply to
 * Googlebot; it ignores that directive, so lastmod is the real control.
 */
export function seasonLastmod(year: number): string {
    // seasons end in early January; anything before CURRENT_YEAR is frozen
    return year < CURRENT_YEAR ? `${year + 1}-01-15` : new Date().toISOString().slice(0, 10);
}

export type SitemapEntry = { loc: string; lastmod: string; changefreq: string; priority: string };

export function urlsetXml(entries: SitemapEntry[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        entries.map((e) =>
            `  <url><loc>${ORIGIN}${e.loc}</loc><lastmod>${e.lastmod}</lastmod>` +
            `<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`
        ).join('\n') +
        `\n</urlset>\n`;
}

export function sitemapIndexXml(files: { loc: string; lastmod: string }[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        files.map((f) => `  <sitemap><loc>${ORIGIN}${f.loc}</loc><lastmod>${f.lastmod}</lastmod></sitemap>`).join('\n') +
        `\n</sitemapindex>\n`;
}

/**
 * URLs per player sitemap file. The protocol caps a file at 50,000 URLs and 50MB
 * uncompressed; a player entry is under 200 bytes, so 10,000 is ~2MB a file.
 * The biggest season today (CFB 2025) is ~4,500 players, so a season is one file
 * until it more than doubles; the career file is the one that pages.
 */
export const PLAYER_SITEMAP_PAGE_SIZE = 10_000;

/**
 * Which leagues get player sitemaps. A sitemap is for crawlers -- no viewer holds a
 * preview cookie, and the response is cached for everyone -- so it follows the
 * flags' PUBLIC state, exactly as `/sitemap.xml` does: no player URL while
 * 'player-pages' is not 'on', and no /nfl one while 'nfl' is not.
 */
export function playerSitemapLeagues(): League[] {
    if (FLAGS['player-pages'] !== 'on') return [];
    return FLAGS['nfl'] === 'on' ? ['cfb', 'nfl'] : ['cfb'];
}

/** One player sitemap file: a league, a season (or the career pages), a 1-based page. */
export type PlayerSitemapKey = { league: League; season: number | 'career'; page: number };

export function playerSitemapPath(k: PlayerSitemapKey): string {
    return `/sitemap-players-${k.league}-${k.season}-${k.page}.xml`;
}

/**
 * The `[key]` of `/sitemap-players-[key].xml`, or null for anything this file
 * never writes: an unpublished league, a season the league does not have, a
 * page `0` or `01` (one spelling per file, so no duplicate sitemap URLs).
 */
export function parsePlayerSitemapKey(key: string | undefined): PlayerSitemapKey | null {
    const m = /^(cfb|nfl)-(\d{4}|career)-([1-9]\d{0,5})$/.exec(key ?? '');
    if (!m) return null;
    const league = m[1] as League;
    if (!playerSitemapLeagues().includes(league)) return null;
    const season = m[2] === 'career' ? 'career' : Number(m[2]);
    if (season !== 'career' && !LEAGUES[league].seasons.includes(season)) return null;
    return { league, season, page: Number(m[3]) };
}

export const pageCount = (n: number, size = PLAYER_SITEMAP_PAGE_SIZE): number => Math.ceil(n / size);

/** Page `page` (1-based) of `items`, or null past the last page -- an empty list has none. */
export function pageSlice<T>(items: T[], page: number, size = PLAYER_SITEMAP_PAGE_SIZE): T[] | null {
    if (page < 1 || page > pageCount(items.length, size)) return null;
    return items.slice((page - 1) * size, page * size);
}

/**
 * A season's player pages, `/players/<espn id>?season=<year>` (league-prefixed).
 * The season is in the URL because it is in the page's canonical: each season is
 * its own page, and a finished one is frozen, so it gets that season's lastmod.
 */
export function seasonPlayerEntries(league: League, season: number, ids: string[]): SitemapEntry[] {
    const lastmod = seasonLastmod(season);
    const changefreq = season < CURRENT_YEAR ? 'yearly' : 'daily';
    return ids.map((id) => ({ loc: playerPath(league, id, season), lastmod, changefreq, priority: '0.4' }));
}

/**
 * The career pages, bare `/players/<espn id>`, once per player across every season.
 * A career moves only while the player does, so it carries his latest season's
 * lastmod: a retired player's is frozen like any finished season.
 */
export function careerPlayerEntries(league: League, idsBySeason: Map<number, string[]>): SitemapEntry[] {
    const latest = new Map<string, number>();
    for (const [season, ids] of idsBySeason) {
        for (const id of ids) latest.set(id, Math.max(season, latest.get(id) ?? season));
    }
    return [...latest.keys()].sort((a, b) => Number(a) - Number(b)).map((id) => {
        const season = latest.get(id)!;
        return {
            loc: playerPath(league, id),
            lastmod: seasonLastmod(season),
            changefreq: season < CURRENT_YEAR ? 'yearly' : 'weekly',
            priority: '0.5',
        };
    });
}

/** Every player sitemap file for a league, career pages first, then seasons newest first. */
export function playerSitemapFiles(league: League, idsBySeason: Map<number, string[]>): { loc: string; lastmod: string }[] {
    const today = new Date().toISOString().slice(0, 10);
    const files: { loc: string; lastmod: string }[] = [];
    const career = careerPlayerEntries(league, idsBySeason).length;
    for (let page = 1; page <= pageCount(career); page++) {
        files.push({ loc: playerSitemapPath({ league, season: 'career', page }), lastmod: today });
    }
    for (const season of [...idsBySeason.keys()].sort((a, b) => b - a)) {
        // a season's URL count is its id count: one URL per player
        for (let page = 1; page <= pageCount(idsBySeason.get(season)!.length); page++) {
            files.push({ loc: playerSitemapPath({ league, season, page }), lastmod: seasonLastmod(season) });
        }
    }
    return files;
}
