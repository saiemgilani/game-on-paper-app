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

export function orderPlayers(rows: NbaPlayerRow[]): { starters: NbaPlayerRow[]; bench: NbaPlayerRow[]; dnp: NbaPlayerRow[] } {
    const byMin = (a: NbaPlayerRow, b: NbaPlayerRow) => (b.minutes ?? 0) - (a.minutes ?? 0)
    return {
        starters: rows.filter((r) => r.starter && !r.did_not_play).sort(byMin),
        bench: rows.filter((r) => !r.starter && !r.did_not_play).sort(byMin),
        dnp: rows.filter((r) => r.did_not_play),
    }
}

/** The football WinProbabilityChart reads period, pos_team and winProbability.before; feed it home WP as the home side's. */
export function wpChartPlays(game: NbaGame): { period: number; pos_team: string; winProbability: { before: number } }[] {
    return game.plays.filter((p) => p.homeWinProb != null).map((p) => ({ period: p.period, pos_team: game.home.team.id, winProbability: { before: p.homeWinProb! } }))
}

export function dash(v: number | null, fmt: (n: number) => string): string {
    return v == null || Number.isNaN(v) ? '–' : fmt(v)
}
