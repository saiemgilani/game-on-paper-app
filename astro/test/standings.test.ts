import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { loadStandings, parseStandingsEntry, sortStandings } from "../src/utils/standings";

// Real ESPN `standings?group=` bodies, captured 2026-10-18 (see fixtures/README.md).
const capture = (league: string, g: string) =>
    JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/standings-${league}-${g}-2026.json.gz`, import.meta.url))).toString());
const CAPTURED: Record<string, string[]> = { cfb: ["8", "37"], nfl: ["8"] };
vi.mock("../src/resources/espn", () => ({
    retrieveConferenceStandings: async (g: string, league = "cfb") =>
        CAPTURED[league]?.includes(String(g)) ? capture(league, String(g)) : null,
}));

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

describe("loadStandings (cfb)", () => {
    it("renders the Sun Belt's East and West divisions, which carry its entries (#334)", async () => {
        // The SEC has its 16 teams on the group itself; the Sun Belt's group has
        // none -- they sit on its two division children (167 East, 168 West).
        const groups = await loadStandings("cfb");
        expect(groups.map((g) => [g.groupId, g.name, g.rows.length])).toEqual([
            ["8", "Southeastern Conference", 16],
            ["167", "Sun Belt - East", 7],
            ["168", "Sun Belt - West", 7],
        ]);
        expect(groups[1].rows.map((r) => r.name)).toContain("James Madison");
        expect(groups[2].rows.map((r) => r.name)).toContain("Louisiana");
    });
});

describe("loadStandings (nfl)", () => {
    it("still flattens an NFL conference into its four divisions, full names kept", async () => {
        const groups = await loadStandings("nfl");
        expect(groups.map((g) => [g.groupId, g.shortName, g.rows.length])).toEqual([
            ["4", "AFC East", 4],
            ["12", "AFC North", 4],
            ["13", "AFC South", 4],
            ["6", "AFC West", 4],
        ]);
    });
});
