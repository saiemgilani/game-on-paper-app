import { getSecret } from "astro:env/server"
import type { ESPNBroadcast, ESPNCompetition, ESPNCompetitor, ESPNGameClock, ESPNGameHeader, ESPNGeoBroadcast, ESPNPlay, ESPNPlayTeam, ESPNPlayTeamParticipant, ESPNPlayType, ESPNSeason, ESPNStatus, ESPNTeam, ESPNWinProbability } from "./espn"

export enum SpiceLevel {
    BELL = 0,
    SERRANO,
    CAYENNE,
    GHOST,
    REAPER
}

export interface ProcessedModelInput {
    down: number
    distance: number
    yardsToEndzone: number
    TimeSecRem: number
    adj_TimeSecRem: number
    pos_score_diff: number
    posTeamTimeouts: number
    defTeamTimeouts: number
    ExpScoreDiff: number
    ExpScoreDiff_Time_Ratio: number
    spread_time: number
    pos_team_receives_2H_kickoff: number
    is_home: number
    period: number
}

export interface ProcessedAdvancedMetric {
    before: number
    after: number
    added: number
}

export interface ProcessedPlayState {
    team: { id: number, name?: string }
    pos_team: { id: number, name: string }
    def_pos_team: { id: number, name: string }
    down: number
    distance: number
    yardLine: number
    yardsToEndzone: number
    homeScore: number
    awayScore: number
    pos_team_score: number
    def_pos_team_score: number
    pos_score_diff: number
    posTeamTimeouts: number
    defPosTeamTimeouts: number
    ExpScoreDiff: number
    ExpScoreDiff_Time_Ratio: number
    shortDownDistanceText: string
    possessionText: string
    downDistanceText: string
    posTeamSpread?: number
}

export interface ProcessedModelInputs {
    start: ProcessedModelInput
    end: ProcessedModelInput
}

export interface ProcessedPlay {
  A_score_diff?: number
  EPA: number
  EPA_explosive: boolean
  EPA_explosive_pass: boolean
  EPA_explosive_rush: boolean
  EPA_fg?: number
  EPA_kickoff?: number
  EPA_middle_8_success: boolean
  EPA_middle_8_success_pass: boolean
  EPA_middle_8_success_rush: boolean
  EPA_non_explosive?: number
  EPA_pass?: number
  EPA_penalty?: number
  EPA_punt?: number
  EPA_rush?: number
  EPA_scrimmage?: number
  EPA_sp: number
  EPA_success: boolean
  EPA_success_EPA?: number
  EPA_success_early_down: boolean
  EPA_success_early_down_pass: boolean
  EPA_success_early_down_rush: boolean
  EPA_success_late_down: boolean
  EPA_success_late_down_pass: boolean
  EPA_success_late_down_rush: boolean
  EPA_success_pass: boolean
  EPA_success_pass_EPA?: number
  EPA_success_passing_down: boolean
  EPA_success_passing_down_EPA?: number
  EPA_success_rush: boolean
  EPA_success_rush_EPA: boolean
  EPA_success_standard_down: boolean
  EPA_success_standard_down_EPA?: number
  EP_between?: number
  EP_end: number
  EP_start: number
  EP_start_touchback: number
  HA_score_diff: number
  H_score_diff?: number
  TFL: boolean
  TFL_pass: boolean
  TFL_rush: boolean
  action_play: boolean
  adj_rush_yardage?: number
  assisted_by_player_id?: string
  assisted_by_player_name: string
  athlete_name: string
  awayScore: number
  awayTeamAbbrev: string
  awayTeamId: number
  awayTeamMascot: string
  awayTeamName: string
  awayTeamNameAlt: string
  awayTimeoutCalled: boolean
  away_wp_after: number
  away_wp_before: number
  change_of_pos_team: boolean
  change_of_poss: number
  cleaned_text: string
  clock: ESPNGameClock
  "clock.minutes": string
  "clock.seconds": string
  completion: boolean
  def_EPA: number
  def_pos_team: number
  def_pos_team_score: number
  def_pos_unit: string
  def_wp_after: number
  def_wp_before: number
  defense_score_play: boolean
  distance?: number
  down?: number
  down_1: boolean
  down_1_end: boolean
  down_2: boolean
  down_2_end: boolean
  down_3: boolean
  down_3_end: boolean
  down_4: boolean
  down_4_end: boolean
  downs_turnover: boolean
  "drive.description": string
  "drive.displayResult": string
  "drive.end.clock.displayValue"?: string
  "drive.end.period.number": number
  "drive.end.period.type": string
  "drive.end.yardLine": number
  "drive.id": string
  "drive.isScore": boolean
  "drive.offensivePlays": number
  "drive.result": string
  "drive.shortDisplayResult": string
  "drive.start.clock.displayValue": string
  "drive.start.period.number": number
  "drive.start.period.type": string
  "drive.start.text": string
  "drive.start.yardLine": number
  "drive.team.abbreviation": string
  "drive.team.displayName": string
  "drive.team.name": string
  "drive.team.shortDisplayName": string
  "drive.timeElapsed.displayValue": string
  "drive.yards": number
  drive_offense_plays: number
  drive_offense_yards: number
  drive_play_index: number
  drive_start: number
  drive_stopped: boolean
  drive_total_yards: number
  dropback: boolean
  early_down: boolean
  early_down_pass: boolean
  early_down_rush: boolean
  end: ProcessedPlayState
  "end.ExpScoreDiff": number
  "end.ExpScoreDiff_Time_Ratio": number
  "end.ExpScoreDiff_case"?: number
  "end.TimeSecsRem": number
  "end.adj_TimeSecsRem": number
  "end.awayScore": number
  "end.awayTeamTimeouts": number
  "end.defPosTeamTimeouts": number
  "end.def_pos_team.id": number
  "end.def_pos_team.name": string
  "end.def_pos_team_score": number
  "end.def_team.id": number
  "end.elapsed_share": number
  "end.homeScore": number
  "end.homeTeamTimeouts": number
  "end.is_home": boolean
  "end.pos_score_diff": number
  "end.pos_team.id": number
  "end.pos_team.name": string
  "end.pos_team_receives_2H_kickoff": boolean
  "end.pos_team_score": number
  "end.pos_team_spread": number
  "end.spread_time": number
  "end.team.id_missing": boolean
  "end.yard": number
  end_of_half: boolean
  end_state_missing: boolean
  expectedPoints: ProcessedAdvancedMetric
  fg_attempt: boolean
  fg_made: boolean
  firstHalfKickoffTeamId: number
  first_down_created: boolean
  forced_by_player_id?: string
  forced_by_player_name: string
  forced_fumble: boolean
  fumble_lost: boolean
  fumble_recovered: boolean
  fumble_vec: boolean
  fumbler_player_id?: string
  fumbler_player_name: string
  gameSpread: number
  gameSpreadAvailable: boolean
  game_complete: boolean
  game_id_x: number
  game_id_y?: number
  game_play_number: number
  half: string
  havoc: boolean
  highlight_run: boolean
  highlight_yards?: number
  homeFavorite: boolean
  homeScore: number
  homeTeamAbbrev: string
  homeTeamId: number
  homeTeamMascot: string
  homeTeamName: string
  homeTeamNameAlt: string
  homeTeamSpread: number
  homeTimeoutCalled: boolean
  home_wp_after: number
  home_wp_before: number
  id: number
  int: boolean
  int_td: boolean
  isPenalty: boolean
  isTurnover: boolean
  is_home: boolean
  kick_play: boolean
  kicker_player_id?: string
  kicker_player_name: string
  kickoff_downed: boolean
  kickoff_fair_catch: boolean
  kickoff_onside: boolean
  kickoff_oob: boolean
  kickoff_play: boolean
  kickoff_safety: boolean
  kickoff_tb: boolean
  kneel_down: boolean
  lag_EP_end?: number
  lag_HA_score_diff?: number
  lag_awayScore: number
  lag_change_of_pos_team: boolean
  lag_half?: string
  lag_homeScore: number
  lag_pos_score_diff: number
  lag_pos_team: number
  lag_scoringPlay?: boolean
  late_down: boolean
  late_down_pass: boolean
  late_down_rush: boolean
  lead_half: string
  lead_play_type?: string
  lead_pos_team?: number
  lead_pos_team2?: number
  lead_scoringPlay: boolean
  lead_start_distance: number
  lead_start_down: number
  lead_start_team: number
  lead_start_yardsToEndzone: number
  lead_text: string
  lead_wp_before?: number
  lead_wp_before2?: number
  line_yards?: number
  middle_8: boolean
  modelInputs: ProcessedModelInputs
  modified: string
  net_HA_score_pts?: number
  new_distance: number
  new_down: number
  non_fumble_sack: boolean
  offense_score_play: boolean
  open_field_yards?: number
  opp_highlight_yards?: number
  opportunity_run: boolean
  overUnder: number
  pass: boolean
  pass_attempt: boolean
  pass_breakup: boolean
  pass_defender_player_id?: string
  pass_defender_player_name: string
  pass_epa?: number
  pass_td: boolean
  pass_weight?: number
  passer_player_id?: string
  passer_player_name: string
  passing_down: boolean
  pat_scorer_player_id?: string
  pat_scorer_player_name: string
  pen_epa?: number
  pen_weight?: number
  penalized_player_id?: string
  penalized_player_name: string
  penalty_1st_conv: boolean
  penalty_assessed_on_kickoff: boolean
  penalty_declined: boolean
  penalty_detail?: string
  penalty_flag: boolean
  penalty_in_text: boolean
  penalty_no_play: boolean
  penalty_offset: boolean
  penalty_safety: boolean
  penalty_text?: string
  period: number
  "period.number": number
  play: boolean
  playType: string
  play_id: string
  "pointAfterAttempt.abbreviation"?: string
  "pointAfterAttempt.id"?: number
  "pointAfterAttempt.text"?: string
  "pointAfterAttempt.value"?: number
  pos_score_diff: number
  pos_score_diff_end: number
  pos_score_diff_start: number
  pos_score_pts: number
  pos_team: number
  pos_team_score: number
  pos_unit: string
  power_rush_attempt: boolean
  power_rush_success: boolean
  priority: boolean
  prog_drive_EPA?: number
  prog_drive_WPA: number
  punt: boolean
  punt_blocked: boolean
  punt_downed: boolean
  punt_fair_catch: boolean
  punt_oob: boolean
  punt_play: boolean
  punt_safety: boolean
  punt_tb: boolean
  punter_player_id?: string
  punter_player_name: string
  qbr_epa: number
  receiver_player_id?: string
  receiver_player_name: string
  recoverer_player_id?: string
  recoverer_player_name: string
  returner_player_id?: string
  returner_player_name: string
  rush: boolean
  rush_epa?: number
  rush_td: boolean
  rush_weight?: number
  rusher_player_id?: string
  rusher_player_name: string
  rz_play: boolean
  sack: boolean
  sack_epa?: number
  sack_vec: boolean
  sack_weight?: number
  sacked_by_player_id?: string
  sacked_by_player_name: string
  safety: boolean
  scorer_player_id?: string
  scorer_player_name: string
  scoringPlay: boolean
  scoring_opp: boolean
  scoring_play: boolean
  scrimmage_play: boolean
  season: number
  seasonType: number
  second_level_yards?: number
  sequenceNumber: string
  short_rush_attempt: boolean
  short_rush_success: boolean
  sp: boolean
  standard_down: boolean
  start: ProcessedPlayState
  "start.ExpScoreDiff": number
  "start.ExpScoreDiff_Time_Ratio": number
  "start.ExpScoreDiff_Time_Ratio_touchback": number
  "start.ExpScoreDiff_touchback": number
  "start.TimeSecsRem": number
  "start.adj_TimeSecsRem": number
  "start.awayScore": number
  "start.awayTeamTimeouts": number
  "start.defPosTeamTimeouts": number
  "start.def_pos_team.id": number
  "start.def_pos_team.name": string
  "start.def_pos_team_score": number
  "start.elapsed_share": number
  "start.homeScore": number
  "start.homeTeamTimeouts": number
  "start.is_home": boolean
  "start.pos_score_diff": number
  "start.pos_team.id": number
  "start.pos_team.name": string
  "start.pos_team_receives_2H_kickoff": boolean
  "start.pos_team_score": number
  "start.pos_team_spread": number
  "start.spread_time": number
  "start.yard": number
  "start.yardsToEndzone.touchback": number
  statYardage: number
  stopped_run: boolean
  stuffed_run: boolean
  tackler_player_id?: string
  tackler_player_name: string
  target: boolean
  td_check: boolean
  td_play: boolean
  teamParticipants: ESPNPlayTeamParticipant[]
  text: string
  text_dupe: boolean
  touchdown: boolean
  turnover_vec: boolean
  type: ESPNPlayType
  wallclock: string
  week: number
  weight: number
  winProbability: ProcessedAdvancedMetric
  wp_after: number
  wp_after_case?: number
  wp_before: number
  wp_touchback: number
  wpa: number
  yds_fg: any
  yds_fumble_return: any
  yds_int_return: any
  yds_kickoff: any
  yds_kickoff_return?: number
  yds_passing?: number
  yds_penalty?: number
  yds_punt_gained?: number
  yds_punt_return?: number
  yds_punted?: number
  yds_receiving?: number
  yds_receiving_case?: number
  yds_rushed?: number
  yds_sacked?: number
}

export interface ProcessedDrive {
    id: string
    description: string
    team: ESPNPlayTeam
    start: {
        period: { type: string, number: number }
        clock: ESPNGameClock
        yardLine: number
        text: string
    }
    end: {
        period: { type: string, number: number }
        clock: ESPNGameClock
        yardLine: number
        text: string
    }
    timeElapsed: { displayValue: string }
    yards: number
    isScore: boolean
    offensivePlays: number
    result: string
    shortDisplayResult: string
    displayResult: string
    plays: ProcessedPlay[]
}

export interface ProcessedBoxScore {
  defensive: ProcessedDefensiveBoxScore[]
  drives: ProcessedDriveBoxScore[]
  pass: ProcessedPassingBoxScore[]
  receiver: ProcessedReceivingBoxScore[]
  rush: ProcessedRushingBoxScore[]
  situational: ProcessedSituationalBoxScore[]
  team: ProcessedTeamBoxScore[]
  turnover: ProcessedTurnoverBoxScore[]
}

export interface ProcessedDefensiveBoxScore {
  TFL: number
  TFL_pass: number
  TFL_rush: number
  def_int: number
  def_pos_team: number
  drive_stopped_rate: number
  fumbles: number
  havoc_total: number
  havoc_total_pass: number
  havoc_total_pass_rate: number
  havoc_total_rate: number
  havoc_total_rush: number
  havoc_total_rush_rate: number
  num_pass_plays: number
  pass_breakups: number
  sacks: number
  sacks_rate: number
  scrimmage_plays: number
}

export interface ProcessedDriveBoxScore {
  avg_field_position: number
  drive_total_available_yards: number
  drive_total_gained_yards: number
  drive_total_gained_yards_rate: number
  drives: number
  plays_per_drive: number
  pos_team: number
  total_plays: number
  total_yards: number
  yards_per_drive: number
}

export interface ProcessedPassingBoxScore {
  Att: number
  Comp: number
  EPA: number
  EPA_per_Play: number
  Int: number
  Pass_TD: number
  SR: number
  Sck: number
  SckYds: number
  WPA: number
  YPA: number
  Yds: number
  athlete_name: string
  exp_qbr: number
  pass_epa: number
  passer_player_name: string
  pen_epa: number
  pos_team: number
  qbr_epa: number
  rush_epa: number
  sack_epa: number
  spread: number
}

export interface ProcessedReceivingBoxScore {
  EPA: number
  EPA_per_Play: number
  Fum: number
  Fum_Lost: number
  Rec: number
  Rec_TD: number
  SR: number
  Tar: number
  WPA: number
  YPT: number
  Yds: number
  pos_team: number
  receiver_player_name: string
}

export interface ProcessedRushingBoxScore {
  Car: number
  EPA: number
  EPA_per_Play: number
  Fum: number
  Fum_Lost: number
  Rush_TD: number
  SR: number
  WPA: number
  YPC: number
  Yds: number
  pos_team: number
  rusher_player_name: string
}

export interface ProcessedSituationalBoxScore {
  EPA_early_down: number
  EPA_early_down_pass: number
  EPA_early_down_pass_per_play: number
  EPA_early_down_per_play: number
  EPA_early_down_rush: number
  EPA_early_down_rush_per_play: number
  EPA_late_down: number
  EPA_late_down_pass: number
  EPA_late_down_pass_per_play: number
  EPA_late_down_per_play: number
  EPA_late_down_rush: number
  EPA_late_down_rush_per_play: number
  EPA_middle_8: number
  EPA_middle_8_pass: number
  EPA_middle_8_pass_per_play: number
  EPA_middle_8_per_play: number
  EPA_middle_8_rush: number
  EPA_middle_8_rush_per_play: number
  EPA_middle_8_success: number
  EPA_middle_8_success_pass: number
  EPA_middle_8_success_pass_rate: number
  EPA_middle_8_success_rate: number
  EPA_middle_8_success_rush: number
  EPA_middle_8_success_rush_rate: number
  EPA_passing_down: number
  EPA_passing_down_per_play: number
  EPA_standard_down: number
  EPA_standard_down_per_play: number
  EPA_success: number
  EPA_success_early_down: number
  EPA_success_early_down_pass: number
  EPA_success_early_down_pass_rate: number
  EPA_success_early_down_rate: number
  EPA_success_early_down_rush: number
  EPA_success_early_down_rush_rate: number
  EPA_success_late_down: number
  EPA_success_late_down_pass: number
  EPA_success_late_down_pass_rate: number
  EPA_success_late_down_rate: number
  EPA_success_late_down_rush: number
  EPA_success_late_down_rush_rate: number
  EPA_success_pass: number
  EPA_success_pass_rate: number
  EPA_success_passing_down: number
  EPA_success_passing_down_rate: number
  EPA_success_rate: number
  EPA_success_rate_rz: number
  EPA_success_rate_third: number
  EPA_success_rush: number
  EPA_success_rush_rate: number
  EPA_success_rz: number
  EPA_success_standard_down: number
  EPA_success_standard_down_rate: number
  EPA_success_third: number
  early_down_first_down: number
  early_down_first_down_rate: number
  early_down_pass: number
  early_down_pass_rate: number
  early_down_rush: number
  early_down_rush_rate: number
  early_downs: number
  late_down_avg_distance: number
  late_down_first_down: number
  late_down_first_down_rate: number
  late_down_pass: number
  late_down_pass_rate: number
  late_down_rush: number
  late_down_rush_rate: number
  late_downs: number
  middle_8: number
  middle_8_pass: number
  middle_8_pass_rate: number
  middle_8_rush: number
  middle_8_rush_rate: number
  pos_team: number
}

export interface ProcessedTeamBoxScore {
  EPA_explosive: number
  EPA_explosive_passing: number
  EPA_explosive_passing_rate: number
  EPA_explosive_rate: number
  EPA_explosive_rushing: number
  EPA_explosive_rushing_rate: number
  EPA_fg: number
  EPA_kickoff: number
  EPA_non_explosive: number
  EPA_non_explosive_passing: number
  EPA_non_explosive_passing_per_play: number
  EPA_non_explosive_per_play: number
  EPA_non_explosive_rushing: number
  EPA_non_explosive_rushing_per_play: number
  EPA_overall_off: number
  EPA_overall_offense: number
  EPA_overall_total: number
  EPA_passing_overall: number
  EPA_passing_per_play: number
  EPA_penalty: number
  EPA_per_play: number
  EPA_plays: number
  EPA_punt: number
  EPA_rushing_overall: number
  EPA_rushing_per_play: number
  EPA_rushing_power?: number
  EPA_rushing_power_per_play?: number
  EPA_sp: number
  EPA_special_teams: number
  first_downs_created: number
  first_downs_created_rate: number
  kickoff_plays: number
  line_yards: number
  line_yards_per_carry: number
  off_yards: number
  open_field_yards: number
  pass_yards: number
  passes: number
  passes_rate: number
  pos_team: number
  rush_yards: number
  rushes: number
  rushes_rate: number
  rushing_highlight: number
  rushing_highlight_rate: number
  rushing_highlight_yards: number
  rushing_highlight_yards_per_opp: number
  rushing_opportunity: number
  rushing_opportunity_rate: number
  rushing_power?: number
  rushing_power_rate: number
  rushing_power_success?: number
  rushing_power_success_rate?: number
  rushing_stopped: number
  rushing_stopped_rate: number
  rushing_stuff: number
  rushing_stuff_rate: number
  scrimmage_plays: number
  second_level_yards: number
  special_teams_plays: number
  total_off_yards: number
  total_pen_yards: number
  total_yards: number
  yards_per_pass: number
  yards_per_play: number
  yards_per_rush: number
}

export interface ProcessedTurnoverBoxScore {
  Int: number
  expected_turnover_margin: number
  expected_turnovers: number
  fumbles_lost: number
  fumbles_recovered: number
  pass_breakups: number
  pos_team: number
  total_fumbles: number
  turnover_luck: number
  turnover_margin: number
  turnovers: number
}

export type ProcessedGameInfo = ESPNCompetition & {
    away: ESPNTeam
    home: ESPNTeam
    gei?: number
}

export interface ProcessedRawGame {
    id: number
    count: number
    box_score: ProcessedBoxScore
    plays: ProcessedPlay[]
    homeTeamId: number
    awayTeamId: number
    drives: { previous?: ProcessedDrive[], current?: ProcessedDrive }
    // scoringPlays: ProcessedPlay[]
    winprobability: ESPNWinProbability[]
    // boxScore: ProcessedBoxScore
    homeTeamSpread: number
    overUnder: number
    header: ESPNGameHeader
    broadcasts: ESPNGeoBroadcast[]
    // gameInfo: ProcessedGameInfo
    season: number
}

export interface ProcessedGame extends Omit<ProcessedRawGame, 'box_score'> {
    plays: ProcessedPlay[]
    scoringPlays: ProcessedPlay[]
    advBoxScore: ProcessedBoxScore
    gameInfo: ProcessedGameInfo
}

const PYTHON_HTTP_URL = getSecret("PYTHON_HTTP_URL") || 'http://python:7000';

export async function retrieveProcessedGame(gameId: string | number): Promise<ProcessedGame> {
    const processedGame = await processPlays(gameId);
    
    const pbp: ProcessedGame = {
        ...processedGame,
        plays: processedGame.plays,
        scoringPlays: processedGame.plays.filter((p: ProcessedPlay) => ("scoringPlay" in p) && (p.scoringPlay == true)),
        advBoxScore: processedGame["box_score"],
        // boxScore: processedGame['boxScore'],
        gameInfo: {
            ...(processedGame.header.competitions[0]),
            away: processedGame.header.competitions[0].competitors[1].team,
            home: processedGame.header.competitions[0].competitors[0].team,
        }
    };

    const homeTeamId = processedGame.homeTeamId;
    const awayTeamId = processedGame.awayTeamId;
    if (processedGame != null && pbp.gameInfo != null && pbp.gameInfo.status.type.completed == true) {
        if (pbp.plays[pbp.plays.length - 1].pos_team == homeTeamId && (pbp.plays[pbp.plays.length - 1].homeScore > pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else if (pbp.plays[pbp.plays.length - 1].pos_team == awayTeamId && (pbp.plays[pbp.plays.length - 1].homeScore < pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 0.0
        }

        pbp.gameInfo.gei = calculateGEI(pbp.plays, homeTeamId)
    }

    return pbp;
}

function calculateGEI(plays: ProcessedPlay[], homeTeamId: string | number): number {
    var wpDiffs = []
    for (var i = 0; i < plays.length; i++) {
        let play = plays[i]

        var nextPlay = null;
        if ((i + 1) >= plays.length) {
            nextPlay = null
        } else {
            nextPlay = plays[i + 1]
        }
        
        function calculateHomeWP(play: ProcessedPlay) {
            let offWP = play != null ? play.winProbability.before : 0.0
            let defWP = 1.0 - offWP
            
            let homeWP = (play.pos_team == homeTeamId) ? offWP : defWP
            return homeWP
        }
        
        var finalWP = 0
        if (play.homeScore > play.awayScore) {
            if (play.pos_team == homeTeamId) {
                finalWP = 1.0
            } else {
                finalWP = 0.0
            }
        } else {
            if (play.pos_team == homeTeamId) {
                finalWP = 0.0
            } else {
                finalWP = 1.0
            }
        }
        let nextPlayWP = (nextPlay != null) ? calculateHomeWP(nextPlay) : finalWP
        
        wpDiffs.push((nextPlayWP - calculateHomeWP(play)))
    }

    let normalizeFactor = (plays.length == 0) ? 0 : (179.01777401608126 / plays.length)
    let gei = wpDiffs.map(p => Math.abs(p)).reduce((acc, val) => acc + val)
    return normalizeFactor * gei
}

async function processPlays(gameId: string | number): Promise<ProcessedRawGame> {
    const req = await fetch(`${PYTHON_HTTP_URL}/cfb/process`, {
        method: "POST",
        body: JSON.stringify({ gameId })
    })
    const content = await req.text();
    // console.log(content)
    // console.log(req.status)
    const resp: ProcessedRawGame = JSON.parse(content);
    return resp;
}