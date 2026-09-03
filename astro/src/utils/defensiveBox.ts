/**
 * Defensive and per-player extras derived from the play text.
 *
 * ESPN's 2025+ LiveStats text names the tacklers on a play in a trailing
 * parenthetical -- `(#16 G.Peterson; #8 B.Vislisel)` -- and marks pass
 * breakups and quarterback hurries inline. None of that reaches the box score
 * ESPN publishes for college football, so the defensive side of a game page has
 * to be read back out of the text.
 *
 * Everything here degrades to an empty table on older games, whose text carries
 * no jersey numbers and no tacklers.
 */

/** A trailing `(#12 A.Player; #7 B.Other)` group naming who made the tackle. */
const RX_TACKLERS = /\((#\d+[^)]*)\)/g;
/** One `#12 A.Player` inside such a group. */
const RX_PLAYER = /#(\d+)\s+([A-Z][A-Za-z.'\-]+(?:\s(?:Jr\.|Sr\.|II|III|IV))?)/g;
const RX_PBU = /broken up by #(\d+) (\S+(?: (?:Jr\.|Sr\.|II|III|IV))?)/g;
const RX_HURRY = /QB hurried by #(\d+) (\S+(?: (?:Jr\.|Sr\.|II|III|IV))?)/g;
const RX_SACK = /sacked for loss of (\d+) yards?/;
const RX_INT = /pass intercepted by #(\d+) (\S+(?: (?:Jr\.|Sr\.|II|III|IV))?)/;
const RX_RUSH_LOSS = /rush(?: [a-z]+)? for (\d+) yards? loss/;

export interface DefensiveLine {
    jersey: number;
    name: string;
    /** Total tackles: solo plus assisted. */
    TOT: number;
    SOLO: number;
    AST: number;
    /** Tackles for loss, shared between everyone credited on the play. */
    TFL: number;
    SACK: number;
    INT: number;
    /** Passes broken up. */
    PBU: number;
    /** Quarterback hurries. */
    QBH: number;
}

interface PlayLike {
    text?: string | null;
    pos_team?: number | string | null;
    def_pos_team?: number | string | null;
}

const bump = (row: DefensiveLine, key: keyof DefensiveLine, by = 1) => {
    (row[key] as number) += by;
};

/**
 * Read the defensive box for one team out of the play text.
 *
 * @param plays every play in the game
 * @param teamId the defending team whose players to credit
 * @param nameFor resolves a jersey number to a display name; falls back to the
 *        short form in the text when the roster has no match
 */
export function defensiveBox(
    plays: PlayLike[],
    teamId: number | string,
    nameFor?: (jersey: number, short: string) => string,
): DefensiveLine[] {
    const rows = new Map<number, DefensiveLine>();
    const row = (jersey: number, short: string): DefensiveLine => {
        let r = rows.get(jersey);
        if (!r) {
            r = { jersey, name: nameFor?.(jersey, short) ?? short, TOT: 0, SOLO: 0, AST: 0, TFL: 0, SACK: 0, INT: 0, PBU: 0, QBH: 0 };
            rows.set(jersey, r);
        }
        return r;
    };
    const sameTeam = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

    for (const play of plays) {
        const text = play?.text ?? "";
        if (!text || !sameTeam(play.def_pos_team, teamId)) continue;
        // a wiped play never happened, so nobody is credited for it
        if (/NO PLAY|nullified by penalty/i.test(text)) continue;

        const tacklers: Array<[number, string]> = [];
        for (const group of text.matchAll(RX_TACKLERS)) {
            const inner = group[1];
            if (/H:|LS:/.test(inner)) continue; // holder / long snapper on a kick, not a tackle
            tacklers.length = 0;
            for (const m of inner.matchAll(RX_PLAYER)) tacklers.push([Number(m[1]), m[2]]);
        }

        const sack = RX_SACK.exec(text);
        const rushLoss = RX_RUSH_LOSS.exec(text);
        const share = tacklers.length ? 1 / tacklers.length : 0;

        for (const [jersey, short] of tacklers) {
            const r = row(jersey, short);
            bump(r, "TOT");
            bump(r, tacklers.length === 1 ? "SOLO" : "AST");
            if (sack) {
                r.SACK += share;
                r.TFL += share;
            } else if (rushLoss) {
                r.TFL += share;
            }
        }
        for (const m of text.matchAll(RX_PBU)) bump(row(Number(m[1]), m[2]), "PBU");
        for (const m of text.matchAll(RX_HURRY)) bump(row(Number(m[1]), m[2]), "QBH");
        const int = RX_INT.exec(text);
        if (int) bump(row(Number(int[1]), int[2]), "INT");
    }

    const round1 = (n: number) => Math.round(n * 10) / 10;
    return [...rows.values()]
        .map((r) => ({ ...r, TFL: round1(r.TFL), SACK: round1(r.SACK) }))
        .filter((r) => r.TOT > 0 || r.PBU > 0 || r.QBH > 0 || r.INT > 0)
        .sort((a, b) => b.TOT - a.TOT || b.SOLO - a.SOLO || a.name.localeCompare(b.name));
}

/** Best single play by EPA and by WPA, plus the longest gain, for one player. */
export interface PlayerExtremes {
    EPA_MAX: number | null;
    WPA_MAX: number | null;
    LNG: number | null;
}

/**
 * Per-player bests over the plays they appear on.
 *
 * @param plays every play in the game
 * @param idField which participant column identifies the player on a play
 * @param yardField the yardage column to take the longest gain from, if any
 */
export function playerExtremes(
    plays: Array<Record<string, unknown>>,
    idField: string,
    yardField?: string,
): Map<string, PlayerExtremes> {
    const out = new Map<string, PlayerExtremes>();
    for (const play of plays) {
        const id = play[idField];
        if (id == null || id === "") continue;
        const key = String(id);
        const cur = out.get(key) ?? { EPA_MAX: null, WPA_MAX: null, LNG: null };
        const epa = Number(play["EPA"]);
        const wpa = Number(play["wpa"]);
        if (Number.isFinite(epa)) cur.EPA_MAX = cur.EPA_MAX == null ? epa : Math.max(cur.EPA_MAX, epa);
        if (Number.isFinite(wpa)) cur.WPA_MAX = cur.WPA_MAX == null ? wpa : Math.max(cur.WPA_MAX, wpa);
        if (yardField) {
            const y = Number(play[yardField]);
            if (Number.isFinite(y)) cur.LNG = cur.LNG == null ? y : Math.max(cur.LNG, y);
        }
        out.set(key, cur);
    }
    // a longest of less than zero reads as 0, the way every box score prints it
    for (const v of out.values()) if (v.LNG != null && v.LNG < 0) v.LNG = 0;
    return out;
}
