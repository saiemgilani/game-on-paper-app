/**
 * Monotonic guard against ESPN serving a stale mid-game payload.
 *
 * Observed in production (see docs/game-state-fixtures.md): ESPN intermittently
 * returns an older payload than the one it served moments earlier. Game
 * 401866532 went q4/138 plays -> q3/103 plays -> q4/138 within a few minutes.
 * Across one evening of captured FCS games, 64 of 229 state transitions
 * regressed. Rendered, that is a score counting backwards and drives
 * disappearing while someone is watching.
 *
 * Within a single game, period and play count are strictly non-decreasing --
 * there is no lawful way for either to shrink. Score is NOT: officials do take
 * points off after a review. So a drop in period or play count is treated as a
 * stale payload, while a score-only drop is allowed through as a correction.
 * Of the 64 regressions captured, 61 involved period or plays; only 4 were
 * score-only, which is the ambiguous case this deliberately permits.
 *
 * Pure module -- no astro:* or cloudflare imports -- so vitest can run it
 * directly against captured fixtures.
 */

export type GameState = {
    period: number;
    plays: number;
    scores: number[];
    completed: boolean;
    status: string;
};

export type RegressionVerdict = {
    regressed: boolean;
    reason: string | null;
};

/** Pull the monotonic signals out of an ESPN play-by-play payload. */
export function extractGameState(payload: any): GameState | null {
    const gp = payload?.gamepackageJSON;
    if (!gp) return null;
    const comp = gp.header?.competitions?.[0];
    if (!comp) return null;
    const status = comp.status ?? {};
    const drives = gp.drives ?? {};
    let plays = 0;
    for (const d of drives.previous ?? []) plays += (d?.plays ?? []).length;
    if (drives.current) plays += (drives.current.plays ?? []).length;
    return {
        period: Number(status.period) || 0,
        plays,
        scores: (comp.competitors ?? []).map((c: any) => Number(c?.score) || 0),
        completed: Boolean(status.type?.completed),
        status: String(status.type?.name ?? "UNKNOWN"),
    };
}

/**
 * Is `candidate` older than the best state already seen for this game?
 *
 * A payload claiming STATUS_SCHEDULED is exempt only while the game has not
 * yet shown any activity. Once kickoff has been seen, "scheduled" is itself a
 * regression -- captured twice (401867874, 401869128), and it renders the
 * pregame page over a game already under way.
 */
export function isRegression(candidate: GameState | null, highWater: GameState | null): RegressionVerdict {
    if (!candidate || !highWater) return { regressed: false, reason: null };
    const gameHasStarted = highWater.period > 0 || highWater.plays > 0 || highWater.completed;
    if (candidate.status === "STATUS_SCHEDULED") {
        return gameHasStarted
            ? { regressed: true, reason: `reverted to scheduled after kickoff (hw period ${highWater.period}, ${highWater.plays} plays)` }
            : { regressed: false, reason: null };
    }

    if (candidate.period < highWater.period) {
        return { regressed: true, reason: `period ${highWater.period} -> ${candidate.period}` };
    }
    if (candidate.plays < highWater.plays) {
        return { regressed: true, reason: `plays ${highWater.plays} -> ${candidate.plays}` };
    }
    // A final payload must never be replaced by a non-final one.
    if (highWater.completed && !candidate.completed) {
        return { regressed: true, reason: `final -> ${candidate.status}` };
    }
    return { regressed: false, reason: null };
}

/** Element-wise maximum, so a transient dip never lowers the mark. */
export function mergeHighWater(highWater: GameState | null, state: GameState | null): GameState | null {
    if (!state) return highWater;
    if (!highWater) return state;
    return {
        period: Math.max(highWater.period, state.period),
        plays: Math.max(highWater.plays, state.plays),
        scores: state.scores.map((s, i) => Math.max(s, highWater.scores[i] ?? 0)),
        completed: highWater.completed || state.completed,
        status: state.completed ? state.status : (highWater.completed ? highWater.status : state.status),
    };
}

/** Prefer whichever payload is further along; used to pick between a fetch and its retry. */
export function pickFresher<T>(a: { state: GameState | null; payload: T },
                               b: { state: GameState | null; payload: T }): { state: GameState | null; payload: T } {
    if (!a.state) return b;
    if (!b.state) return a;
    if (b.state.period !== a.state.period) return b.state.period > a.state.period ? b : a;
    if (b.state.plays !== a.state.plays) return b.state.plays > a.state.plays ? b : a;
    return b.state.completed && !a.state.completed ? b : a;
}
