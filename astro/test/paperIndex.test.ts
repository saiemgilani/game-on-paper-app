import { describe, expect, it } from "vitest";
import { paperIndex, paperIndexInputsFromBox } from "../src/utils/paperIndex";

describe("paperIndex", () => {
    it("splits a dead-even game 50/50", () => {
        const even = { epaPerPlay: 0.1, successRate: 0.45, explosiveRate: 0.12 };
        expect(paperIndex(even, even).homeShare).toBeCloseTo(0.5, 10);
    });

    it("gives the dominant side a large but unpinned share", () => {
        const home = { epaPerPlay: 0.35, successRate: 0.52, explosiveRate: 0.16 };
        const away = { epaPerPlay: -0.05, successRate: 0.38, explosiveRate: 0.07 };
        const r = paperIndex(home, away);
        expect(r.homeShare).toBeGreaterThan(0.85);
        expect(r.homeShare).toBeLessThan(1);
    });

    it("is symmetric: swapping teams mirrors the share", () => {
        const a = { epaPerPlay: 0.2, successRate: 0.5, explosiveRate: 0.14 };
        const b = { epaPerPlay: 0.05, successRate: 0.41, explosiveRate: 0.1 };
        expect(paperIndex(a, b).homeShare + paperIndex(b, a).homeShare).toBeCloseTo(1, 10);
    });

    it("reports the margins it used", () => {
        const r = paperIndex(
            { epaPerPlay: 0.3, successRate: 0.5, explosiveRate: 0.15 },
            { epaPerPlay: 0.1, successRate: 0.4, explosiveRate: 0.1 },
        );
        expect(r.epaMargin).toBeCloseTo(0.2);
        expect(r.successMargin).toBeCloseTo(0.1);
        expect(r.explosiveMargin).toBeCloseTo(0.05);
    });
});

describe("paperIndexInputsFromBox", () => {
    it("reads EPA/explosive from team and success from situational", () => {
        const inputs = paperIndexInputsFromBox(
            { EPA_per_play: 0.21, EPA_explosive_rate: 0.13 },
            { EPA_success_rate: 0.47 },
        );
        expect(inputs).toEqual({ epaPerPlay: 0.21, successRate: 0.47, explosiveRate: 0.13 });
    });

    it("fails open on missing records or fields", () => {
        expect(paperIndexInputsFromBox(null, { EPA_success_rate: 0.4 })).toBeNull();
        expect(paperIndexInputsFromBox({ EPA_per_play: 0.2 }, null)).toBeNull();
        expect(paperIndexInputsFromBox({ EPA_per_play: 0.2, EPA_explosive_rate: null }, { EPA_success_rate: 0.4 })).toBeNull();
    });
});
