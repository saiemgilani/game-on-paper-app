import { describe, expect, it } from "vitest";
import { parseStandingsEntry, sortStandings } from "../src/utils/standings";

// the real shape: repeated stat blocks, overall first, records named exactly
const entry = {
    team: { id: "333", location: "Alabama", abbreviation: "ALA", logos: [{ href: "x.png" }] },
    stats: [
        { name: "pointDifferential", displayValue: "+38" },
        { name: "pointsAgainst", displayValue: "10" },
        { name: "pointsFor", displayValue: "48" },
        { name: "streak", displayValue: "W1" },
        { name: "playoffSeed", displayValue: "1" },
        { name: "overall", displayValue: "1-0" },
        // Home block re-lists the same scalar names with block-local values
        { name: "pointsFor", displayValue: "999" },
        { name: "Home", displayValue: "1-0" },
        { name: "vs. Conf.", displayValue: "0-0" },
    ],
} as any;

describe("parseStandingsEntry", () => {
    it("takes scalars from the FIRST (overall) block and records by name", () => {
        const r = parseStandingsEntry(entry);
        expect(r).toEqual({
            teamId: "333",
            name: "Alabama",
            abbreviation: "ALA",
            logo: "x.png",
            overall: "1-0",
            conference: "0-0",
            pointsFor: 48,
            pointsAgainst: 10,
            pointDifferential: "+38",
            streak: "W1",
            seed: 1,
        });
    });
});

describe("sortStandings", () => {
    it("orders by seed, then conference win rate", () => {
        const rows = [
            { seed: 999, conference: "1-1", name: "B" },
            { seed: 1, conference: "0-0", name: "A" },
            { seed: 999, conference: "2-0", name: "C" },
        ] as any;
        expect(sortStandings(rows).map((r: any) => r.name)).toEqual(["A", "C", "B"]);
    });
});
