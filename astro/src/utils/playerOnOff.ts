/**
 * The player page's On/Off section, pure steps (BB-G7): his WOWY pairs turned to read from his side, and the top
 * partners by minutes together. Nothing here aggregates: every number is the producer's row.
 *
 * ponytail: WowySide, WowyLine and wowyLines are #407's utils/onOff.ts (BB-G4, the team page); fold them into that
 * module once both merge.
 */
import type { OnOffRow, WowyRow } from '../resources/playerOnOff';

/** His teammates shown: the most minutes together. */
export const TOP_PARTNERS = 5;

/** One split of a pair: the team's minutes and net rating in it. */
export interface WowySide {
    minutes: number;
    net: number | null;
}

/** One teammate: the season with both, the player without him, him without the player, neither. */
export interface WowyLine {
    teammate: string;
    together: WowySide;
    without: WowySide;
    mateOnly: WowySide;
    neither: WowySide;
}

export interface PlayerOnOff {
    /** his on/off rows, one per team, most minutes on first; null when a read failed (the section says so) */
    teams: OnOffRow[] | null;
    /** his top partners, most minutes together first */
    partners: WowyLine[];
    /** person id -> name, from the page's season rows; an id with no name reads as `#<id>` */
    names: Map<string, string>;
    /** team id -> tricode, from the page's season rows */
    tricodes: Map<string, string>;
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

/** His top partners across every team he played for: the most minutes on the floor together. */
export const topPartners = (pairs: WowyRow[], player: string, n = TOP_PARTNERS): WowyLine[] => wowyLines(pairs, player).slice(0, n);
