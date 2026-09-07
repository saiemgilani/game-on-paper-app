/**
 * Paper Index: who won this game on paper?
 *
 * A single postgame (or live, so-far) share per team in [0, 1], from the three
 * margins that describe sustained performance rather than bounces: EPA per
 * play, success rate, and explosive-play rate. Turnover luck is deliberately
 * excluded -- a fumble bounce changes the score, not who "won on paper", and
 * its EPA already shows up in the margins only through the plays themselves.
 *
 * The logistic squash keeps a dead-even game at 50/50 and a dominant one
 * around 90/10 without ever pinning to 0 or 100.
 */

export interface PaperIndexInputs {
    epaPerPlay: number
    successRate: number
    explosiveRate: number
}

export interface PaperIndexResult {
    /** home team's share of the game "on paper", 0..1 */
    homeShare: number
    /** the margins that produced it, for the explainer line */
    epaMargin: number
    successMargin: number
    explosiveMargin: number
}

// ponytail: hand-tuned v1 weights (typical margins: EPA ±0.3, success ±0.15,
// explosiveness ±0.10); refit against a season of finals when the metric ships
const W_EPA = 4.0;
const W_SUCCESS = 5.0;
const W_EXPLOSIVE = 3.0;

export function paperIndex(home: PaperIndexInputs, away: PaperIndexInputs): PaperIndexResult {
    const epaMargin = home.epaPerPlay - away.epaPerPlay;
    const successMargin = home.successRate - away.successRate;
    const explosiveMargin = home.explosiveRate - away.explosiveRate;
    const z = W_EPA * epaMargin + W_SUCCESS * successMargin + W_EXPLOSIVE * explosiveMargin;
    const homeShare = 1 / (1 + Math.exp(-z));
    return { homeShare, epaMargin, successMargin, explosiveMargin };
}

/**
 * Pull the inputs out of the advBoxScore sections for one team: EPA_per_play
 * and EPA_explosive_rate live on the `team` record, EPA_success_rate on the
 * `situational` record. Null when either record or any field is absent.
 */
export function paperIndexInputsFromBox(teamRec: any, situationalRec: any): PaperIndexInputs | null {
    if (!teamRec || !situationalRec) return null;
    const raw = [teamRec.EPA_per_play, teamRec.EPA_explosive_rate, situationalRec.EPA_success_rate];
    if (raw.some((v) => v == null)) return null; // Number(null) is 0, not NaN
    const [epa, explosive, success] = raw.map(Number);
    if (![epa, success, explosive].every(Number.isFinite)) return null;
    return { epaPerPlay: epa, successRate: success, explosiveRate: explosive };
}
