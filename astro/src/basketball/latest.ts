/**
 * BB-G41, behind 'bball-latest-strip': the live game page's Latest strip. The last five plays newest first (read
 * downward as a feed, as football's Latest panel is) and the last few located shots for the recent-events court,
 * newest first with `age` 0. Selection only; null off a live game, so a final (or a suspended game) renders unchanged.
 */
import type { NbaGame, NbaPlay } from '../resources/nbaGame';
import { shotsOf, unlocatedShots } from '../nba/data/game';

// the header's LIVE badge test (NbaGameHeader.astro): a suspended or delayed game is not live
const LIVE = ['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD'];
export const isLiveGame = (s: NbaGame['status']): boolean => !s.completed && LIVE.includes(s.name);

export interface RecentShot { play: NbaPlay; home: boolean; age: number }
export interface Latest { plays: NbaPlay[]; shots: RecentShot[] }

export const LATEST_PLAYS = 5;
export const RECENT_SHOTS = 8;

/** `rimPlaceholder`: the league's ESPN (25, 0) rule (config espnRimPlaceholder), so a college shot ESPN did not locate is not drawn at the rim. */
export function latestStrip(game: NbaGame, rimPlaceholder = false): Latest | null {
    if (!isLiveGame(game.status) || game.plays.length === 0) return null;
    const homeId = Number(game.home.team.id);
    const located = [game.home, game.away].flatMap((s) => {
        const team = shotsOf(game.plays, Number(s.team.id));
        const un = rimPlaceholder ? unlocatedShots(team) : new Set<NbaPlay>();
        return team.filter((p) => !un.has(p));
    });
    const inOrder = new Set(located);
    const shots = game.plays.filter((p) => inOrder.has(p)).slice(-RECENT_SHOTS).reverse().map((play, age) => ({ play, home: play.teamId === homeId, age }));
    return { plays: game.plays.slice(-LATEST_PLAYS).reverse(), shots };
}
