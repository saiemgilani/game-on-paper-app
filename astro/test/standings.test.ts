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
            division: "",
            pointsFor: 48,
            pointsAgainst: 10,
            pointDifferential: "+38",
            streak: "W1",
            seed: 1,
        });
    });

    it("names an NFL team by its short name, since two share a city", () => {
        const jets = { ...entry, team: { id: "2", location: "New York", shortDisplayName: "Jets", abbreviation: "NYJ" } };
        expect(parseStandingsEntry(jets, "nfl").name).toBe("Jets");
        expect(parseStandingsEntry(jets, "cfb").name).toBe("New York");
    });
});

describe("sortStandings", () => {
    it("uses ESPN's seed only once the whole group is seeded", () => {
        const rows = [
            { seed: 2, overall: "1-0", conference: "0-0", division: "", name: "B" },
            { seed: 1, overall: "1-0", conference: "0-0", division: "", name: "A" },
            { seed: 3, overall: "0-1", conference: "0-0", division: "", name: "C" },
        ] as any[];
        expect(sortStandings(rows).map((r: any) => r.name)).toEqual(["A", "B", "C"]);
    });

    it("a partially seeded group falls back to the record, not the lone seed", () => {
        // AFC East, week 2 2026: ESPN seeded the only team that had played --
        // at 0-1 -- and left the 0-0 teams at 0. Seed-first put the loser on top.
        const rows = [
            { seed: 999, overall: "0-0", conference: "0-0", division: "0-0", name: "Bills" },
            { seed: 999, overall: "0-0", conference: "0-0", division: "0-0", name: "Dolphins" },
            { seed: 1, overall: "0-1", conference: "0-0", division: "0-0", name: "Patriots" },
        ] as any[];
        expect(sortStandings(rows, "nfl").map((r: any) => r.name)).toEqual(["Bills", "Dolphins", "Patriots"]);
    });

    it("counts an NFL tie as half a win in the fallback", () => {
        const rows = [
            { seed: 999, overall: "1-0-1", conference: "0-0", division: "0-0", name: "tied" },   // .750
            { seed: 999, overall: "1-1", conference: "0-0", division: "0-0", name: "even" },     // .500
            { seed: 999, overall: "0-0-1", conference: "0-0", division: "0-0", name: "onlyTie" }, // .500, not .000
            { seed: 999, overall: "0-1", conference: "0-0", division: "0-0", name: "lost" },     // .000
        ] as any[];
        expect(sortStandings(rows, "nfl").map((r: any) => r.name)).toEqual(["tied", "even", "onlyTie", "lost"]);
    });

    it("breaks ties on the league's own record: division for the NFL, conference for CFB", () => {
        const rows = [
            { seed: 999, overall: "2-1", conference: "1-1", division: "0-1", name: "confStrong" },
            { seed: 999, overall: "2-1", conference: "0-1", division: "1-0", name: "divStrong" },
        ] as any[];
        expect(sortStandings(rows, "nfl").map((r: any) => r.name)).toEqual(["divStrong", "confStrong"]);
        expect(sortStandings(rows, "cfb").map((r: any) => r.name)).toEqual(["confStrong", "divStrong"]);
    });
});
