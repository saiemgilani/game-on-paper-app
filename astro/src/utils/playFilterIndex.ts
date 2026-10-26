/**
 * A per-play index of who did what, so the play-by-play can be narrowed to one
 * player's work or one kind of play.
 *
 * The play-by-play links fourteen player roles by id, and those ids share the box
 * score's `athlete_id` space, so a filter keyed on the id needs no name matching and
 * cannot confuse two players who share a name.
 */

/** Roles a play can attribute to a player, and how each reads in a menu. */
export const ROLE_LABEL = {
    pass: "Dropbacks", rush: "Carries", recv: "Targets", sack: "Sacks",
    int: "Interceptions", pbu: "Pass breakups", ff: "Forced fumbles",
    fumrec: "Fumble recoveries", fumble: "Fumbles", punt: "Punts",
    fg: "Field goals", kickoff: "Kickoffs", kret: "Kick returns", pret: "Punt returns",
} as const;
export type Role = keyof typeof ROLE_LABEL;

const ROLE_FIELDS: Record<Role, [string, string]> = {
    pass: ["passer_player_id", "passer_player_name"],
    rush: ["rusher_player_id", "rusher_player_name"],
    recv: ["receiver_player_id", "receiver_player_name"],
    sack: ["sack_player_id", "sack_player_name"],
    int: ["interception_player_id", "interception_player_name"],
    pbu: ["pass_breakup_player_id", "pass_breakup_player_name"],
    ff: ["fumble_forced_player_id", "fumble_forced_player_name"],
    fumrec: ["fumble_recovered_player_id", "fumble_recovered_player_name"],
    fumble: ["fumble_player_id", "fumble_player_name"],
    punt: ["punter_player_id", "punter_player_name"],
    fg: ["fg_kicker_player_id", "fg_kicker_player_name"],
    kickoff: ["kickoff_player_id", "kickoff_player_name"],
    kret: ["kickoff_return_player_id", "kickoff_return_player_name"],
    pret: ["punt_return_player_id", "punt_return_player_name"],
};

/**
 * The team a role's player plays for. Not simply "the team with the ball": a kickoff's
 * pos_team is the RECEIVING team, a punt's the kicking team, and a fumble can be
 * recovered by either side, so the kicking roles read the processor's kicking_team /
 * kick_return_team and a recovery its fumble_recovery_team, each falling back to the
 * side that convention implies. A fumble on a kick is the returner's (blocked punts
 * carry no fumble_recovery_team, and their recovery is the return side's too).
 * Measured on 222 games, 2004-2026, against the box score's rosters: every role here
 * is 99%+ right except the two fumble roles (~92%), which is why they rank last below.
 */
const ROLE_TEAM: Record<Role, (p: any) => unknown> = {
    pass: (p) => p.pos_team, rush: (p) => p.pos_team, recv: (p) => p.pos_team,
    fumble: (p) => p.kick_return_team ?? p.pos_team,
    sack: (p) => p.def_pos_team, int: (p) => p.def_pos_team, pbu: (p) => p.def_pos_team,
    ff: (p) => p.forced_fumble_team ?? p.def_pos_team,
    fumrec: (p) => p.fumble_recovery_team ?? p.kick_return_team ?? (p.fumble_lost === true ? p.def_pos_team : p.pos_team),
    punt: (p) => p.kicking_team ?? p.pos_team,
    fg: (p) => p.fg_team ?? p.pos_team,
    kickoff: (p) => p.kicking_team ?? p.def_pos_team,
    kret: (p) => p.kick_return_team ?? p.pos_team,
    pret: (p) => p.punt_return_team ?? p.kick_return_team ?? p.def_pos_team,
};
/** The roles whose team is least certain: on a play, any other role of the same player decides his side. */
const WEAK = new Set<Role>(["fumble", "fumrec"]);

/** Play-type filters that are not about one player. */
export const PLAY_TAGS = {
    scoring: "Scoring plays", turnover: "Turnovers", penalty: "Penalties",
    explosive: "Explosive plays", success: "Successful plays", thirdDown: "Third downs",
    fourthDown: "Fourth downs", redZone: "Red zone", sp: "Special teams",
} as const;
export type PlayTag = keyof typeof PLAY_TAGS;

const TAG_TEST: Record<PlayTag, (p: any) => boolean> = {
    scoring: (p) => p.scoring_play === true || p.scoringPlay === true,
    turnover: (p) => p.is_turnover === true || p.turnover_vec === true,
    penalty: (p) => p.penalty_flag === true,
    explosive: (p) => p.EPA_explosive === true,
    success: (p) => p.EPA_success === true,
    thirdDown: (p) => Number(p.down) === 3,
    fourthDown: (p) => Number(p.down) === 4,
    redZone: (p) => p.rz_play === true,
    sp: (p) => p.sp === true || p.kickoff_play === true || p.punt_play === true || p.fg_attempt === true,
};

export interface PlayerOption {
    id: string;
    name: string;
    teamId: string;
    /** Role -> how many plays, so a menu can show "Carries (18)". */
    roles: Partial<Record<Role, number>>;
    total: number;
}

export interface PlayIndex {
    /** play key -> the set of "role:id" and "tag:x" selectors that play satisfies. */
    byPlay: Record<string, string[]>;
    players: PlayerOption[];
    tagCounts: Partial<Record<PlayTag, number>>;
}

const keyOf = (p: any) => String(p.game_play_number ?? p.id ?? "");

/**
 * @param plays every play in the game
 * @param teamId when given, only players of that team are offered
 */
export function buildPlayIndex(plays: any[], teamId?: number | string): PlayIndex {
    const byPlay: Record<string, string[]> = {};
    const players = new Map<string, PlayerOption>();
    const tagCounts: Partial<Record<PlayTag, number>> = {};
    // player id -> team -> [plays from a firm role, plays from a fumble role]. A player's
    // team is his majority, firm plays first, so one odd row (a returner's fumble, a
    // mislabelled recovery) cannot move his whole menu entry.
    const votes = new Map<string, Map<string, [number, number]>>();

    for (const p of plays) {
        const key = keyOf(p);
        if (!key) continue;
        const sels: string[] = [];

        // this play's roles by player, so a player gets one side per play
        const here = new Map<string, { name: unknown; roles: Role[]; owner: string; firm: boolean }>();
        for (const role of Object.keys(ROLE_FIELDS) as Role[]) {
            const [idf, namef] = ROLE_FIELDS[role];
            const id = p[idf];
            if (id === null || id === undefined || id === "") continue;
            // ESPN's team pseudo-athlete is not a player
            if (String(p[namef] ?? "").toUpperCase() === "TEAM") continue;
            // the processor also fills fg_kicker on kickoffs; only an attempt is a field goal
            if (role === "fg" && p.fg_attempt !== true) continue;
            const owner = String(ROLE_TEAM[role](p) ?? "");
            const sid = String(id);
            const h = here.get(sid) ?? { name: p[namef], roles: [], owner: "", firm: false };
            h.roles.push(role);
            // a firm role's side beats a fumble role's; the first of each kind stands
            if (owner && (!h.owner || (!h.firm && !WEAK.has(role)))) { h.owner = owner; h.firm = !WEAK.has(role); }
            here.set(sid, h);
        }

        for (const [sid, h] of here) {
            if (teamId !== undefined && String(teamId) !== h.owner) continue;
            let e = players.get(sid);
            if (!e) {
                e = { id: sid, name: String(h.name ?? sid), teamId: h.owner, roles: {}, total: 0 };
                players.set(sid, e);
            }
            for (const role of h.roles) {
                sels.push(`r:${role}:${sid}`);
                e.roles[role] = (e.roles[role] ?? 0) + 1;
                e.total++;
            }
            if (!h.owner) continue;
            const v = votes.get(sid) ?? new Map<string, [number, number]>();
            const n = v.get(h.owner) ?? [0, 0];
            n[h.firm ? 0 : 1]++;
            v.set(h.owner, n);
            votes.set(sid, v);
        }

        for (const tag of Object.keys(TAG_TEST) as PlayTag[]) {
            if (!TAG_TEST[tag](p)) continue;
            if (teamId !== undefined && String(p.pos_team ?? "") !== String(teamId)
                && tag !== "penalty" && tag !== "turnover") continue;
            sels.push(`t:${tag}`);
            tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }

        if (p.period && p.period > 4) {
            sels.push("p:5")
        } else if (p.period && p.period <= 4) {
            sels.push(`p:${p.period}`)
        }

        if (sels.length) byPlay[key] = sels;
    }

    // most firm plays, then most fumble plays, then the lower team id: the same answer in any play order
    for (const [sid, v] of votes) {
        players.get(sid)!.teamId = [...v].sort(([ta, a], [tb, b]) => b[0] - a[0] || b[1] - a[1] || ta.localeCompare(tb))[0][0];
    }

    return {
        byPlay,
        players: [...players.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
        tagCounts,
    };
}
