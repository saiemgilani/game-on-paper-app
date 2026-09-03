/**
 * A per-play index of who did what, so the play-by-play can be narrowed to one
 * player's work or one kind of play.
 *
 * The play-by-play links eighteen player roles by id, and those ids share the box
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

    for (const p of plays) {
        const key = keyOf(p);
        if (!key) continue;
        const sels: string[] = [];

        for (const role of Object.keys(ROLE_FIELDS) as Role[]) {
            const [idf, namef] = ROLE_FIELDS[role];
            const id = p[idf];
            if (id === null || id === undefined || id === "") continue;
            // a defender belongs to the team without the ball; everyone else to pos_team
            const defensive = role === "sack" || role === "int" || role === "pbu" || role === "ff";
            const owner = String((defensive ? p.def_pos_team : p.pos_team) ?? "");
            if (teamId !== undefined && String(teamId) !== owner) continue;
            const sid = String(id);
            sels.push(`r:${role}:${sid}`);
            let e = players.get(sid);
            if (!e) {
                e = { id: sid, name: String(p[namef] ?? sid), teamId: owner, roles: {}, total: 0 };
                players.set(sid, e);
            }
            e.roles[role] = (e.roles[role] ?? 0) + 1;
            e.total++;
        }

        for (const tag of Object.keys(TAG_TEST) as PlayTag[]) {
            if (!TAG_TEST[tag](p)) continue;
            if (teamId !== undefined && String(p.pos_team ?? "") !== String(teamId)
                && tag !== "penalty" && tag !== "turnover") continue;
            sels.push(`t:${tag}`);
            tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
        }

        if (sels.length) byPlay[key] = sels;
    }

    return {
        byPlay,
        players: [...players.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
        tagCounts,
    };
}
