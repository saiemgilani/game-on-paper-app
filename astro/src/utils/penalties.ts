/**
 * Penalties split by unit, the way an official book presents them.
 *
 * ESPN carries `penalty_side` ("off"/"def") but leaves it null on some flags -- 2 of 11
 * in the reference game -- so the unit is derived from possession instead: the penalised
 * team either had the ball or did not. Where ESPN does fill `penalty_side` the derivation
 * agrees with it on every flag in that game, so the derived value is used throughout
 * rather than switching rules midway.
 *
 * A kick outranks both: a hold on a punt return is a special-teams penalty even though
 * the penalised team is nominally the defence.
 */

export type PenaltyUnit = "offense" | "defense" | "specialTeams";

interface PlayLike {
    penalty_flag?: boolean | null;
    penalized_team?: number | string | null;
    penalty_team_id?: number | string | null;
    pos_team?: number | string | null;
    penalty_detail?: string | null;
    penalty_text?: string | null;
    yds_penalty?: number | string | null;
    penalty_declined?: boolean | null;
    penalty_offset?: boolean | null;
    penalty_no_play?: boolean | null;
    first_down_penalty?: boolean | null;
    sp?: boolean | null;
    kickoff_play?: boolean | null;
    punt_play?: boolean | null;
    fg_attempt?: boolean | null;
    period?: number | null;
    [k: string]: unknown;
}

export interface PenaltyRow {
    unit: PenaltyUnit;
    detail: string;
    yards: number;
    declined: boolean;
    offsetting: boolean;
    negated: boolean;
    /** The penalty gave the other side an automatic first down. */
    firstDown: boolean;
    period: number | null;
    text: string;
}

export interface PenaltySplit {
    offense: PenaltyRow[];
    defense: PenaltyRow[];
    specialTeams: PenaltyRow[];
    /** Accepted only: a declined or offsetting flag costs nobody yards. */
    counts: Record<PenaltyUnit | "total", { n: number; yards: number }>;
    declined: number;
    offsetting: number;
    /** Most frequent infractions, accepted only, commonest first. */
    common: { detail: string; n: number; yards: number }[];
}

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/** "-5" and 5 alike become 5: a penalty's yardage is what it moved the ball, unsigned. */
const yards = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
    return Number.isFinite(n) ? Math.abs(n) : 0;
};

export function penaltiesFor(plays: PlayLike[], teamId: number | string): PenaltySplit {
    const empty = () => ({ n: 0, yards: 0 });
    const out: PenaltySplit = {
        offense: [], defense: [], specialTeams: [],
        counts: { offense: empty(), defense: empty(), specialTeams: empty(), total: empty() },
        declined: 0, offsetting: 0, common: [],
    };

    for (const p of plays) {
        if (p.penalty_flag !== true) continue;
        const on = p.penalized_team ?? p.penalty_team_id;
        if (!same(on, teamId)) continue;

        const kick = p.sp === true || p.kickoff_play === true || p.punt_play === true || p.fg_attempt === true;
        const unit: PenaltyUnit = kick ? "specialTeams" : same(on, p.pos_team) ? "offense" : "defense";
        const row: PenaltyRow = {
            unit,
            detail: (p.penalty_detail || "Penalty").trim(),
            yards: yards(p.yds_penalty),
            declined: p.penalty_declined === true,
            offsetting: p.penalty_offset === true,
            negated: p.penalty_no_play === true,
            firstDown: p.first_down_penalty === true,
            period: p.period ?? null,
            text: (p.penalty_text || "").trim(),
        };
        out[unit].push(row);
        if (row.declined) out.declined++;
        else if (row.offsetting) out.offsetting++;
        else {
            out.counts[unit].n++;
            out.counts[unit].yards += row.yards;
            out.counts.total.n++;
            out.counts.total.yards += row.yards;
        }
    }

    const tally = new Map<string, { detail: string; n: number; yards: number }>();
    for (const r of [...out.offense, ...out.defense, ...out.specialTeams]) {
        if (r.declined || r.offsetting) continue;
        const e = tally.get(r.detail) ?? { detail: r.detail, n: 0, yards: 0 };
        e.n++; e.yards += r.yards;
        tally.set(r.detail, e);
    }
    out.common = [...tally.values()].sort((a, b) => b.n - a.n || b.yards - a.yards || a.detail.localeCompare(b.detail));
    return out;
}
