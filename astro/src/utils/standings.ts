import type { ESPNStandingsEntry } from "../resources/espn";

/**
 * FBS conference group ids in display order: the P4, then the G5, then the
 * rebuilt Pac-12 and the independents. '80' (all FBS) is deliberately absent.
 */
export const STANDINGS_CONFERENCES = ["8", "5", "4", "1", "151", "17", "37", "15", "12", "9", "18"];

export interface StandingsRow {
    teamId: string
    name: string
    abbreviation?: string
    logo?: string
    overall: string
    conference: string
    pointsFor: number
    pointsAgainst: number
    pointDifferential: string
    streak: string
    seed: number
}

/**
 * ESPN ships an entry's stats as repeated blocks (overall first, then Home /
 * Away / vs Division / vs. Conf. / ...), every block re-listing pointsFor,
 * streak, etc. with block-local values. The FIRST occurrence of each scalar is
 * the overall one; the records are addressed by their exact display names.
 */
export function parseStandingsEntry(entry: ESPNStandingsEntry): StandingsRow {
    const first: Record<string, string> = {};
    let overall = "";
    let conference = "";
    for (const s of entry.stats ?? []) {
        const name = s.name ?? "";
        if (name === "overall" && !overall) overall = s.displayValue ?? "";
        else if (name === "vs. Conf." && !conference) conference = s.displayValue ?? "";
        else if (!(name in first)) first[name] = s.displayValue ?? "";
    }
    return {
        teamId: String(entry.team?.id ?? ""),
        name: entry.team?.location ?? entry.team?.abbreviation ?? "",
        abbreviation: entry.team?.abbreviation,
        logo: entry.team?.logos?.[0]?.href,
        overall,
        conference,
        pointsFor: Number(first["pointsFor"] ?? 0),
        pointsAgainst: Number(first["pointsAgainst"] ?? 0),
        pointDifferential: first["pointDifferential"] ?? "0",
        streak: first["streak"] ?? "-",
        seed: Number(first["playoffSeed"] ?? 0) || 999,
    };
}

/** Conference order: seed when ESPN provides it, else conference win rate. */
export function sortStandings(rows: StandingsRow[]): StandingsRow[] {
    const winPct = (rec: string) => {
        const [w, l] = rec.split("-").map(Number);
        return Number.isFinite(w) && Number.isFinite(l) && w + l > 0 ? w / (w + l) : 0;
    };
    return rows.toSorted((a, b) =>
        a.seed !== b.seed ? a.seed - b.seed : winPct(b.conference) - winPct(a.conference)
    );
}
