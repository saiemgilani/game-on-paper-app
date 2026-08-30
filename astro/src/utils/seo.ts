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

export const ORIGIN = 'https://gameonpaper.com';

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
            description: t.definition,
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
        keywords: ['college football', 'EPA', 'expected points added', 'EPA per play', 'success rate', 'advanced stats'],
        creator: { '@type': 'Organization', name: 'Game on Paper', url: ORIGIN },
        isAccessibleForFree: true,
        variableMeasured: spec.variables.map((v) => ({ '@type': 'PropertyValue', name: v })),
    };
}

export function websiteJsonLd() {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Game on Paper',
        alternateName: 'GameOnPaper.com',
        url: ORIGIN,
        description: 'College football advanced analytics: EPA per play, success rate, win probability and advanced box scores for every FBS game.',
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

/** Copy for the three team-leaderboard categories. The words here are the words people search. */
export const LEADERBOARD_COPY: Record<string, { h1: (s: number) => string; title: (s: number) => string; description: (s: number) => string; intro: string }> = {
    offensive: {
        h1: (s) => `${s} College Football Offensive EPA per Play Rankings`,
        title: (s) => `${s} College Football Offensive Rankings: EPA per Play, Success Rate | Game on Paper`,
        description: (s) => `Every FBS offense in ${s} ranked by adjusted EPA per play, with success rate, explosiveness and havoc allowed. Sortable, updated after every game.`,
        intro: 'Offensive EPA per play is the average number of expected points an offense adds on each snap, given down, distance and field position. Adjusted EPA/play strips garbage time and corrects for opponent strength and home field, so it is the fairest single number for how good an offense really is.',
    },
    defensive: {
        h1: (s) => `${s} College Football Defensive EPA per Play Rankings`,
        title: (s) => `${s} College Football Defensive Rankings: EPA per Play Allowed, Success Rate | Game on Paper`,
        description: (s) => `Every FBS defense in ${s} ranked by adjusted EPA per play allowed, with success rate, explosiveness and havoc rate. Sortable, updated after every game.`,
        intro: 'Defensive EPA per play is the average number of expected points a defense allows on each snap -- lower (more negative) is better. Adjusted EPA/play strips garbage time and corrects for opponent strength and home field.',
    },
    differential: {
        h1: (s) => `${s} College Football Team Rankings by Net EPA per Play`,
        title: (s) => `${s} College Football Advanced Stats: Net EPA per Play Team Rankings | Game on Paper`,
        description: (s) => `Every FBS team in ${s} ranked by net adjusted EPA per play (offense minus defense), with success rate margin and explosiveness. The advanced-stats power ranking, updated after every game.`,
        intro: 'Net EPA per play is a team\'s offensive EPA per play minus the EPA per play its defense allows -- the single best play-by-play measure of how much better a team is than its opponents. Adjusted for opponent, home field and garbage time.',
    },
};

export const LEADERBOARD_CATEGORIES = Object.keys(LEADERBOARD_COPY);

/** Copy for the three player-leaderboard categories. Same shape as LEADERBOARD_COPY, minus intro. */
export const PLAYER_LEADERBOARD_COPY: Record<string, { h1: (s: number) => string; title: (s: number) => string; description: (s: number) => string }> = {
    passing: {
        h1: (s) => `${s} Passing EPA per Play Leaders`,
        title: (s) => `${s} College Football Passing EPA per Play Leaders | Game on Paper`,
        description: (s) => `${s} FBS quarterbacks ranked by EPA per play (dropback), with total EPA, success rate, explosiveness and yards per attempt. Sortable, updated after every game.`,
    },
    rushing: {
        h1: (s) => `${s} Rushing EPA per Play Leaders`,
        title: (s) => `${s} College Football Rushing EPA per Play Leaders | Game on Paper`,
        description: (s) => `${s} FBS rushers ranked by EPA per play (carry), with total EPA, success rate, explosiveness and yards per carry. Sortable, updated after every game.`,
    },
    receiving: {
        h1: (s) => `${s} Receiving EPA per Play Leaders`,
        title: (s) => `${s} College Football Receiving EPA per Play Leaders | Game on Paper`,
        description: (s) => `${s} FBS receivers ranked by EPA per play (target), with total EPA, success rate, explosiveness and yards per target. Sortable, updated after every game.`,
    },
};

export const PLAYER_LEADERBOARD_CATEGORIES = Object.keys(PLAYER_LEADERBOARD_COPY);
