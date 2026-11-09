import type { APIRoute } from 'astro';
import { retrieveAllTeams } from '../utils/teams';
import { AVAILABLE_SEASONS, CURRENT_YEAR, METRIC_YEAR } from '../utils/constants';
import { BASKETBALL_LEAGUES, LEAGUES, leaguePath, teamCategoriesFor } from '../utils/league';
import { LEADERBOARD_CATEGORIES, PLAYER_LEADERBOARD_CATEGORIES } from '../utils/seo';
import { FLAGS } from '../utils/features';
import { BASKETBALL, hasTeamPages } from '../basketball/config';
import { COACH_BOARD_SLUGS } from '../utils/coaches';
import { seasonLastmod, urlsetXml, type SitemapEntry } from '../utils/sitemap';

// Prerendered: this is built once at deploy time from local data (teams.json +
// the season list) and costs nothing to serve. Deliberately makes no network
// calls -- a sitemap that fetched schedules would itself become a load source
// every time a crawler asked for it. The pages that need the Data API's ids
// (players) get their own files, listed beside this one in /sitemap-index.xml.
// `lastmod` is the whole point of this file: see `seasonLastmod` in utils/sitemap.
export const prerender = true;

function buildEntries(): SitemapEntry[] {
    const today = new Date().toISOString().slice(0, 10);
    // This file is prerendered -- there is no viewer to hold a preview cookie --
    // so the NFL is advertised only once the 'nfl' flag is public; until then
    // every /nfl URL is a 404 and a sitemap must never list one.
    const nflPublic = FLAGS['nfl'] === 'on';
    // Same rule for each basketball league (the loop below) and the head-coach boards: a gated
    // route answers 404, so no URL is listed until its flag is public.
    // Player pages (`/players/<espn id>` and the /nfl twin, per season) are NOT
    // here: their ids are only in the Data API, which this prerendered file never
    // calls. They are the paginated `/sitemap-players-*.xml` files that
    // /sitemap-index.xml lists, under the same flag rule.
    const out: SitemapEntry[] = [
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
        { loc: '/rankings/', lastmod: today, changefreq: 'weekly', priority: '0.6' },
        ...(FLAGS['playoff-projection'] === 'on' ? [{ loc: '/playoff', lastmod: today, changefreq: 'daily', priority: '0.6' }] : []),
        { loc: '/standings/', lastmod: today, changefreq: 'weekly', priority: '0.6' },
        { loc: '/glossary/', lastmod: today, changefreq: 'monthly', priority: '0.5' },
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
        if (year != CURRENT_YEAR || (year == CURRENT_YEAR && CURRENT_YEAR == METRIC_YEAR)) {
            out.push({ loc: `/nfl/year/${year}`, lastmod, changefreq: freq, priority: '0.6' });
            out.push({ loc: `/nfl/year/${year}/teams`, lastmod, changefreq: freq, priority: '0.5' });
            out.push({ loc: `/nfl/year/${year}/players`, lastmod, changefreq: freq, priority: '0.5' });
            for (const c of teamCategoriesFor('nfl')) out.push({ loc: `/nfl/year/${year}/teams/${c}`, lastmod, changefreq: freq, priority: '0.6' });
            for (const c of PLAYER_LEADERBOARD_CATEGORIES) out.push({ loc: `/nfl/year/${year}/players/${c}`, lastmod, changefreq: freq, priority: '0.6' });
            out.push({ loc: `/nfl/year/${year}/coaches`, lastmod, changefreq: freq, priority: '0.5' });
            for (const b of COACH_BOARD_SLUGS) {
                out.push({ loc: `/nfl/year/${year}/coaches/${b}`, lastmod, changefreq: freq, priority: '0.6' });
            }
        }
        // week 18 arrived with the 17-game schedule in 2021
        const regWeeks = year <= 2020 ? 17 : nfl.regularSeasonWeeks;
        for (let w = 1; w <= regWeeks; w++) out.push({ loc: `/nfl/year/${year}/type/2/week/${w}`, lastmod, changefreq: freq, priority: '0.4' });
        for (let w = 1; w <= nfl.postseasonWeeks; w++) out.push({ loc: `/nfl/year/${year}/type/3/week/${w}`, lastmod, changefreq: freq, priority: '0.4' });
    }

    // Each basketball league's fixed pages (its landing plus the Header's pages) and team pages, once its flag is
    // public: a gated route answers 404 and a sitemap must never list one. Player pages are not listed: this file
    // makes no network calls, and the player ids are only in the API (see the player-pages note).
    for (const lg of BASKETBALL_LEAGUES) {
        if (FLAGS[lg] !== 'on') continue;
        const cfg = BASKETBALL[lg];
        for (const p of ['/', ...cfg.headerMenu.map((m) => m.path).filter((m) => m !== '/')]) {
            out.push({ loc: leaguePath(lg, p), lastmod: today, changefreq: p === '/scoreboard' ? 'hourly' : 'daily', priority: p === '/' ? '0.8' : '0.6' });
        }
        // D43/D47: a league with a membership table lists its current-season members (every URL a 200); others every team
        if (hasTeamPages(lg)) for (const id of cfg.currentMembers?.ids ?? cfg.teams.all.map((t) => t.team_id)) out.push({ loc: leaguePath(lg, `/team/${id}`), lastmod: today, changefreq: 'weekly', priority: '0.5' });
    }

    for (const year of AVAILABLE_SEASONS) {
        const lastmod = seasonLastmod(year);
        const freq = year < CURRENT_YEAR ? 'yearly' : 'daily';
        if (year != CURRENT_YEAR || (year == CURRENT_YEAR && CURRENT_YEAR == METRIC_YEAR)) {
            out.push({ loc: `/year/${year}`, lastmod, changefreq: freq, priority: '0.6' });
            out.push({ loc: `/year/${year}/teams`, lastmod, changefreq: freq, priority: '0.5' });
            out.push({ loc: `/year/${year}/players`, lastmod, changefreq: freq, priority: '0.5' });
            // The per-category leaderboards are the pages meant to rank for "epa per
            // play"; until now only the bare /teams and /players hubs were listed.
            // SSR routes, so no trailing slash (the slash rule above is for prerendered ones).
            for (const c of LEADERBOARD_CATEGORIES) out.push({ loc: `/year/${year}/teams/${c}`, lastmod, changefreq: freq, priority: '0.6' });
            for (const c of PLAYER_LEADERBOARD_CATEGORIES) out.push({ loc: `/year/${year}/players/${c}`, lastmod, changefreq: freq, priority: '0.6' });
            // Head-coach boards (pace, run/pass, ...): one per season, like the team
            // categories.
            out.push({ loc: `/year/${year}/coaches`, lastmod, changefreq: freq, priority: '0.5' });
            for (const b of COACH_BOARD_SLUGS) {
                out.push({ loc: `/year/${year}/coaches/${b}`, lastmod, changefreq: freq, priority: '0.6' });
            }
        }
    }

    for (const league of (nflPublic ? ['cfb', 'nfl'] : ['cfb']) as readonly ('cfb' | 'nfl')[]) {
        const lp = (p: string) => (league === 'cfb' ? p : `/nfl${p}`);
        if (league === 'nfl') out.push({ loc: '/nfl/teams', lastmod: today, changefreq: 'weekly', priority: '0.7' });
        // Coach careers pool every season, so they move whenever a season does.
        // /coaches itself redirects to the default board and is not listed.
        for (const b of COACH_BOARD_SLUGS) {
            out.push({ loc: lp(`/coaches/${b}`), lastmod: today, changefreq: 'weekly', priority: '0.6' });
        }
        for (const team of retrieveAllTeams(league)) {
            out.push({
                loc: lp(`/team/${team.team_id}`),
                lastmod: today, changefreq: 'weekly', priority: '0.6',
            });
            // one entry per season the team actually played, so we never advertise a
            // team-season page that would render empty
            for (const year of team.seasons ?? []) {
                if (year != CURRENT_YEAR || (year == CURRENT_YEAR && CURRENT_YEAR == METRIC_YEAR)) {
                    out.push({
                        loc: lp(`/year/${year}/team/${team.team_id}`),
                        lastmod: seasonLastmod(year),
                        changefreq: year < CURRENT_YEAR ? 'yearly' : 'daily',
                        priority: '0.5',
                    });
                }
            }
        }
    }
    return out;
}

// Game pages are intentionally absent: their ids only exist upstream at ESPN, so
// enumerating them would mean fetching every week of every season at build time.
// Crawlers still reach them from the week pages, which are listed here.
export const GET: APIRoute = () => {
    return new Response(urlsetXml(buildEntries()), {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
};
