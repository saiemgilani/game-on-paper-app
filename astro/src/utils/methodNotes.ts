// Method notes (IF-3, flag 'method-notes'): one sentence per population, said the same way on every
// advanced panel. Each matches what the panel's producer actually does: the season tables
// (team_summaries / player summaries) are FBS vs FBS (cfb) or regular season (nfl) and unadjusted
// except Adj EPA/Play; the game page's box score counts every play.
import type { League } from './league';

export const METHOD_NOTES = {
    cfbSeason: 'Data shown is from FBS vs FBS games only. Not adjusted for opponent or garbage time.',
    nflSeason: 'Data shown is from regular season games only. Not adjusted for opponent or garbage time.',
    adjusted: 'Adjusted for opponent strength, fit with a home-field term in FBS vs FBS games. Garbage time (a lead of more than 43, 37, 27 or 21 points in quarters 1-4, and 21 in overtime) is left out of both the fit and the team\'s own EPA.',
    game: 'Every play, garbage time included. Not adjusted for opponent.',
} as const;

/** The season tables' note for a football league (a page without a league is the college site); undefined for a
 *  league with no note written, so a caller keeps its own copy rather than borrowing another league's. */
export function seasonNote(league: League | undefined): string | undefined {
    const lg = league ?? 'cfb';
    return lg === 'cfb' ? METHOD_NOTES.cfbSeason : lg === 'nfl' ? METHOD_NOTES.nflSeason : undefined;
}
