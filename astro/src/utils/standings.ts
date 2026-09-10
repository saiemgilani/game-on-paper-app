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
    league: League,
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
        rows: sortStandings(entries.map((e) => parseStandingsEntry(e, league)), league),
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
            ? (c?.children ?? []).map((d) => toGroup(d, `${ids[i]}-${d.id ?? ""}`, league, true))
            : [toGroup(c, ids[i], league)],
    ).filter((g): g is StandingsGroup => !!g);
}

export interface StandingsRow {
    teamId: string
    name: string
    abbreviation?: string
    logo?: string
    overall: string
    conference: string
    /** "vs. Div." -- the NFL's tiebreak record; empty for CFB */
    division: string
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
export function parseStandingsEntry(entry: ESPNStandingsEntry, league: League = 'cfb'): StandingsRow {
    const first: Record<string, string> = {};
    let overall = "";
    let conference = "";
    let division = "";
    for (const s of entry.stats ?? []) {
        const name = s.name ?? "";
        if (name === "overall" && !overall) overall = s.displayValue ?? "";
        else if (name === "vs. Conf." && !conference) conference = s.displayValue ?? "";
        else if (name === "vs. Div." && !division) division = s.displayValue ?? "";
        else if (!(name in first)) first[name] = s.displayValue ?? "";
    }
    // CFB reads as the location ("Ohio State"). The NFL cannot: two New Yorks
    // and two Los Angeleses share a city, so it takes ESPN's short name
    // ("Jets", "Giants"), which is what every NFL standings table prints.
    const name = league === 'nfl'
        ? (entry.team?.shortDisplayName ?? entry.team?.displayName ?? entry.team?.abbreviation ?? "")
        : (entry.team?.location ?? entry.team?.abbreviation ?? "");
    return {
        teamId: String(entry.team?.id ?? ""),
        name,
        abbreviation: entry.team?.abbreviation,
        logo: entry.team?.logos?.[0]?.href,
        overall,
        conference,
        division,
        pointsFor: Number(first["pointsFor"] ?? 0),
        pointsAgainst: Number(first["pointsAgainst"] ?? 0),
        pointDifferential: first["pointDifferential"] ?? "0",
        streak: first["streak"] ?? "-",
        seed: Number(first["playoffSeed"] ?? 0) || 999,
    };
}

/**
 * ESPN's `playoffSeed` encodes the league's own tiebreak order, which is the
 * right primary key -- but only once ESPN has seeded the WHOLE group. Early in
 * a season it seeds the teams that have played and leaves the rest at 0, so a
 * 0-1 team arrives as "seed 1" above three 0-0 teams (AFC East, week 2 2026).
 * A partially seeded group therefore falls back to the record: overall win
 * percentage, then the league's tiebreak record -- division for the NFL,
 * conference for CFB -- and ESPN's own order after that (the sort is stable).
 */
export function sortStandings(rows: StandingsRow[], league: League = 'cfb'): StandingsRow[] {
    // "W-L" or, in the NFL, "W-L-T": a tie is half a win, the league's own rule
    const winPct = (rec: string) => {
        const [w, l, t = 0] = rec.split("-").map(Number);
        const games = w + l + t;
        return Number.isFinite(games) && games > 0 ? (w + t / 2) / games : 0;
    };
    const fullySeeded = rows.length > 0 && rows.every((r) => r.seed !== 999);
    if (fullySeeded) return rows.toSorted((a, b) => a.seed - b.seed);
    const tiebreak = (r: StandingsRow) => (league === 'nfl' ? r.division : r.conference);
    return rows.toSorted(
        (a, b) => winPct(b.overall) - winPct(a.overall) || winPct(tiebreak(b)) - winPct(tiebreak(a)),
    );
}
