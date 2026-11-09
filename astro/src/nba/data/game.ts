// Selection and ordering for the game page. No arithmetic on stats lives here.
import type { NbaGame, NbaPlay, NbaPlayerRow } from '../../resources/nbaGame'

/**
 * Selection only. The first play's delta is measured from the pregame prior and a period-end or game-end row's
 * delta is the terminal settle, so none of them is a play that swung the game.
 */
export function biggestPlays(plays: NbaPlay[], n = 10): NbaPlay[] {
    const settle = (p: NbaPlay) => p.n === 1 || p.typeText === 'End Period' || p.typeText === 'End Game'
    return plays.filter((p) => p.wpDelta != null && !settle(p)).sort((a, b) => Math.abs(b.wpDelta!) - Math.abs(a.wpDelta!)).slice(0, n)
}

export function shotsOf(plays: NbaPlay[], teamId: number): NbaPlay[] {
    return plays.filter((p) => p.xLegacy != null && p.yLegacy != null && p.teamId === teamId)
}

const RIM = (p: NbaPlay) => p.xLegacy === 0 && p.yLegacy === 0

/**
 * ESPN's college feeds put a field goal they did not locate at the rim, (25, 0), legacy (0, 0) (plan #8 Decision 6). A layup,
 * dunk or tip there is a real rim attempt; a jump shot or a three there is not; and when at least half of a team's attempts in
 * the game sit there, ESPN located none of them (2025's whole-game placeholders; the per-team-game share is bimodal).
 * Selection only: the caller passes one team's attempts in one game (shotsOf).
 */
export function unlocatedShots(shots: readonly NbaPlay[]): ReadonlySet<NbaPlay> {
    const atRim = shots.filter(RIM)
    const whole = atRim.length > 0 && atRim.length * 2 >= shots.length
    return new Set(atRim.filter((p) => whole || /jump|three point/i.test(`${p.typeText ?? ''} ${p.text}`)))
}

export function orderPlayers(rows: NbaPlayerRow[]): { starters: NbaPlayerRow[]; bench: NbaPlayerRow[]; dnp: NbaPlayerRow[] } {
    const byMin = (a: NbaPlayerRow, b: NbaPlayerRow) => (b.minutes ?? 0) - (a.minutes ?? 0)
    return {
        starters: rows.filter((r) => r.starter && !r.did_not_play).sort(byMin),
        bench: rows.filter((r) => !r.starter && !r.did_not_play).sort(byMin),
        dnp: rows.filter((r) => r.did_not_play),
    }
}

/** The football WinProbabilityChart reads period, pos_team and winProbability.before; feed it home WP as the home side's. */
export function wpChartPlays(game: NbaGame): { period: number; pos_team: string; gameSpreadAvailable: boolean; winProbability: { before: number } }[] {
    const gameSpreadAvailable = game.prior?.gameSpreadAvailable ?? false
    return game.plays.filter((p) => p.homeWinProb != null).map((p) => ({ period: p.period, pos_team: game.home.team.id, gameSpreadAvailable, winProbability: { before: p.homeWinProb! } }))
}

export function dash(v: number | null, fmt: (n: number) => string): string {
    return v == null || Number.isNaN(v) ? '–' : fmt(v)
}
