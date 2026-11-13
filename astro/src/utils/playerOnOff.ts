/**
 * The player page's On/Off section, pure steps (BB-G7): his WOWY pairs turned to read from his side, and the top
 * partners by minutes together. Nothing here aggregates: every number is the producer's row.
 *
 * ponytail: WowySide, WowyLine and wowyLines are #407's utils/onOff.ts (BB-G4, the team page); fold them into that
 * module once both merge.
 */
import type { OnOffRow, WowyRow } from '../resources/playerOnOff';

/** His teammates shown per team: the most minutes together. */
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

/** One team he played for, and his top partners on it. */
export interface PartnerGroup {
    teamId: string;
    /** most minutes together first */
    lines: WowyLine[];
}

export interface PlayerOnOff {
    /** his on/off rows, one per team, most minutes on first; null when a read failed (the section says so) */
    teams: OnOffRow[] | null;
    /** his top partners per team he played for, his most minutes on the floor first (the On/Off table's order) */
    partners: PartnerGroup[];
    /** college: his ESPN athlete id has no ncaa_player_crosswalk pair, so nothing was read (the section says so) */
    unmatched?: true;
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

/**
 * His top partners, split by the team he played for (a traded player's teams never share a list): per team the n
 * teammates with the most minutes on the floor together. Teams come in order of his minutes on the floor for them
 * (together + without, the On/Off row's minutes_on), the On/Off table's order.
 */
export function topPartners(pairs: WowyRow[], player: string, n = TOP_PARTNERS): PartnerGroup[] {
    const byTeam = new Map<string, WowyRow[]>();
    for (const r of pairs) byTeam.set(String(r.team_id), [...(byTeam.get(String(r.team_id)) ?? []), r]);
    const minutesOn = (g: PartnerGroup) => g.lines[0].together.minutes + g.lines[0].without.minutes;
    return [...byTeam]
        .map(([teamId, rows]) => ({ teamId, lines: wowyLines(rows, player).slice(0, n) }))
        .filter((g) => g.lines.length > 0)
        .sort((a, b) => minutesOn(b) - minutesOn(a));
}

/**
 * College: each partner's stats.ncaa.org id as the page's ESPN athlete id (the names and links are keyed by it). A
 * teammate with no crosswalk pair becomes `ncaa:<id>`, which no name or link matches (it prints as `#ncaa:<id>`).
 */
export const espnPartners = (groups: PartnerGroup[], toEspn: Map<string, string>): PartnerGroup[] =>
    groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, teammate: toEspn.get(l.teammate) ?? `ncaa:${l.teammate}` })) }));
