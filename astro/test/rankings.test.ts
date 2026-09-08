import { describe, expect, it } from "vitest";
import { fbsPolls, movement, othersLine } from "../src/utils/rankings";

const entry = (current: number, previous: number) => ({ current, previous, team: { id: "1" } });

describe("movement", () => {
    it("previously unranked is NEW regardless of trend string", () => {
        expect(movement(entry(12, 0)).dir).toBe("new");
    });
    it("riser shows positive delta", () => {
        expect(movement(entry(3, 7))).toEqual({ label: "▲ 4", dir: "up" });
    });
    it("faller shows negative delta", () => {
        expect(movement(entry(9, 5))).toEqual({ label: "▼ 4", dir: "down" });
    });
    it("hold is flat", () => {
        expect(movement(entry(4, 4)).dir).toBe("flat");
    });
});

describe("fbsPolls", () => {
    it("keeps CFP/AP/Coaches in order and drops FCS/DII polls", () => {
        const polls = [
            { id: "20", name: "FCS", ranks: [] },
            { id: "2", name: "Coaches", ranks: [] },
            { id: "1", name: "AP", ranks: [] },
            { id: "11", name: "DII", ranks: [] },
        ] as any;
        expect(fbsPolls(polls).map((p) => p.id)).toEqual(["1", "2"]);
    });
    it("puts CFP first once it exists", () => {
        const polls = [
            { id: "1", name: "AP", ranks: [] },
            { id: "21", name: "CFP", ranks: [] },
        ] as any;
        expect(fbsPolls(polls).map((p) => p.id)).toEqual(["21", "1"]);
    });
});

describe("othersLine", () => {
    it("joins team and points compactly", () => {
        expect(
            othersLine([
                { current: 0, previous: 0, points: 88, team: { id: "9", location: "Utah" } },
                { current: 0, previous: 0, team: { id: "8", location: "Tulane" } },
            ] as any),
        ).toBe("Utah 88, Tulane");
    });
    it("empty input is an empty string", () => {
        expect(othersLine(undefined)).toBe("");
    });
});
