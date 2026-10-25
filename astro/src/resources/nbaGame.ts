// One game, one shape, two sources. The adapters rename and group; the numbers are Python's
// (sportsdataverse.nba.nba_game_page), live through the processor or nightly through sdv-db.
import type { ESPNGameHeader } from './espn';
import { regulationFor, type PeriodKind, type Regulation } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import { wnbaEraTricode } from '../nba/data/wnbaTeams';

/** A count the source did not report stays null; the page renders a dash, never an invented 0. */
export interface NbaTeamBox {
    team_id: number | null; team_score: number | null; field_goals_made: number | null; field_goals_attempted: number | null
    three_point_field_goals_made: number | null; three_point_field_goals_attempted: number | null
    free_throws_made: number | null; free_throws_attempted: number | null
    offensive_rebounds: number | null; defensive_rebounds: number | null; total_rebounds: number | null
    assists: number | null; steals: number | null; blocks: number | null; turnovers: number | null; team_turnovers: number | null; total_turnovers: number | null; fouls: number | null
    fast_break_points: string | null; points_in_paint: string | null; largest_lead: string | null
}

/** A rate that cannot be computed (a zero denominator) stays null; the page renders a dash, never 0 or NaN. */
export interface NbaTeamRates {
    efg_pct: number | null; tov_pct: number | null; orb_pct: number | null; ft_rate: number | null
    possessions: number | null; off_rtg: number | null; def_rtg: number | null; pace: number | null
    total_turnovers: number | null; game_minutes: number | null
}

export interface NbaPlayerRow {
    athlete_id: number; name: string; short_name: string | null; headshot: string | null; position: string | null; jersey: string | null
    starter: boolean; did_not_play: boolean; reason: string | null; ejected: boolean
    minutes: number | null; points: number | null; rebounds: number | null; assists: number | null
    steals: number | null; blocks: number | null; turnovers: number | null
    fg: string; fg3: string; ft: string; plus_minus: string | null; ts_pct: number | null; usg_pct: number | null
}

export interface NbaPlay {
    id: string; n: number; period: number; clock: string; secondsRemaining: number | null
    homeScore: number; awayScore: number; teamId: number | null; text: string; typeText: string | null
    scoringPlay: boolean; scoreValue: number; shootingPlay: boolean; athleteId: number | null
    homeWinProb: number | null; wpDelta: number | null; wpRegime: 'reg' | 'ot'; xLegacy: number | null; yLegacy: number | null
}

export interface NbaSide {
    team: { id: string; abbreviation: string; displayName: string; location: string; name: string; color?: string | null; alternateColor?: string | null; logo?: string | null }
    score: number | null; winner: boolean; records: string | null; linescores: (number | null)[]
    box: NbaTeamBox | null; rates: NbaTeamRates | null; players: NbaPlayerRow[]
}

export interface NbaGame {
    id: string
    source: 'processor' | 'data_api'
    status: { name: string; completed: boolean; period: number | null; displayClock: string | null; detail: string | null }
    date: string
    venue: string | null
    periods: number
    /** the season's END year (ESPN header season.year / schedule season); picks the court and the regulation fallback */
    season: number | null
    /** regulation periods (4 quarters, 2 halves), from the game's own data, else its league's season rule */
    regulation: number
    periodKind: PeriodKind
    /** `homeTeamSpread` is a real line only when `gameSpreadAvailable`; otherwise it is the 2.5 default and the UI hides it. */
    /** null when the source has no win-probability rows to take a prior from; nothing is invented. */
    prior: { homeWinProb: number; source: PriorSource; homeTeamSpread: number | null; gameSpreadAvailable: boolean } | null
    home: NbaSide
    away: NbaSide
    plays: NbaPlay[]
    hasOvertime: boolean
}

/** What /nba/<id>/process returns (python/nba_game.py build_payload). */
export interface NbaProcessorPayload {
    gameId: number
    source: 'processor'
    header: ESPNGameHeader
    venue?: string | null
    teamInfo: { home: Record<string, any>; away: Record<string, any> }
    status: { name: string; completed: boolean; period: number | null; display_clock: string | null; detail: string | null }
    prior: { home_win_prob: number; source: PriorSource; home_team_spread: number | null; game_spread_available: boolean }
    periods: number
    regulation_periods?: number | null
    teams: Record<'home' | 'away', { team_id: number; box: Record<string, any> | null; rates: Record<string, any> | null; linescores: (number | null)[] }>
    players: Record<'home' | 'away', Record<string, any>[]>
    plays: Record<string, any>[]
}

/** sdv-py's prior source: a real line ('spread'), a lineless neutral site ('neutral', prior 0.5) or the league's home-court edge ('hfa'). */
export type PriorSource = 'spread' | 'hfa' | 'neutral';
export function priorSource(v: unknown): PriorSource {
    return v === 'spread' || v === 'neutral' ? v : 'hfa';
}

/** The seven Data API reads for one game (resources/nbaGames.ts). */
export interface DataApiGameRows {
    schedule: Record<string, any>[]; pbp: Record<string, any>[]; team_box: Record<string, any>[]; player_box: Record<string, any>[]
    play_wp: Record<string, any>[]; game_team_rates: Record<string, any>[]; game_player_rates: Record<string, any>[]
}

/** A Data API boolean: the warehouse can hand one back as the string 'True'/'true', which `=== true` would read as false. */
export const isTrue = (v: unknown): boolean => v === true || v === 'True' || v === 'true';
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** The regulation an ingested game was played to: the schedule's format_regulation_periods, else the season rule. */
export function scheduleRegulation(row: Record<string, any> | undefined, league: BasketballLeague): Regulation {
    return regulationFor(league, num(row?.season), row?.format_regulation_periods)
}

/** The periods an ingested final must have plays in: its regulation, or more when the schedule says it went to overtime. */
export function requiredPeriods(row: Record<string, any> | undefined, regulation: number): number {
    return Math.max(regulation, Number(row?.status_period ?? regulation) || regulation)
}
const pair = (m: unknown, a: unknown): string => (num(m) == null || num(a) == null ? '–' : `${num(m)}-${num(a)}`) // a missing count is a dash, never 0-0

/**
 * The schedule's list columns reach the Data API as Python reprs (single quotes, newline separators, no commas),
 * not JSON, so JSON.parse throws. Take every displayValue in order (a period without a number is null, so the
 * periods after it do not shift); real JSON matches the same pattern.
 */
export function parseLinescores(raw: unknown): (number | null)[] {
    if (Array.isArray(raw)) return raw.map((l) => num(l?.displayValue ?? l?.value))
    return [...String(raw ?? '').matchAll(/displayValue['"]?\s*:\s*(?:'([^']*)'|"([^"]*)"|([^,}\s]+))/g)].map((m) => num(m[1] ?? m[2] ?? m[3]))
}

/** The overall record ("41-41") out of the schedule's records column (repr or JSON): the `total` entry, else the first. */
export function parseRecord(raw: unknown): string | null {
    if (Array.isArray(raw)) return (raw.find((r) => r?.type === 'total') ?? raw[0])?.summary ?? null
    const blocks = String(raw ?? '').match(/\{[^{}]*\}/g) ?? []
    const block = blocks.find((b) => /type['"]?\s*:\s*['"]total['"]/.test(b)) ?? blocks[0]
    return block?.match(/summary['"]?\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? null
}

function teamBox(r: Record<string, any> | null | undefined): NbaTeamBox | null {
    if (!r) return null
    const n = (k: string) => num(r[k])
    return {
        team_id: n('team_id'), team_score: n('team_score'), field_goals_made: n('field_goals_made'), field_goals_attempted: n('field_goals_attempted'),
        three_point_field_goals_made: n('three_point_field_goals_made'), three_point_field_goals_attempted: n('three_point_field_goals_attempted'),
        free_throws_made: n('free_throws_made'), free_throws_attempted: n('free_throws_attempted'), offensive_rebounds: n('offensive_rebounds'),
        defensive_rebounds: n('defensive_rebounds'), total_rebounds: n('total_rebounds'), assists: n('assists'), steals: n('steals'), blocks: n('blocks'),
        turnovers: n('turnovers'), team_turnovers: n('team_turnovers'), total_turnovers: n('total_turnovers'), fouls: n('fouls'),
        fast_break_points: r.fast_break_points ?? null, points_in_paint: r.points_in_paint ?? null, largest_lead: r.largest_lead ?? null,
    }
}

function teamRates(r: Record<string, any> | null | undefined): NbaTeamRates | null {
    if (!r) return null
    return {
        efg_pct: num(r.efg_pct), tov_pct: num(r.tov_pct), orb_pct: num(r.orb_pct), ft_rate: num(r.ft_rate), possessions: num(r.possessions),
        off_rtg: num(r.off_rtg), def_rtg: num(r.def_rtg), pace: num(r.pace), total_turnovers: num(r.total_turnovers), game_minutes: num(r.game_minutes),
    }
}

function playerRow(r: Record<string, any>): NbaPlayerRow {
    return {
        athlete_id: num(r.athlete_id) ?? 0, name: r.athlete_display_name ?? '', short_name: r.athlete_short_name ?? null, headshot: r.athlete_headshot_href ?? null,
        position: r.athlete_position_abbreviation ?? null, jersey: r.athlete_jersey ?? null, starter: isTrue(r.starter), did_not_play: isTrue(r.did_not_play),
        reason: isTrue(r.did_not_play) ? (r.reason ?? null) : null, ejected: isTrue(r.ejected), minutes: num(r.minutes), points: num(r.points), rebounds: num(r.rebounds),
        assists: num(r.assists), steals: num(r.steals), blocks: num(r.blocks), turnovers: num(r.turnovers),
        fg: pair(r.field_goals_made, r.field_goals_attempted), fg3: pair(r.three_point_field_goals_made, r.three_point_field_goals_attempted), ft: pair(r.free_throws_made, r.free_throws_attempted),
        plus_minus: r.plus_minus == null ? null : String(r.plus_minus), ts_pct: num(r.ts_pct), usg_pct: num(r.usg_pct),
    }
}

/** `wp` carries the win-probability columns: the same row for the processor, the `play_wp` row for the Data API. */
function play(r: Record<string, any>, wp: Record<string, any> | undefined = r): NbaPlay {
    return {
        id: String(r.id), n: num(r.game_play_number) ?? 0, period: num(r.period_number) ?? 0, clock: r.clock_display_value ?? '',
        secondsRemaining: num(r.start_game_seconds_remaining), homeScore: num(r.home_score) ?? 0, awayScore: num(r.away_score) ?? 0, teamId: num(r.team_id),
        text: r.text ?? '', typeText: r.type_text ?? null, scoringPlay: isTrue(r.scoring_play), scoreValue: num(r.score_value) ?? 0, shootingPlay: isTrue(r.shooting_play),
        athleteId: num(r.athlete_id_1), homeWinProb: num(wp?.home_win_prob), wpDelta: num(wp?.wp_delta), wpRegime: wp?.wp_regime === 'ot' ? 'ot' : 'reg',
        xLegacy: num(wp?.x_legacy), yLegacy: num(wp?.y_legacy),
    }
}

/** ESPN's abbreviation, except a WNBA franchise's tricode of that season where it differs (DET for id 3 in 2005, not ESPN's TUL). */
const eraAbbreviation = (league: BasketballLeague, id: unknown, season: number | null, abbr: string): string =>
    (league === 'wnba' ? wnbaEraTricode(Number(id), season) : undefined) ?? abbr

/**
 * R-W16: "not recorded" read from the data, not from a season constant. Early college boxes (ESPN's 2008 WBB box, D12) send 0
 * for counts nobody kept. A final in which every player who has a minutes value shows 0 recorded no minutes; a team whose box
 * says 0 turnovers while sdv-py nulled its rates' total_turnovers (the D12 signal) recorded no turnovers. Those become null, so
 * the page shows a dash. No NBA, WNBA or MBB fixture matches either signature (test/wbb/game.render.test.ts pins the 2008 game).
 */
function blankUnrecorded(g: NbaGame): NbaGame {
    if (!g.status.completed) return g // a live game at the tip really has 0 minutes and 0 turnovers
    const mins = [g.home, g.away].flatMap((s) => s.players.map((p) => p.minutes)).filter((m) => m != null)
    const noMinutes = mins.length > 0 && mins.every((m) => m === 0)
    for (const s of [g.home, g.away]) {
        const noTurnovers = s.box?.total_turnovers === 0 && s.rates?.total_turnovers == null
        if (noTurnovers) s.box = { ...s.box!, turnovers: null, team_turnovers: null, total_turnovers: null }
        if (noMinutes || noTurnovers) s.players = s.players.map((p) => ({ ...p, minutes: noMinutes ? null : p.minutes, turnovers: noTurnovers ? null : p.turnovers }))
    }
    return g
}

export function fromProcessor(j: NbaProcessorPayload, league: BasketballLeague): NbaGame {
    const comp = j.header.competitions[0]
    const season = j.header?.season?.year ?? null
    const side = (ha: 'home' | 'away'): NbaSide => {
        const c = comp.competitors.find((x) => x.homeAway === ha)!
        const t = j.teams[ha]
        const ti = j.teamInfo[ha]
        const record = c.record?.find((x) => x.type === 'total') ?? c.record?.[0]
        return {
            team: { id: String(ti.id), abbreviation: eraAbbreviation(league, ti.id, season, ti.abbreviation), displayName: ti.displayName, location: ti.location, name: ti.name, color: ti.color ?? null, alternateColor: ti.alternateColor ?? null, logo: ti.logos?.[0]?.href ?? null },
            score: num(c.score), winner: c.winner === true, records: record?.summary ?? null,
            linescores: t.linescores, box: teamBox(t.box), rates: teamRates(t.rates), players: j.players[ha].map(playerRow),
        }
    }
    const reg = regulationFor(league, season, j.regulation_periods)
    return blankUnrecorded({
        id: String(j.gameId), source: 'processor',
        status: { name: j.status.name, completed: j.status.completed, period: j.status.period, displayClock: j.status.display_clock, detail: j.status.detail },
        date: comp.date, venue: j.venue ?? null, periods: j.periods, season, regulation: reg.periods, periodKind: reg.kind,
        prior: { homeWinProb: j.prior.home_win_prob, source: priorSource(j.prior.source), homeTeamSpread: j.prior.home_team_spread, gameSpreadAvailable: j.prior.game_spread_available },
        home: side('home'), away: side('away'), plays: j.plays.map((r) => play(r)), hasOvertime: j.periods > reg.periods,
    })
}

export function fromDataApi(rows: DataApiGameRows, league: BasketballLeague): NbaGame {
    const s = rows.schedule[0]
    const wpByN = new Map(rows.play_wp.map((w) => [num(w.game_play_number), w]))
    const plays = [...rows.pbp].sort((a, b) => (num(a.game_play_number) ?? 0) - (num(b.game_play_number) ?? 0)).map((r) => play(r, wpByN.get(num(r.game_play_number))))
    const reg = scheduleRegulation(s, league)
    const periods = Math.max(reg.periods, ...plays.map((p) => p.period))
    const wp0 = rows.play_wp[0]
    const p0 = rows.pbp[0]
    const side = (ha: 'home' | 'away'): NbaSide => {
        const tid = num(s[`${ha}_id`])
        const prates = new Map(rows.game_player_rates.filter((p) => num(p.team_id) === tid).map((p) => [num(p.athlete_id), p]))
        return {
            team: { id: String(tid), abbreviation: eraAbbreviation(league, tid, num(s.season), s[`${ha}_abbreviation`]), displayName: s[`${ha}_display_name`], location: s[`${ha}_location`], name: s[`${ha}_name`], color: s[`${ha}_color`] ?? null, alternateColor: s[`${ha}_alternate_color`] ?? null, logo: s[`${ha}_logo`] ?? null },
            score: num(s[`${ha}_score`]), winner: isTrue(s[`${ha}_winner`]), records: parseRecord(s[`${ha}_records`]),
            linescores: parseLinescores(s[`${ha}_linescores`]),
            box: teamBox(rows.team_box.find((b) => num(b.team_id) === tid)), rates: teamRates(rows.game_team_rates.find((b) => num(b.team_id) === tid)),
            players: rows.player_box.filter((p) => num(p.team_id) === tid).map((p) => playerRow({ ...p, ...(prates.get(num(p.athlete_id)) ?? {}) })),
        }
    }
    return blankUnrecorded({
        id: String(s.id), source: 'data_api',
        status: { name: s.status_type_name, completed: isTrue(s.status_type_completed), period: num(s.status_period), displayClock: s.status_display_clock ?? null, detail: s.status_type_detail ?? null },
        date: s.date, venue: s.venue_full_name ?? null, periods, season: num(s.season), regulation: reg.periods, periodKind: reg.kind,
        prior: num(wp0?.pregame_home_prob) == null ? null : { homeWinProb: num(wp0.pregame_home_prob)!, source: priorSource(wp0.prior_source), homeTeamSpread: num(p0?.home_team_spread), gameSpreadAvailable: isTrue(p0?.game_spread_available) },
        home: side('home'), away: side('away'), plays, hasOvertime: periods > reg.periods,
    })
}
