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
  EPA_success_rush_EPA?: number
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
  adj_rush_yardage: any
  athlete_name?: string
  awayScore: number
  awayTeamAbbrev: string
  awayTeamId: number
  awayTeamMascot: string
  awayTeamName: string
  awayTeamNameAlt: string
  awayTimeoutCalled: boolean
  away_wp_after: number
  away_wp_after_naive: number
  away_wp_before: number
  away_wp_before_naive: number
  change_of_pos_team: boolean
  change_of_poss: boolean
  clock: ESPNGameClock
  "clock.minutes": number
  "clock.seconds": number
  completion: boolean
  cp?: number
  cpoe?: number
  def_EPA: number
  def_fumble_lost: boolean
  def_pos_team: number
  def_pos_team_score: number
  def_pos_unit: string
  def_wp_after: number
  def_wp_after_naive: number
  def_wp_before: number
  def_wp_before_naive: number
  defense_score_play: boolean
  distance: number
  down: number
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
  early_down: boolean
  early_down_pass: boolean
  early_down_rush: boolean
  end: ProcessedPlayState
  "end.ExpScoreDiff": number
  "end.ExpScoreDiff_Time_Ratio": number
  "end.TimeSecsRem": number
  "end.adj_TimeSecsRem": number
  "end.awayScore": number
  "end.awayTeamTimeouts": number
  "end.defPosTeamTimeouts": number
  "end.def_pos_team.id": number
  "end.def_pos_team.name": string
  "end.def_pos_team_score": number
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
  "end.yard": number
  end_of_half?: boolean
  era: number
  expectedPoints: ProcessedAdvancedMetric
  extra_point_result?: string
  fg_attempt: boolean
  fg_block_player_id: any
  fg_block_player_name: any
  fg_kicker_player_id?: number
  fg_kicker_player_name?: string
  fg_made: boolean
  fg_make_prob?: number
  fg_return_player_id: any
  fg_return_player_name: any
  fg_team?: number
  fg_wp?: number
  fg_wp_diff?: number
  field_goal_result?: string
  firstHalfKickoffTeamId: number
  first_down_created: boolean
  first_down_prob?: number
  forced_fumble: boolean
  forced_fumble_team: number
  fourth_down_recommendation?: string
  fumble_forced_player_id?: number
  fumble_forced_player_name?: string
  fumble_lost: boolean
  fumble_or_muff: boolean
  fumble_player_id: any
  fumble_player_name: any
  fumble_recovered: boolean
  fumble_recovered_player_id: any
  fumble_recovered_player_name?: string
  fumble_recovery_team?: number
  fumble_vec: boolean
  fumbling_team?: number
  gameSpread: number
  gameSpreadAvailable: boolean
  game_id: number
  game_play_number: number
  go_boost?: number
  go_wp?: number
  go_wp_diff?: number
  goal_to_go: boolean
  half: number
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
  home_wp_after_naive: number
  home_wp_before: number
  home_wp_before_naive: number
  id: number
  int: boolean
  int_td: boolean
  int_turnover: boolean
  interception_player_id: any
  interception_player_name: any
  interception_team: number
  isPenalty: boolean
  isTurnover: boolean
  is_blocked_fg_turnover: boolean
  is_blocked_punt_turnover: boolean
  is_def_pos_team_turnover: boolean
  is_home: boolean
  is_pos_team_turnover: boolean
  is_st_turnover: boolean
  is_turnover: boolean
  kick_play: boolean
  kick_return_team?: number
  kicking_team?: number
  kickoff_downed: boolean
  kickoff_fair_catch: boolean
  kickoff_onside: boolean
  kickoff_oob: boolean
  kickoff_play: boolean
  kickoff_player_id: any
  kickoff_player_name?: string
  kickoff_return_player_id: any
  kickoff_return_player_name: any
  kickoff_safety: boolean
  kickoff_tb: boolean
  lag_EP_end?: number
  lag_HA_score_diff?: number
  lag_awayScore: number
  lag_change_of_pos_team: boolean
  lag_half?: number
  lag_homeScore: number
  lag_pos_score_diff: number
  lag_pos_team: number
  lag_scoringPlay?: boolean
  late_down: boolean
  late_down_pass: boolean
  late_down_rush: boolean
  lead_half: number
  lead_play_type?: string
  lead_pos_team?: number
  lead_pos_team2?: number
  lead_scoringPlay: boolean
  lead_start_distance: number
  lead_start_down: number
  lead_start_team: string
  lead_start_yardsToEndzone: number
  lead_text: string
  lead_wp_before?: number
  lead_wp_before2?: number
  lead_wp_before2_naive?: number
  lead_wp_before_naive?: number
  line_yards: any
  make_fg_wp?: number
  middle_8: boolean
  miss_fg_wp?: number
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
  orig_play_type: string
  overUnder: number
  pass: boolean
  pass_attempt: boolean
  pass_breakup: boolean
  pass_breakup_player_id?: number
  pass_breakup_player_name?: string
  pass_breakup_team: number
  pass_depth?: string
  pass_direction?: string
  pass_epa?: number
  pass_oe?: number
  pass_td: boolean
  pass_weight?: number
  passer_player_id?: number
  passer_player_name?: string
  passing_down: boolean
  pen_epa?: number
  pen_weight?: number
  penalized_team?: number
  penalty_1st_conv: boolean
  penalty_declined: boolean
  penalty_detail?: string
  penalty_flag: boolean
  penalty_in_text: boolean
  penalty_no_play: boolean
  penalty_offset: boolean
  penalty_safety: boolean
  penalty_text?: string
  penalty_yards_signed: number
  period: number
  "period.number": number
  play: boolean
  "pointAfterAttempt.abbreviation"?: string
  "pointAfterAttempt.id"?: number
  "pointAfterAttempt.text"?: string
  "pointAfterAttempt.value"?: number
  pos_fumble_lost: boolean
  pos_score_diff: number
  pos_score_diff_end: number
  pos_score_diff_start: number
  pos_score_pts: number
  pos_team: number
  pos_team_score: number
  pos_unit: string
  power_rush_attempt?: boolean
  power_rush_success?: boolean
  priority: boolean
  prob_2pt?: number
  prog_drive_EPA?: number
  prog_drive_WPA: number
  punt: boolean
  punt_block_player_id: any
  punt_block_player_name?: string
  punt_block_return_player_id: any
  punt_block_return_player_name: any
  punt_blocked: boolean
  punt_downed: boolean
  punt_fair_catch: boolean
  punt_oob: boolean
  punt_play: boolean
  punt_return_player_id: any
  punt_return_player_name?: string
  punt_return_team?: number
  punt_safety: boolean
  punt_tb: boolean
  punt_team?: number
  punt_wp?: number
  punt_wp_diff?: number
  punter_player_id?: number
  punter_player_name?: string
  qbr_epa: number
  receiver_player_id?: number
  receiver_player_name?: string
  recovery_team: any
  recovery_team_2: any
  return_team?: number
  rush: boolean
  rush_direction?: string
  rush_epa?: number
  rush_td: boolean
  rush_weight?: number
  rusher_player_id?: number
  rusher_player_name?: string
  rz_play: boolean
  sack: boolean
  sack_epa?: number
  sack_player_id?: number
  sack_player_id2: any
  sack_player_name?: string
  sack_player_name2: any
  sack_players: any
  sack_team: number
  sack_vec: boolean
  sack_weight?: number
  safety: boolean
  scoringPlay: boolean
  scoring_opp: boolean
  scoring_play: boolean
  scrimmage_play: boolean
  season: number
  seasonType: number
  second_level_yards?: number
  sequenceNumber: number
  short_rush_attempt?: boolean
  short_rush_success?: boolean
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
  status_type_completed: boolean
  stopped_run: boolean
  stuffed_run: boolean
  target: boolean
  td_check: boolean
  td_play: boolean
  teamParticipants: ESPNPlayTeamParticipant[]
  text: string
  text_dupe: boolean
  touchdown: boolean
  turnover_team?: number
  turnover_vec: boolean
  two_point_conv_result: any
  two_pt_recommendation?: string
  two_pt_wp?: number
  two_pt_wp_diff?: number
  type: ESPNPlayType
  under_2: boolean
  wallclock: string
  week: number
  weight: number
  winProbability: ProcessedAdvancedMetric
  wp_after: number
  wp_after_naive: number
  wp_before: number
  wp_before_naive: number
  wp_fail?: number
  wp_succeed?: number
  wp_touchback: number
  wp_touchback_naive: number
  wpa: number
  wpa_naive: number
  xp_wp?: number
  xpass?: number
  yds_fg: any
  yds_fumble_return: any
  yds_int_return: any
  yds_kickoff: any
  yds_kickoff_return?: number
  yds_penalty?: string
  yds_punt_gained?: number
  yds_punt_return?: number
  yds_punted?: number
  yds_receiving?: number
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
  CompPct?: number
  xCompPct?: number
  CPOE?: number
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

export type ProcessedTeamMetricBoxScore = ProcessedTurnoverBoxScore | ProcessedTeamBoxScore | ProcessedDefensiveBoxScore | ProcessedDriveBoxScore | ProcessedSituationalBoxScore;

export type ProcessedGameTeamInfo = {
    away: ESPNTeam
    home: ESPNTeam
}

export interface ProcessedGame {
    id: number
    count: number
    advBoxScore: ProcessedBoxScore
    plays: ProcessedPlay[]
    drives: { previous?: ProcessedDrive[], current?: ProcessedDrive }
    scoringPlays: ProcessedPlay[]
    winprobability: ESPNWinProbability[]
    homeTeamSpread: number
    overUnder: number
    header: ESPNGameHeader
    broadcasts: ESPNGeoBroadcast[]
    season: ESPNSeason
    gei?: number
    teamInfo: ProcessedGameTeamInfo
}

const PYTHON_HTTP_URL = getSecret("PYTHON_HTTP_URL") || 'http://python:7000';

export async function retrieveProcessedGame(gameId: string | number): Promise<ProcessedGame> {
    const processed: ProcessedGame = await processPlays(gameId);

    const pbp: ProcessedGame = {
        ...processed,
        scoringPlays: processed.plays.filter((p: ProcessedPlay) => ("scoringPlay" in p) && (p.scoringPlay == true)),
    };

    for (let [key, baseData] of Object.entries(pbp.advBoxScore)) {
        const statKeys = baseData.length > 0 ? Object.keys(baseData[0]) : []
        let teamKey = "pos_team"
        if (statKeys.length > 0 && statKeys.includes("def_pos_team")) {
            teamKey = "def_pos_team"
        }

        baseData.sort((a: any, b: any) => {
            if (a[teamKey] == pbp.teamInfo.away.id && b[teamKey] == pbp.teamInfo.home.id) {
                return -1;
            } else if (b[teamKey] == pbp.teamInfo.away.id && a[teamKey] == pbp.teamInfo.home.id) {
                return 1;
            } else {
                return 0;
            }
        });
    }

    const homeTeamId = parseInt(pbp.teamInfo.home.id);
    const awayTeamId = parseInt(pbp.teamInfo.away.id);
    const status = pbp.header.competitions[0].status
    if (pbp != null && status.type.completed == true) {
        if (pbp.plays[pbp.plays.length - 1].pos_team == homeTeamId && (pbp.plays[pbp.plays.length - 1].homeScore > pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else if (pbp.plays[pbp.plays.length - 1].pos_team == awayTeamId && (pbp.plays[pbp.plays.length - 1].homeScore < pbp.plays[pbp.plays.length - 1].awayScore)) {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 1.0
        } else {
            pbp.plays[pbp.plays.length - 1].winProbability.after = 0.0
        }

        pbp.gei = calculateGEI(pbp.plays, homeTeamId)
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

async function processPlays(gameId: string | number): Promise<ProcessedGame> {
    const req = await fetch(`${PYTHON_HTTP_URL}/cfb/process`, {
        method: "POST",
        body: JSON.stringify({ gameId })
    })
    const content = await req.text();
    // console.log(content)
    // console.log(req.status)
    const resp: ProcessedGame = JSON.parse(content);
    return resp;
}