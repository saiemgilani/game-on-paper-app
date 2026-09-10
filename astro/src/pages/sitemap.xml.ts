import type { APIRoute } from 'astro';
import { retrieveAllTeams } from '../utils/teams';
import { AVAILABLE_SEASONS, CURRENT_YEAR } from '../utils/constants';
import { LEAGUES, teamCategoriesFor } from '../utils/league';
import { LEADERBOARD_CATEGORIES, PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';
import { FLAGS } from '../utils/features';

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
    // This file is prerendered -- there is no viewer to hold a preview cookie --
    // so the NFL is advertised only once the 'nfl' flag is public; until then
    // every /nfl URL is a 404 and a sitemap must never list one.
    const nflPublic = FLAGS['nfl'] === 'on';
    const out: Entry[] = [
        { loc: '/', lastmod: today, changefreq: 'hourly', priority: '1.0' },
        ...(nflPublic ? [
            { loc: '/nfl', lastmod: today, changefreq: 'hourly', priority: '0.8' },
            { loc: '/nfl/charts/trends', lastmod: today, changefreq: 'weekly', priority: '0.5' },
            { loc: '/nfl/charts/builder', lastmod: today, changefreq: 'weekly', priority: '0.5' },
        ] : []),
        // Trailing slashes are load-bearing: prerendered routes 307 to the
        // slashed form, and advertising a redirect wastes the crawl budget this
        // file exists to protect. Verified per-URL against production.
        { loc: '/teams/', lastmod: today, changefreq: 'weekly', priority: '0.7' },
        { loc: '/glossary/', lastmod: today, changefreq: 'monthly', priority: '0.5' },
        { loc: '/methodology/', lastmod: today, changefreq: 'monthly', priority: '0.5' },
        { loc: '/data-sources/', lastmod: today, changefreq: 'monthly', priority: '0.4' },
        { loc: '/charts/trends', lastmod: today, changefreq: 'weekly', priority: '0.5' },
        { loc: '/charts/builder', lastmod: today, changefreq: 'weekly', priority: '0.5' },
        { loc: '/changelog/', lastmod: today, changefreq: 'weekly', priority: '0.3' },
    ];

    // the NFL mirrors the cfb season/leaderboard/team blocks below, prefixed;
    // its week schedules are listed too (the cfb ones are reached from /year/N)
    const nfl = LEAGUES.nfl;
    for (const year of nflPublic ? nfl.seasons : []) {
        const lastmod = seasonLastmod(year);
        const freq = year < CURRENT_YEAR ? 'yearly' : 'daily';
        out.push({ loc: `/nfl/year/${year}`, lastmod, changefreq: freq, priority: '0.6' });
        if (year !== CURRENT_YEAR) {
            out.push({ loc: `/nfl/year/${year}/teams`, lastmod, changefreq: freq, priority: '0.5' });
            out.push({ loc: `/nfl/year/${year}/players`, lastmod, changefreq: freq, priority: '0.5' });
            for (const c of teamCategoriesFor('nfl')) out.push({ loc: `/nfl/year/${year}/teams/${c}`, lastmod, changefreq: freq, priority: '0.6' });
            for (const c of PLAYER_LEADERBOARD_CATEGORIES) out.push({ loc: `/nfl/year/${year}/players/${c}`, lastmod, changefreq: freq, priority: '0.6' });
        }
        // week 18 arrived with the 17-game schedule in 2021
        const regWeeks = year <= 2020 ? 17 : nfl.regularSeasonWeeks;
        for (let w = 1; w <= regWeeks; w++) out.push({ loc: `/nfl/year/${year}/type/2/week/${w}`, lastmod, changefreq: freq, priority: '0.4' });
        for (let w = 1; w <= nfl.postseasonWeeks; w++) out.push({ loc: `/nfl/year/${year}/type/3/week/${w}`, lastmod, changefreq: freq, priority: '0.4' });
    }

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

    for (const league of (nflPublic ? ['cfb', 'nfl'] : ['cfb']) as readonly ('cfb' | 'nfl')[]) {
        const lp = (p: string) => (league === 'cfb' ? p : `/nfl${p}`);
        if (league === 'nfl') out.push({ loc: '/nfl/teams', lastmod: today, changefreq: 'weekly', priority: '0.7' });
        for (const team of retrieveAllTeams(league)) {
            out.push({
                loc: lp(`/team/${team.team_id}`),
                lastmod: today, changefreq: 'weekly', priority: '0.6',
            });
            // one entry per season the team actually played, so we never advertise a
            // team-season page that would render empty
            for (const year of team.seasons ?? []) {
                out.push({
                    loc: lp(`/year/${year}/team/${team.team_id}`),
                    lastmod: seasonLastmod(year),
                    changefreq: year < CURRENT_YEAR ? 'yearly' : 'daily',
                    priority: '0.5',
                });
            }
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
