import { describe, expect, test } from "vitest";
import { defensiveBox, playerExtremes } from "../src/utils/defensiveBox";

const play = (text: string, def = 1, pos = 2) => ({ text, def_pos_team: def, pos_team: pos });

describe("defensiveBox", () => {
    test("credits a solo tackle to the only name in the parenthetical", () => {
        const box = defensiveBox([play("(10:20) #8 D.Stanley rush middle for 3 yards gain to the FSU36 (#1 D.Desir)")], 1);
        expect(box).toHaveLength(1);
        expect(box[0]).toMatchObject({ jersey: 1, name: "D.Desir", TOT: 1, SOLO: 1, AST: 0 });
    });

    test("splits a shared tackle into assists, never solos", () => {
        const box = defensiveBox([play("#26 J.Payne rush middle for 1 yard loss to the FSU42 (#16 G.Peterson; #8 B.Vislisel)")], 1);
        expect(box.map((r) => r.jersey).sort((a, b) => a - b)).toEqual([8, 16]);
        for (const r of box) expect(r).toMatchObject({ TOT: 1, SOLO: 0, AST: 1 });
    });

    test("a tackle for loss is shared, and a sack counts as one too", () => {
        const box = defensiveBox([play("#14 A.Daniels sacked for loss of 9 yards to the NMS25 (#16 G.Peterson, #14 S.Aupiu)")], 1);
        expect(box).toHaveLength(2);
        for (const r of box) expect(r).toMatchObject({ SACK: 0.5, TFL: 0.5 });
    });

    test("a run stopped behind the line is a TFL but not a sack", () => {
        const box = defensiveBox([play("#26 J.Payne rush middle for 4 yards loss to the TCU31 (#90 X.Lewis)")], 1);
        expect(box[0]).toMatchObject({ TFL: 1, SACK: 0 });
    });

    test("counts breakups, hurries and interceptions", () => {
        const box = defensiveBox(
            [
                play("#3 T.Hedden pass incomplete short right to #2 J.Jones thrown to NMS20 broken up by #13 D.Diggs"),
                play("#14 A.Daniels pass incomplete short left to #0 D.Robinson thrown to NMS41 QB hurried by #8 B.Vislisel"),
                play("#3 T.Hedden pass intercepted by #0 Q.Jones at FSU00, Touchback"),
            ],
            1,
        );
        expect(box.find((r) => r.jersey === 13)?.PBU).toBe(1);
        expect(box.find((r) => r.jersey === 8)?.QBH).toBe(1);
        expect(box.find((r) => r.jersey === 0)?.INT).toBe(1);
    });

    test("ignores the holder and long snapper on a kick", () => {
        const box = defensiveBox([play("#39 G.Panikowski field goal attempt from 43 yards GOOD (H: #87 C.Jula, LS: #48 C.Bowers)")], 1);
        expect(box).toHaveLength(0);
    });

    test("credits nobody on a play the penalty wiped", () => {
        const box = defensiveBox([play("#26 J.Payne rush left for 6 yards gain to the TCU50 (#1 D.Desir) PENALTY NMS Holding. NO PLAY")], 1);
        expect(box).toHaveLength(0);
    });

    test("only credits the defending team, and returns nothing for older text", () => {
        const p = play("#26 J.Payne rush middle for 3 yards (#1 D.Desir)");
        expect(defensiveBox([p], 99)).toHaveLength(0);
        expect(defensiveBox([play("Sam Hicks run for 4 yds to the ACU 36")], 1)).toHaveLength(0);
    });

    test("resolves jersey numbers to roster names, falling back to the text", () => {
        const p = [play("#5 A.Back rush middle for 2 yards gain to the UNC30 (#1 D.Desir)")];
        expect(defensiveBox(p, 1)[0].name).toBe("D.Desir");
        const roster = (jersey: number, short: string) => (jersey === 1 ? "Mandrell Desir" : short);
        expect(defensiveBox(p, 1, roster)[0]).toMatchObject({ jersey: 1, name: "Mandrell Desir" });
    });
});

describe("playerExtremes", () => {
    const plays = [
        { rusher_player_name: 7, EPA: 0.4, wpa: 0.01, yds_rushed: 5 },
        { rusher_player_name: 7, EPA: 2.1, wpa: 0.09, yds_rushed: 22 },
        { rusher_player_name: 7, EPA: -1.2, wpa: -0.04, yds_rushed: -3 },
        { rusher_player_name: 9, EPA: 0.2, wpa: 0.0, yds_rushed: -2 },
    ];

    test("takes the best single play by EPA and WPA and the longest gain", () => {
        const m = playerExtremes(plays, "rusher_player_name", "yds_rushed");
        expect(m.get("7")).toEqual({ EPA_MAX: 2.1, WPA_MAX: 0.09, LNG: 22 });
    });

    test("a longest of less than zero prints as zero", () => {
        const m = playerExtremes(plays, "rusher_player_name", "yds_rushed");
        expect(m.get("9")?.LNG).toBe(0);
    });

    test("skips plays with no player on them", () => {
        const m = playerExtremes([{ rusher_player_name: null, EPA: 9 }, ...plays], "rusher_player_name");
        expect(m.size).toBe(2);
        expect(m.get("7")?.LNG).toBeNull();
    });
});
