/**
 * The counting stats an official book carries that the advanced box score does not.
 *
 * Game on Paper's team box already interleaves EPA everywhere, but it has no
 * third-down conversions, no red-zone line, no turnovers and no time of
 * possession -- the rows a reader coming from the official book looks for
 * first. These are all derivable from the processed plays, so they belong
 * beside the EPA rather than in a separate traditional table.
 */

interface DriveLike {
    id?: string | null;
    /** The offense. This is the drive-level convention -- plays use pos_team. */
    team?: { id?: string | number | null } | null;
    isScore?: boolean | null;
    timeElapsed?: { displayValue?: string | null } | null;
    [k: string]: unknown;
}

interface PlayLike {
    pos_team?: number | string | null;
    down?: number | null;
    first_down_created?: boolean | null;
    int_turnover?: boolean | null;
    pos_fumble_lost?: boolean | null;
    sack?: boolean | null;
    sack_vec?: boolean | null;
    rz_play?: boolean | null;
    EPA?: number | null;
    scoring_play?: boolean | null;
    td_play?: boolean | null;
    "drive.id"?: string | null;
    "drive.result"?: string | null;
    [k: string]: unknown;
}

export interface TraditionalRow {
    label: string;
    /** What the book prints, e.g. "6-27 (22%)". */
    value: string;
    /** The EPA that went with those plays, where the pairing is meaningful. */
    epa: number | null;
    title: string;
}

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");
const pct = (n: number, d: number) => (d > 0 ? ` (${Math.round((n / d) * 100)}%)` : "");
const sum = (xs: PlayLike[]) => xs.reduce((t, p) => t + (Number(p.EPA) || 0), 0);

/** "6:07" -> 367 seconds. Drive clocks are mm:ss and occasionally h:mm:ss. */
const toSeconds = (clock: string | null | undefined): number => {
    if (!clock) return 0;
    const parts = clock.split(":").map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return 0;
    return parts.reduce((t, n) => t * 60 + n, 0);
};

const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

/**
 * Time of possession for one team, summed over its drives.
 *
 * Reads the drives grouping rather than the plays: `drive.team` is the offense,
 * which is the drive-level convention here, so ownership needs no inferring.
 * That matters because a `drive.id` is NOT exclusive to one offense -- ESPN
 * files the play after a turnover, and the ensuing kickoff, under the drive
 * that just ended (this fixture's first drive reports 12 offensivePlays and
 * carries 14). Grouping plays by drive id and then filtering them by pos_team
 * would charge those drives to both teams.
 *
 * Counts the whole drive including the punt or field goal that ended it, which
 * is what the official book does.
 */
export function timeOfPossession(drives: DriveLike[], teamId: number | string): number {
    let total = 0;
    for (const d of drives) if (same(d.team?.id, teamId)) total += toSeconds(d.timeElapsed?.displayValue);
    return total;
}

/**
 * The book's counting stats for one team, each carrying its own EPA.
 *
 * Down, turnover and sack rows come from plays filtered by `pos_team`; the
 * possession and red-zone rows come from the drives grouping, since those are
 * drive-level questions and `drive.team` already names the offense.
 */
export function traditionalTeamStats(plays: PlayLike[], teamId: number | string, drives: DriveLike[] = []): TraditionalRow[] {
    const own = plays.filter((p) => same(p.pos_team, teamId));

    const onDown = (d: number) => own.filter((p) => Number(p.down) === d);
    const conv = (d: number) => {
        const att = onDown(d);
        const made = att.filter((p) => p.first_down_created === true);
        return {
            label: `${d === 3 ? "Third" : "Fourth"} down`,
            value: `${made.length}-${att.length}${pct(made.length, att.length)}`,
            epa: att.length ? sum(att) : null,
            title: `Plays snapped on ${d === 3 ? "third" : "fourth"} down that earned a first down, and the EPA over all of them.`,
        };
    };

    // A red-zone trip is a drive, not a play: a drive that reached the 20 counts
    // once however many snaps it took. The drive says whether it scored
    // (`isScore`) and who had it; the plays say whether it reached the 20,
    // since the drive's own play list is the raw feed and carries no rz_play.
    const rzDriveIds = new Set(own.filter((p) => p.rz_play === true).map((p) => p["drive.id"]).filter(Boolean));
    const rzDrives = drives.filter((d) => same(d.team?.id, teamId) && rzDriveIds.has(d.id ?? ""));
    const rzScores = rzDrives.filter((d) => d.isScore === true).length;
    const rzPlays = own.filter((p) => p.rz_play === true);

    const ints = own.filter((p) => p.int_turnover === true).length;
    const fumbles = own.filter((p) => p.pos_fumble_lost === true).length;
    const sacks = own.filter((p) => p.sack === true || p.sack_vec === true);

    return [
        conv(3),
        conv(4),
        {
            label: "Red zone scoring",
            value: `${rzScores}-${rzDrives.length}${pct(rzScores, rzDrives.length)}`,
            epa: rzPlays.length ? sum(rzPlays) : null,
            title: "Drives that reached the opponent 20 and scored on them, and the EPA of the snaps inside the 20.",
        },
        {
            label: "Turnovers",
            value: `${ints + fumbles}${ints + fumbles > 0 ? ` (${ints} INT, ${fumbles} fum)` : ""}`,
            epa: ints + fumbles > 0 ? sum(own.filter((p) => p.int_turnover === true || p.pos_fumble_lost === true)) : null,
            title: "Interceptions thrown plus fumbles lost, and the EPA those plays cost.",
        },
        {
            label: "Sacks taken",
            value: String(sacks.length),
            epa: sacks.length ? sum(sacks) : null,
            title: "Times this team's passer was sacked, and the EPA of those plays.",
        },
        {
            label: "Time of possession",
            value: mmss(timeOfPossession(drives, teamId)),
            epa: null,
            title: "Summed over this team's drives, including the punt or field goal that ended them -- the same convention the official book uses.",
        },
    ];
}
