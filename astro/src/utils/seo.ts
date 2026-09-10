/**
 * Structured-data builders. Pure functions returning schema.org objects, so
 * every page emits JSON-LD from one place and the tests can assert the shape
 * without rendering a page.
 *
 * Why this exists: measured 2026-08-29, the site carried ZERO structured data,
 * and the leaderboard pages that should rank for "cfb epa per play" did not
 * contain the words "EPA", "expected points" or "per play" anywhere in their
 * visible text. Google cannot match a query to a page that never says it.
 */

import type { PageBreadcrumb } from "../layouts/GenericPage.astro";
import { leaguePath, type League } from "./league";

export const ORIGIN = 'https://gameonpaper.com';

/** the sport noun the copy uses; cfb is the historical default so existing text is unchanged */
const sportNoun = (league?: League) => (league === 'nfl' ? 'NFL' : 'college football');

export function breadcrumbListJsonLd(crumbs: PageBreadcrumb[]) {
    const items = crumbs.filter((c) => c.url);
    if (items.length === 0) return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((c, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: c.title,
            item: new URL(c.url as string, ORIGIN).href,
        })),
    };
}

export interface Term { term: string; definition: string; source?: string }

/** The glossary as a DefinedTermSet -- the featured-snippet shape for "what is EPA". */
export function definedTermSetJsonLd(terms: Term[], pageUrl: string) {
    const url = new URL(pageUrl, ORIGIN).href;
    return {
        '@context': 'https://schema.org',
        '@type': 'DefinedTermSet',
        '@id': url,
        name: 'College Football Advanced Stats Glossary',
        url,
        hasDefinedTerm: terms.map((t) => ({
            '@type': 'DefinedTerm',
            name: t.term,
            // definitions are authored HTML (links, a table); structured data wants text
            description: t.definition.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            inDefinedTermSet: url,
        })),
    };
}

export interface DatasetSpec {
    name: string;
    description: string;
    url: string;
    season: number;
    variables: string[];
    league?: League;
}

/** A season leaderboard as a Dataset so the table is discoverable as data, not just a page. */
export function datasetJsonLd(spec: DatasetSpec) {
    const url = new URL(spec.url, ORIGIN).href;
    return {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: spec.name,
        description: spec.description,
        url,
        temporalCoverage: `${spec.season}`,
        keywords: [sportNoun(spec.league), 'EPA', 'expected points added', 'EPA per play', 'success rate', 'advanced stats'],
        creator: { '@type': 'Organization', name: 'Game on Paper', url: ORIGIN },
        isAccessibleForFree: true,
        variableMeasured: spec.variables.map((v) => ({ '@type': 'PropertyValue', name: v })),
    };
}

export interface GameSpec {
    id: string | number;
    /** which league's URL space and copy; cfb when absent */
    league?: League;
    /** rendered (lowercased) names, as the site shows them */
    away: string;
    home: string;
    /** schema.org names -- the real display names, never the lowercased slug */
    awayName?: string;
    homeName?: string;
    awayId?: string | number;
    homeId?: string | number;
    awayScore?: string | number;
    homeScore?: string | number;
    /** ISO kickoff */
    date: string;
    season: number;
    week?: number;
    /** ESPN gameNote, e.g. "Peach Bowl" -- replaces "Week N" when present */
    note?: string;
    neutralSite?: boolean;
    /** final or in progress: scores are meaningful */
    hasScore: boolean;
    /** ESPN status description ("Final", "Postponed", "Canceled") */
    statusDescription?: string;
}

/**
 * schema.org EventStatusType has no "completed" or "in progress" value -- a played
 * game is still EventScheduled. Only cancellations and postponements differ.
 */
export function eventStatus(statusDescription?: string): string {
    const s = (statusDescription ?? '').toLowerCase();
    if (s.includes('cancel')) return 'https://schema.org/EventCancelled';
    if (s.includes('postpone')) return 'https://schema.org/EventPostponed';
    return 'https://schema.org/EventScheduled';
}

/** "Week 3 2025" or "Peach Bowl 2025" -- what the page is about beyond the two teams. */
export function gameContext(g: Pick<GameSpec, 'season' | 'week' | 'note'>): string {
    const label = g.note?.trim() || (g.week ? `Week ${g.week}` : '');
    if (!label) return `${g.season}`;
    // an ESPN note can already carry the year ("2025 CFP Semifinal"); don't say it twice
    return label.includes(`${g.season}`) ? label : `${label} ${g.season}`;
}

export function gameTitle(g: GameSpec): string {
    const matchup = g.hasScore ? `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}` : `${g.away} vs ${g.home}`;
    const what = g.hasScore ? 'EPA & advanced box score' : 'preview: win probability & EPA matchup';
    return `${matchup} | ${gameContext(g)} ${what} | Game on Paper`;
}

export function gameDescription(g: GameSpec): string {
    const when = new Date(g.date);
    const day = isNaN(when.getTime()) ? '' : ` on ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}`;
    const sport = sportNoun(g.league);
    if (g.hasScore) {
        return `${g.away} ${g.awayScore}, ${g.home} ${g.homeScore}${day}: ${sport} advanced box score with EPA per play, success rate, explosiveness, win probability chart, drives and every play.`;
    }
    return `${g.away} vs ${g.home}${day}: ${sport} matchup preview with win probability, EPA per play, success rate and explosiveness for both teams, plus series history.`;
}

/** A game as a SportsEvent -- the only schema.org type Google shows sports rich results for. */
export function sportsEventJsonLd(g: GameSpec) {
    const team = (name: string | undefined, fallback: string, id: string | number | undefined) => ({
        '@type': 'SportsTeam',
        name: name || fallback,
        sport: 'American football',
        ...(id != null ? { url: new URL(leaguePath(g.league, `/team/${id}`), ORIGIN).href } : {}),
    });
    const url = new URL(leaguePath(g.league, `/game/${g.id}`), ORIGIN).href;
    const home = team(g.homeName, g.home, g.homeId);
    const away = team(g.awayName, g.away, g.awayId);
    return {
        '@context': 'https://schema.org',
        '@type': 'SportsEvent',
        '@id': url,
        url,
        name: `${away.name} at ${home.name}`,
        description: gameDescription(g),
        sport: 'American football',
        startDate: g.date,
        eventStatus: eventStatus(g.statusDescription),
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        ...(g.neutralSite ? {} : { location: { '@type': 'Place', name: `${home.name} home field` } }),
        homeTeam: home,
        awayTeam: away,
        competitor: [away, home],
        organizer: { '@type': 'SportsOrganization', name: g.league === 'nfl' ? 'NFL' : 'NCAA' },
        ...(g.hasScore ? { subjectOf: { '@type': 'Dataset', name: `${away.name} ${g.awayScore}, ${home.name} ${g.homeScore} advanced box score`, url, keywords: [sportNoun(g.league), 'EPA per play', 'success rate', 'win probability'] } } : {}),
    };
}

export interface FaqEntry { question: string; answer: string }

/** schema.org FAQPage from plain question/answer pairs (answers may hold HTML). */
export function faqPageJsonLd(faqs: FaqEntry[], pageUrl: string) {
    if (!faqs.length) return null;
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        '@id': `${pageUrl}#faq`,
        mainEntity: faqs.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer.replace(/<[^>]+>/g, '') },
        })),
    };
}

export function websiteJsonLd(league: League = 'cfb') {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Game on Paper',
        alternateName: 'GameOnPaper.com',
        url: ORIGIN,
        description: league === 'nfl'
            ? 'NFL advanced analytics: EPA per play, success rate, win probability and advanced box scores for every game.'
            : 'College football advanced analytics: EPA per play, success rate, win probability and advanced box scores for every FBS game.',
        publisher: { '@type': 'Organization', name: 'Game on Paper', url: ORIGIN, sameAs: ['https://bsky.app/profile/gameonpaper.com', 'https://x.com/gameonpaper'] },
    };
}

/**
 * Serialise for a <script type="application/ld+json"> body. Escapes `</` so
 * a definition containing "</script>" cannot break out of the tag -- the
 * glossary text is authored data, but the rule is the same as any inline JSON.
 */
export function jsonLdScript(objs: (object | null)[]): string {
    const live = objs.filter((o): o is object => !!o);
    if (live.length === 0) return '';
    const body = live.length === 1 ? live[0] : live;
    return JSON.stringify(body).replace(/<\//g, '<\\/');
}

/** "College Football" / "NFL" and "FBS" / "NFL" -- the copy below is written once for both leagues. */
const sportTitle = (l?: League) => (l === 'nfl' ? 'NFL' : 'College Football');
const poolNoun = (l?: League) => (l === 'nfl' ? 'NFL' : 'FBS');

type LeaderboardCopy = { h1: (s: number, l?: League) => string; title: (s: number, l?: League) => string; description: (s: number, l?: League) => string; intro: string };

/** Copy for the team-leaderboard categories. The words here are the words people search. */
export const LEADERBOARD_COPY: Record<string, LeaderboardCopy> = {
    offensive: {
        h1: (s, l) => `${s} ${sportTitle(l)} Offensive EPA per Play Rankings`,
        title: (s, l) => `${s} ${sportTitle(l)} Offensive Rankings: EPA per Play, Success Rate | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} offense in ${s} ranked by adjusted EPA per play, with success rate, explosiveness and havoc allowed. Sortable, updated after every game.`,
        intro: 'Offensive EPA per play is the average number of expected points an offense adds on each snap, given down, distance and field position. Adjusted EPA/play strips garbage time and corrects for opponent strength and home field, so it is the fairest single number for how good an offense really is.',
    },
    defensive: {
        h1: (s, l) => `${s} ${sportTitle(l)} Defensive EPA per Play Rankings`,
        title: (s, l) => `${s} ${sportTitle(l)} Defensive Rankings: EPA/Play Allowed, Success Rate | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} defense in ${s} ranked by adjusted EPA per play allowed, with success rate, explosiveness and havoc rate. Sortable, updated after every game.`,
        intro: 'Defensive EPA per play is the average number of expected points a defense allows on each snap -- lower (more negative) is better. Adjusted EPA/play strips garbage time and corrects for opponent strength and home field.',
    },
    differential: {
        h1: (s, l) => `${s} ${sportTitle(l)} Team Rankings by Net EPA per Play`,
        title: (s, l) => `${s} ${sportTitle(l)} Advanced Stats: Net EPA per Play Team Rankings | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} team in ${s} ranked by net adjusted EPA per play (offense minus defense), with success rate margin and explosiveness. The advanced-stats power ranking, updated after every game.`,
        intro: 'Net EPA per play is a team\'s offensive EPA per play minus the EPA per play its defense allows -- the single best play-by-play measure of how much better a team is than its opponents. Adjusted for opponent, home field and garbage time.',
    },
    // NFL-only categories (rbsdm.com parity); the college grid has no such columns
    tendencies: {
        h1: (s, l) => `${s} ${sportTitle(l)} Pass Rate Over Expected`,
        title: (s, l) => `${s} ${sportTitle(l)} Pass Rate Over Expected and Neutral-Situation Pass Rate | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} offense in ${s} by pass rate, expected pass rate and pass rate over expected, overall and in neutral situations (early downs, competitive score, outside two minutes), plus series conversion rate for the offense and the defense.`,
        intro: 'Pass rate over expected compares how often an offense throws with how often a model says an average team would throw from the same down, distance, field position, score and clock. Positive means pass-heavy for the situation. Series conversion rate is the share of sets of downs that end in a first down or touchdown.',
    },
    'fourth-downs': {
        h1: (s, l) => `${s} ${sportTitle(l)} Fourth Down Decisions`,
        title: (s, l) => `${s} ${sportTitle(l)} Fourth Down Aggressiveness: Go Rate vs the Model | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} team in ${s} by fourth-down go rate, the go rate the win-probability model recommends, the gap between them, and the average boost of going when the model says go.`,
        intro: 'On every fourth down the model compares the win probability of going for it, kicking and punting. Go rate over expected is how often a team goes minus how often the model would; boost is the average win-probability edge of going on the plays where going was recommended.',
    },
    luck: {
        h1: (s, l) => `${s} ${sportTitle(l)} Luck: Fumble Recoveries and Opponent Field Goals`,
        title: (s, l) => `${s} ${sportTitle(l)} Luck Rankings: Fumble Recovery Rate, Opponent FG% | Game on Paper`,
        description: (s, l) => `Every ${poolNoun(l)} team in ${s} by the share of its own fumbles it recovered, the share of opponent fumbles it recovered, and its opponents' field-goal percentage.`,
        intro: 'Who recovers a loose ball and whether the other kicker misses are close to coin flips over a season. Teams far from the middle here have been lucky or unlucky in ways that tend not to persist.',
    },
};

/** The shared team-leaderboard categories every league has; per-league extras live in utils/league.ts. */
export const LEADERBOARD_CATEGORIES = ['offensive', 'defensive', 'differential'];

/** Copy for the three player-leaderboard categories. Same shape as LEADERBOARD_COPY, minus intro. */
export const PLAYER_LEADERBOARD_COPY: Record<string, Omit<LeaderboardCopy, 'intro'>> = {
    passing: {
        h1: (s) => `${s} Passing EPA per Play Leaders`,
        title: (s, l) => `${s} ${sportTitle(l)} Passing EPA per Play Leaders | Game on Paper`,
        description: (s, l) => `${s} ${poolNoun(l)} quarterbacks ranked by EPA per play (dropback), with total EPA, success rate, explosiveness and yards per attempt. Sortable, updated after every game.`,
    },
    rushing: {
        h1: (s) => `${s} Rushing EPA per Play Leaders`,
        title: (s, l) => `${s} ${sportTitle(l)} Rushing EPA per Play Leaders | Game on Paper`,
        description: (s, l) => `${s} ${poolNoun(l)} rushers ranked by EPA per play (carry), with total EPA, success rate, explosiveness and yards per carry. Sortable, updated after every game.`,
    },
    receiving: {
        h1: (s) => `${s} Receiving EPA per Play Leaders`,
        title: (s, l) => `${s} ${sportTitle(l)} Receiving EPA per Play Leaders | Game on Paper`,
        description: (s, l) => `${s} ${poolNoun(l)} receivers ranked by EPA per play (target), with total EPA, success rate, explosiveness and yards per target. Sortable, updated after every game.`,
    },
};

export const PLAYER_LEADERBOARD_CATEGORIES = Object.keys(PLAYER_LEADERBOARD_COPY);
