import { cleanLocation } from './misc';

/**
 * The game page's h1, "away 30 @ home 27" ("away @ home" with no scores), in pieces:
 * GameTitle.astro links the two names, everything else joins them with gameTitleText.
 * The one place that wording lives, so the h1 and the WP export title cannot drift.
 */
export function gameTitleParts(awayTeam: any, homeTeam: any, awayScore: string | number | null = null, homeScore: string | number | null = null) {
    const score = (s: string | number | null) => (s == null ? '' : ` ${s}`);
    return { away: cleanLocation(awayTeam), mid: `${score(awayScore)} @ `, home: cleanLocation(homeTeam), tail: score(homeScore) };
}

export function gameTitleText(...args: Parameters<typeof gameTitleParts>): string {
    const { away, mid, home, tail } = gameTitleParts(...args);
    return `${away}${mid}${home}${tail}`;
}
