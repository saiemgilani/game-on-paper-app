// The one-line game state above the "Latest" plays strip, shared by CFB and NFL.
//
// Drive facts come from ESPN's drives grouping (`drives.current` / `.previous`),
// not from play rows. Two reasons:
//  - sportsdataverse-py fills a null `drive.result` on every play row with the
//    literal "Not provided" (cfb_pbp / nfl_pbp `__add_drive_data`), and a drive
//    still in progress has no result, so reading play rows printed "drive so far:
//    Not provided" on every live game.
//  - ESPN's grouping carries the drive's own running summary ("5 plays, 58 yards,
//    2:39"), which is what "so far" should say.
// `drives.current` also stays on the last drive after it ENDS (a touchdown with
// the kickoff still to come), so a drive with a result reads as "Last drive",
// never "has the ball".

type DriveLike = {
    id?: string;
    description?: string | null;
    displayResult?: string | null;
    result?: string | null;
    team?: { shortDisplayName?: string | null } | null;
};

export type DrivesGrouping = { current?: DriveLike | null; previous?: DriveLike[] | null } | null | undefined;

export type LatestPlay = {
    period?: number | string | null;
    clock?: { displayValue?: string | null } | null;
    [key: string]: unknown;
};

/** A drive result worth printing, or null for missing/placeholder values. */
export function realDriveResult(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text === "" || text.toLowerCase() === "not provided" ? null : text;
}

export function latestDriveSubtitle(drives: DrivesGrouping, lastPlay: LatestPlay | null | undefined, gameState: string | null | undefined): string {
    if (!lastPlay) return "No plays yet.";
    const drive = drives?.current ?? drives?.previous?.at(-1) ?? null;
    const team = drive?.team?.shortDisplayName ?? (lastPlay["drive.team.shortDisplayName"] as string | undefined) ?? "Unknown";
    const result = realDriveResult(drive?.displayResult)
        ?? realDriveResult(drive?.result)
        ?? realDriveResult(lastPlay["drive.displayResult"])
        ?? realDriveResult(lastPlay["drive.result"]);
    const summary = drive?.description?.trim() || null;
    const withSummary = summary ? ` (${summary})` : "";

    if (gameState === "post") return `Final. Last drive: ${team}, ${result ?? "no result"}${withSummary}.`;

    const clock = `Q${lastPlay.period ?? "?"} ${lastPlay.clock?.displayValue ?? ""}`.trim();
    if (result) return `${clock}. Last drive: ${team}, ${result}${withSummary}.`;
    return `${team} has the ball. ${clock}, drive so far: ${summary ?? "just started"}.`;
}
