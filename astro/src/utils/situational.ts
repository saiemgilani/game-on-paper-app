/**
 * Situational splits, recomputed per period.
 *
 * The advanced box carries these for the whole game only, so asking "how did
 * they do in the third quarter" means recomputing. Everything here sums the
 * SAME per-play flags the Python summed, which makes the full-game split
 * provably identical to `advBoxScore.situational` -- a test asserts exactly
 * that, and the period splits inherit the trust.
 *
 * The one definition that is easy to miss: these metrics count only plays from
 * scrimmage. Including penalties and special teams runs the success counts
 * about 20% high.
 */

interface PlayLike {
    pos_team?: number | string | null;
    period?: number | null;
    EPA?: number | null;
    /** Null on anything that is not a play from scrimmage. */
    EPA_scrimmage?: number | null;
    [k: string]: unknown;
}

export interface SituationalRow {
    label: string;
    /** Count, with its rate where a rate means something. */
    value: string;
    /** EPA per play over the plays this row counts. */
    epa: number | null;
    title: string;
}

/**
 * A play from scrimmage -- the population every situational metric uses.
 *
 * Typed on the one field it reads so it accepts both the loose play shape here
 * and the closed `ProcessedPlay` interface, which has no index signature.
 */
export const isScrimmage = (p: { EPA_scrimmage?: number | null }) =>
    p.EPA_scrimmage !== undefined && p.EPA_scrimmage !== null;

const same = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");
const pct = (n: number, d: number) => (d > 0 ? ` (${Math.round((n / d) * 100)}%)` : "");
const perPlay = (xs: PlayLike[]) => (xs.length ? xs.reduce((t, p) => t + (Number(p.EPA) || 0), 0) / xs.length : null);

/**
 * Named period splits, in the order they should be offered.
 *
 * Halves and quarters both appear because they answer different questions: a
 * half is how a team came out of the locker room, a quarter is when a game got
 * away. Overtime is offered only when it was played.
 */
export function periodSplits(plays: PlayLike[]): { key: string; label: string; plays: PlayLike[] }[] {
    const inPeriod = (p: PlayLike, ...ns: number[]) => ns.includes(Number(p.period));
    const periods = [...new Set(plays.map((p) => Number(p.period)).filter(Number.isFinite))].sort((a, b) => a - b);
    const splits = [
        { key: "all", label: "Full game", plays },
        { key: "h1", label: "1st half", plays: plays.filter((p) => inPeriod(p, 1, 2)) },
        { key: "h2", label: "2nd half", plays: plays.filter((p) => inPeriod(p, 3, 4)) },
        ...periods
            .filter((n) => n <= 4)
            .map((n) => ({ key: `q${n}`, label: `Q${n}`, plays: plays.filter((p) => inPeriod(p, n)) })),
    ];
    const ot = periods.filter((n) => n > 4);
    if (ot.length) splits.push({ key: "ot", label: "OT", plays: plays.filter((p) => Number(p.period) > 4) });
    // A period with no snaps is not worth a button. It has to be scrimmage
    // snaps, not merely plays: a quarter holding only a kickoff, a punt or a
    // penalty would otherwise offer a button onto a table of zeroes, since
    // every metric below counts from-scrimmage plays only.
    return splits.filter((s) => s.plays.some(isScrimmage));
}

/** The situational picture for one team over one set of plays. */
export function situationalRows(plays: PlayLike[], teamId: number | string): SituationalRow[] {
    const own = plays.filter((p) => same(p.pos_team, teamId) && isScrimmage(p));
    const on = (flag: string) => own.filter((p) => p[flag] === true);

    /** "24 (41%)" over the whole population, with EPA per play. */
    const group = (label: string, flag: string, successFlag: string, title: string): SituationalRow => {
        const xs = on(flag);
        const made = xs.filter((p) => p[successFlag] === true);
        return { label, value: `${xs.length}${pct(made.length, xs.length)}`, epa: perPlay(xs), title };
    };

    const success = on("EPA_success");
    return [
        {
            label: "Plays from scrimmage",
            value: String(own.length),
            epa: perPlay(own),
            title: "Runs and pass attempts, including sacks. Penalties and special teams are excluded, the way every metric below counts them.",
        },
        {
            label: "Success rate",
            value: `${success.length}${pct(success.length, own.length)}`,
            epa: perPlay(success),
            title: "A play that gained enough of the yards needed for its down. The EPA column is over the successful plays only.",
        },
        group("Passing", "pass", "EPA_success_pass", "Dropbacks: pass attempts plus sacks, which is why this runs ahead of attempts. Share successful, and EPA per dropback."),
        group("Rushing", "rush", "EPA_success_rush", "Carries, with the share that were successful, and EPA per carry."),
        group("Early downs", "early_down", "EPA_success_early_down", "First and second down: the plays a team chooses freely."),
        group("Late downs", "late_down", "EPA_success_late_down", "Third and fourth down, where the defence knows what is coming."),
        group("Standard downs", "standard_down", "EPA_success_standard_down", "Down and distance that keeps the whole playbook open."),
        group("Passing downs", "passing_down", "EPA_success_passing_down", "2nd and 8 or more, 3rd or 4th and 5 or more."),
        group("Middle 8", "middle_8", "EPA_middle_8_success", "The last four minutes of the first half and the first four of the second -- the swing that decides a lot of games."),
    ];
}
