/**
 * The On/Off and WOWY section's pure steps (BB-G4): the WOWY player (?wowy=, whitelisted to the team's on/off players)
 * and that player's pairs, turned to read from his side. Nothing here aggregates: every number is the producer's row.
 */
import type { OnOffRow, WowyRow } from '../resources/onOff';

/** One split of a pair: the team's minutes and net rating in it. */
export interface WowySide {
    minutes: number;
    net: number | null;
}

/** One teammate of the WOWY player: the season with both, the player without him, him without the player, neither. */
export interface WowyLine {
    teammate: string;
    together: WowySide;
    without: WowySide;
    mateOnly: WowySide;
    neither: WowySide;
}

export interface OnOffTab {
    /** most minutes on first; null when a read failed (the section says so) */
    players: OnOffRow[] | null;
    /** player id -> name; an id with no name reads as `#<id>` */
    names: Map<string, string>;
    /** the WOWY player's id; null with no players */
    wowy: string | null;
    /** his teammates, most minutes together first */
    lines: WowyLine[];
    /** ?onoff=all: every row, with no minutes minimum */
    all: boolean;
}

/** The section hides on/off rows under this many minutes on the floor, and WOWY teammates under WOWY_MIN_MINUTES together, unless ?onoff=all. */
export const ON_OFF_MIN_MINUTES = 100;
export const WOWY_MIN_MINUTES = 50;

/** The rows shown: those over the minimum, or every row with ?onoff=all. */
export function shownPlayers(players: OnOffRow[], all: boolean): OnOffRow[] {
    return all ? players : players.filter((p) => p.minutes_on >= ON_OFF_MIN_MINUTES);
}
export function shownLines(lines: WowyLine[], all: boolean): WowyLine[] {
    return all ? lines : lines.filter((l) => l.together.minutes >= WOWY_MIN_MINUTES);
}

/**
 * A player whose games for the team are well short of the team's (under three quarters): traded, signed or hurt, so his
 * off side carries games he was not there for. ponytail: one fixed share; a tenure-limited off side is the producer's (BB-D5).
 */
export const SHORT_SHARE = 0.75;
export function isShortTenure(p: Pick<OnOffRow, 'games' | 'team_games'>): boolean {
    return p.team_games > 0 && p.games < SHORT_SHARE * p.team_games;
}

/** ?wowy=: one of the team's on/off players; anything else is the one with the most minutes on the floor. */
export function parseWowy(v: string | null, players: Pick<OnOffRow, 'player_id'>[]): string | null {
    return players.find((p) => String(p.player_id) === v) ? v : players.length ? String(players[0].player_id) : null;
}

/** The player's pairs from his side (the producer orders each pair by id, so he is player_id_a or player_id_b). */
export function wowyLines(pairs: WowyRow[], player: string | null): WowyLine[] {
    const side = (r: WowyRow, s: 'both' | 'a_only' | 'b_only' | 'neither'): WowySide => ({ minutes: r[`minutes_${s}`], net: r[`net_rtg_${s}`] });
    return pairs
        .filter((r) => String(r.player_id_a) === player || String(r.player_id_b) === player)
        .map((r) => {
            const isA = String(r.player_id_a) === player;
            return {
                teammate: String(isA ? r.player_id_b : r.player_id_a),
                together: side(r, 'both'),
                without: side(r, isA ? 'a_only' : 'b_only'),
                mateOnly: side(r, isA ? 'b_only' : 'a_only'),
                neither: side(r, 'neither'),
            };
        })
        .sort((x, y) => y.together.minutes - x.together.minutes);
}
