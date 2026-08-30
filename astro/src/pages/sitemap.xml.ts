import type { APIRoute } from 'astro';
import { retrieveAllTeams } from '../utils/teams';
import { AVAILABLE_SEASONS, CURRENT_YEAR } from '../utils/constants';
import { LEADERBOARD_CATEGORIES, PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';

// Prerendered: this is built once at deploy time from local data (teams.json +
// the season list) and costs nothing to serve. Deliberately makes no network
// calls -- a sitemap that fetched schedules would itself become a load source
// every time a crawler asked for it.
export const prerender = true;

const ORIGIN = 'https://gameonpaper.com';

/**
 * `lastmod` is the whole point of this file.
 *
 * Googlebot was fetching 407 distinct game pages in 12 hours -- essentially all
 * cache misses, each costing a full model run -- because with no sitemap it
 * discovers by exhaustive crawling and re-crawls to test freshness. A finished
 * season cannot change, so pinning its pages to a date in the past tells Google
 * to stop re-fetching them. Note Crawl-delay in robots.txt does NOT apply to
 * Googlebot; it ignores that directive, so lastmod is the real control.
 */
function seasonLastmod(year: number): string {
    // seasons end in early January; anything before CURRENT_YEAR is frozen
    return year < CURRENT_YEAR ? `${year + 1}-01-15` : new Date().toISOString().slice(0, 10);
}

type Entry = { loc: string; lastmod: string; changefreq: string; priority: string };

function buildEntries(): Entry[] {
    const today = new Date().toISOString().slice(0, 10);
    const out: Entry[] = [
        { loc: '/', lastmod: today, changefreq: 'hourly', priority: '1.0' },
        // Trailing slashes are load-bearing: prerendered routes 307 to the
        // slashed form, and advertising a redirect wastes the crawl budget this
        // file exists to protect. Verified per-URL against production.
        { loc: '/teams/', lastmod: today, changefreq: 'weekly', priority: '0.7' },
        { loc: '/glossary/', lastmod: today, changefreq: 'monthly', priority: '0.5' },
        { loc: '/charts/trends', lastmod: today, changefreq: 'weekly', priority: '0.5' },
        { loc: '/charts/builder', lastmod: today, changefreq: 'weekly', priority: '0.5' },
        { loc: '/changelog/', lastmod: today, changefreq: 'weekly', priority: '0.3' },
    ];

    for (const year of AVAILABLE_SEASONS) {
        const lastmod = seasonLastmod(year);
        const freq = year < CURRENT_YEAR ? 'yearly' : 'daily';
        out.push({ loc: `/year/${year}`, lastmod, changefreq: freq, priority: '0.6' });
        // The leaderboard routes 302 CURRENT_YEAR to LAST_YEAR until the season has
        // data; a sitemap must never advertise a redirect.
        if (year === CURRENT_YEAR) continue;
        out.push({ loc: `/year/${year}/teams`, lastmod, changefreq: freq, priority: '0.5' });
        out.push({ loc: `/year/${year}/players`, lastmod, changefreq: freq, priority: '0.5' });
        // The per-category leaderboards are the pages meant to rank for "epa per
        // play"; until now only the bare /teams and /players hubs were listed.
        // SSR routes, so no trailing slash (the slash rule above is for prerendered ones).
        for (const c of LEADERBOARD_CATEGORIES) out.push({ loc: `/year/${year}/teams/${c}`, lastmod, changefreq: freq, priority: '0.6' });
        for (const c of PLAYER_LEADERBOARD_CATEGORIES) out.push({ loc: `/year/${year}/players/${c}`, lastmod, changefreq: freq, priority: '0.6' });
    }

    for (const team of retrieveAllTeams()) {
        out.push({
            loc: `/team/${team.team_id}`,
            lastmod: today, changefreq: 'weekly', priority: '0.6',
        });
        // one entry per season the team actually played, so we never advertise a
        // team-season page that would render empty
        for (const year of team.seasons ?? []) {
            out.push({
                loc: `/year/${year}/team/${team.team_id}`,
                lastmod: seasonLastmod(year),
                changefreq: year < CURRENT_YEAR ? 'yearly' : 'daily',
                priority: '0.5',
            });
        }
    }
    return out;
}

// Game pages are intentionally absent: their ids only exist upstream at ESPN, so
// enumerating them would mean fetching every week of every season at build time.
// Crawlers still reach them from the week pages, which are listed here.
export const GET: APIRoute = () => {
    const body =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        buildEntries().map((e) =>
            `  <url><loc>${ORIGIN}${e.loc}</loc><lastmod>${e.lastmod}</lastmod>` +
            `<changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`
        ).join('\n') +
        `\n</urlset>\n`;

    return new Response(body, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
};
