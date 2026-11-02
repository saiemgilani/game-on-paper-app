// Method notes (IF-3, flag 'method-notes'): one sentence per population, said the same way on every
// advanced panel. Each matches what the panel's producer actually does: the season tables
// (team_summaries / player summaries) are FBS vs FBS (cfb) or regular season (nfl) and unadjusted
// except Adj EPA/Play; the game page's box score counts every play.
import type { League } from './league';

export const METHOD_NOTES = {
    cfbSeason: 'Data shown is from FBS vs FBS games only. Not adjusted for opponent or garbage time.',
    nflSeason: 'Data shown is from regular season games only. Not adjusted for opponent or garbage time.',
    adjusted: 'Adjusted for opponent strength, fit with a home-field term on non-garbage-time plays in FBS vs FBS games.',
    game: 'Every play, garbage time included. Not adjusted for opponent.',
} as const;

/** The season tables' note for a league; a page without a league is the college site. */
export function seasonNote(league: League | undefined): string {
    return (league ?? 'cfb') === 'cfb' ? METHOD_NOTES.cfbSeason : METHOD_NOTES.nflSeason;
}
