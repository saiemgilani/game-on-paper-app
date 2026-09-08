import type { ESPNRankEntry, ESPNRanking } from "../resources/espn";

/** FBS polls in display order; anything else (FCS, DII) is filtered out. */
const FBS_POLL_ORDER = ["21", "1", "2"]; // CFP first when it exists, then AP, Coaches

export function fbsPolls(rankings: ESPNRanking[] | undefined): ESPNRanking[] {
    const byId = new Map((rankings ?? []).map((r) => [String(r.id), r]));
    return FBS_POLL_ORDER.map((id) => byId.get(id)).filter((r): r is ESPNRanking => !!r);
}

/**
 * Movement label for a rank row: newly ranked teams say NEW (previous 0 means
 * unranked, and ESPN's preseason trend strings are unreliable), risers and
 * fallers show a signed delta, holds show a dash.
 */
export function movement(entry: ESPNRankEntry): { label: string; dir: "up" | "down" | "flat" | "new" } {
    if (!entry.previous || entry.previous === 0) return { label: "NEW", dir: "new" };
    const delta = entry.previous - entry.current;
    if (delta > 0) return { label: `▲ ${delta}`, dir: "up" };
    if (delta < 0) return { label: `▼ ${-delta}`, dir: "down" };
    return { label: "—", dir: "flat" };
}

/** "Others receiving votes" as one compact line. */
export function othersLine(others: ESPNRankEntry[] | undefined): string {
    return (others ?? [])
        .map((o) => {
            const name = o.team?.location ?? o.team?.abbreviation ?? "?";
            return o.points != null ? `${name} ${o.points}` : name;
        })
        .join(", ");
}
