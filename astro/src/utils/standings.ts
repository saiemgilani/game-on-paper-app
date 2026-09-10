import { retrieveConferenceStandings, type ESPNConferenceStandings, type ESPNStandingsEntry } from "../resources/espn";
import type { League } from "./league";

/**
 * FBS conference group ids in display order: the P4, then the G5, then the
 * rebuilt Pac-12 and the independents. '80' (all FBS) is deliberately absent.
 */
export const STANDINGS_CONFERENCES = ["8", "5", "4", "1", "151", "17", "37", "15", "12", "9", "18"];

/**
 * NFL conference group ids, AFC then NFC. Unlike CFB, the conference itself
 * carries no entries -- its four divisions come back as `children`, so two
 * fetches yield the eight blocks the page renders.
 */
export const NFL_CONFERENCES = ["8", "7"];

export interface StandingsGroup {
    groupId: string
    name: string
    shortName: string
    rows: StandingsRow[]
}

/** A group is renderable only once it actually has teams in it. */
function toGroup(
    c: ESPNConferenceStandings | null | undefined,
    fallbackId: string,
    // ESPN abbreviates an NFL division to EAST/NORTH/SOUTH/WEST, which collides
    // across the two conferences -- the dropdown would list EAST twice. The full
    // name ("AFC East") is already short, so the NFL keeps it.
    preferFullName = false,
): StandingsGroup | null {
    const entries = c?.standings?.entries ?? [];
    if (!c || entries.length === 0) return null;
    const name = c.name ?? "Conference";
    return {
        groupId: c.id ?? fallbackId,
        name,
        // the dropdown uses ESPN's short form, the standard the chart builder set
        shortName: preferFullName ? name : (c.shortName ?? c.abbreviation ?? name),
        rows: sortStandings(entries.map(parseStandingsEntry)),
    };
}

/**
 * Every standings block for a league, in display order.
 *
 * CFB is one fetch per conference with entries on the group itself; the NFL is
 * one fetch per conference whose divisions arrive as `children`. Both flatten to
 * the same shape, so the page does not branch. A failed fetch drops its own
 * block and costs no other.
 */
export async function loadStandings(league: League): Promise<StandingsGroup[]> {
    const ids = league === 'nfl' ? NFL_CONFERENCES : STANDINGS_CONFERENCES;
    const results = await Promise.all(ids.map((g) => retrieveConferenceStandings(g, league)));
    return results.flatMap((c, i) =>
        league === 'nfl'
            ? (c?.children ?? []).map((d) => toGroup(d, `${ids[i]}-${d.id ?? ""}`, true))
            : [toGroup(c, ids[i])],
    ).filter((g): g is StandingsGroup => !!g);
}

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
