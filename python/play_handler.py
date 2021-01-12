from numpy.core.fromnumeric import mean
from flask import jsonify
import pandas as pd
import numpy as np
import xgboost as xgb
import re
from flask_logs import LogSetup
import json

ep_class_to_score_mapping = {
    0: 7,
    1: -7,
    2: 3,
    3: -3,
    4: 2,
    5: -2,
    6: 0
}

# "td" : float(p[0]),
# "opp_td" : float(p[1]),
# "fg" : float(p[2]),
# "opp_fg" : float(p[3]),
# "safety" : float(p[4]),
# "opp_safety" : float(p[5]),
# "no_score" : float(p[6])

ep_model = xgb.Booster({'nthread': 4})  # init model
ep_model.load_model('models/ep_model.model')

wp_model = xgb.Booster({'nthread': 4})  # init model
wp_model.load_model('models/wp_spread.model')

wp_start_columns = ["pos_team_receives_2H_kickoff","spread_time","start.TimeSecsRem","start.adj_TimeSecsRem","ExpScoreDiff_Time_Ratio","pos_score_diff_start","start.down","start.distance","start.yardsToEndzone","is_home","pos_team_timeouts_rem_before","def_pos_team_timeouts_rem_before","period"]
wp_end_columns = ["pos_team_receives_2H_kickoff","spread_time_end","end.TimeSecsRem","end.adj_TimeSecsRem","ExpScoreDiff_Time_Ratio_end","pos_score_diff","end.down","end.distance","end.yardsToEndzone","is_home","pos_team_timeouts","def_pos_team_timeouts","period"]

ep_start_touchback_columns = ["start.TimeSecsRem","start.yardsToEndzone.touchback","distance","down_1","down_2","down_3","down_4","pos_score_diff_start"]
ep_start_columns = ["start.TimeSecsRem","start.yardsToEndzone","start.distance","down_1","down_2","down_3","down_4","pos_score_diff_start"]
ep_end_columns = ["end.TimeSecsRem","end.yardsToEndzone","end.distance","down_1_end","down_2_end","down_3_end","down_4_end","pos_score_diff_end"]

ep_final_names = [        
    "TimeSecsRem",
    "yards_to_goal",
    "distance",
    "down_1",
    "down_2",
    "down_3",
    "down_4",
    "pos_score_diff_start"
]
wp_final_names = [
    "pos_team_receives_2H_kickoff",
    "spread_time",
    "TimeSecsRem",
    "adj_TimeSecsRem",
    "ExpScoreDiff_Time_Ratio",
    "pos_score_diff_start",
    "down",
    "distance",
    "yards_to_goal",
    "is_home",
    "pos_team_timeouts_rem_before",
    "def_pos_team_timeouts_rem_before",
    "period"
]

##--Play type vectors------
scores_vec = [
    "Blocked Punt Touchdown",
    "Blocked Punt (Safety)",
    "Punt (Safety)",
    "Blocked Field Goal Touchdown",
    "Missed Field Goal Return Touchdown",
    "Fumble Recovery (Opponent) Touchdown",
    "Fumble Return Touchdown",
    "Interception Return Touchdown",
    "Pass Interception Return Touchdown",
    "Punt Touchdown",
    "Punt Return Touchdown",
    "Sack Touchdown",
    "Uncategorized Touchdown",
    "Defensive 2pt Conversion",
    "Uncategorized",
    "Two Point Rush",
    "Safety",
    "Penalty (Safety)",
    "Punt Team Fumble Recovery Touchdown",
    "Kickoff Team Fumble Recovery Touchdown",
    "Kickoff (Safety)",
    "Passing Touchdown",
    "Rushing Touchdown",
    "Field Goal Good",
    "Pass Reception Touchdown",
    "Fumble Recovery (Own) Touchdown"
]

defense_score_vec = [
    "Blocked Punt Touchdown",
    "Blocked Field Goal Touchdown",
    "Missed Field Goal Return Touchdown",
    "Punt Return Touchdown",
    "Fumble Recovery (Opponent) Touchdown",
    "Fumble Return Touchdown",
    "Kickoff Return Touchdown",
    "Defensive 2pt Conversion",
    "Safety",
    "Sack Touchdown",
    "Interception Return Touchdown",
    "Pass Interception Return Touchdown",
    "Uncategorized Touchdown"
]
turnover_vec = [
    "Blocked Field Goal",
    "Blocked Field Goal Touchdown",
    "Blocked Punt",
    "Blocked Punt Touchdown",
    "Field Goal Missed",
    "Missed Field Goal Return",
    "Missed Field Goal Return Touchdown",
    "Fumble Recovery (Opponent)",
    "Fumble Recovery (Opponent) Touchdown",
    "Fumble Return Touchdown",
    "Defensive 2pt Conversion",
    "Interception",
    "Interception Return",
    "Interception Return Touchdown",
    "Pass Interception Return",
    "Pass Interception Return Touchdown",
    "Kickoff Team Fumble Recovery",
    "Kickoff Team Fumble Recovery Touchdown",
    "Punt Touchdown",
    "Punt Return Touchdown",
    "Sack Touchdown",
    "Uncategorized Touchdown"
]
normalplay = [
    "Rush",
    "Pass",
    "Pass Reception",
    "Pass Incompletion",
    "Pass Completion",
    "Sack",
    "Fumble Recovery (Own)"
]
penalty = [
    'Penalty', 
    'Penalty (Kickoff)',
    'Penalty (Safety)'
]
offense_score_vec = [
    "Passing Touchdown",
    "Rushing Touchdown",
    "Field Goal Good",
    "Pass Reception Touchdown",
    "Fumble Recovery (Own) Touchdown",
    "Punt Touchdown", #<--- Punting Team recovers the return team fumble and scores
    "Punt Team Fumble Recovery Touchdown",
    "Kickoff Touchdown", #<--- Kickoff Team recovers the return team fumble and scores
    "Kickoff Team Fumble Recovery Touchdown"
]
punt_vec = [
    "Blocked Punt",
    "Blocked Punt Touchdown",
    "Blocked Punt (Safety)",
    "Punt (Safety)",
    "Punt",
    "Punt Touchdown",
    "Punt Team Fumble Recovery",
    "Punt Team Fumble Recovery Touchdown",
    "Punt Return Touchdown"
]
kickoff_vec = [
    "Kickoff",
    "Kickoff Return (Offense)",
    "Kickoff Return Touchdown",
    "Kickoff Touchdown",
    "Kickoff Team Fumble Recovery",
    "Kickoff Team Fumble Recovery Touchdown",
    "Kickoff (Safety)",
    "Penalty (Kickoff)"
]
int_vec = [
    "Interception",
    "Interception Return",
    "Interception Return Touchdown",
    "Pass Interception",
    "Pass Interception Return",
    "Pass Interception Return Touchdown"
]
end_change_vec = [
    "Blocked Field Goal",
    "Blocked Field Goal Touchdown",
    "Field Goal Missed",
    "Missed Field Goal Return",
    "Missed Field Goal Return Touchdown",
    "Blocked Punt",
    "Blocked Punt Touchdown",
    "Punt",
    "Punt Touchdown",
    "Punt Return Touchdown",
    "Kickoff Team Fumble Recovery",
    "Kickoff Team Fumble Recovery Touchdown",
    "Fumble Recovery (Opponent)",
    "Fumble Recovery (Opponent) Touchdown",
    "Fumble Return Touchdown",
    "Sack Touchdown",
    "Defensive 2pt Conversion",
    "Interception",
    "Interception Return",
    "Interception Return Touchdown",
    "Pass Interception Return",
    "Pass Interception Return Touchdown",
    "Uncategorized Touchdown"
]
kickoff_turnovers = [
    "Kickoff Team Fumble Recovery", 
    "Kickoff Team Fumble Recovery Touchdown"
]
class PlayProcess(object):
    plays_json = pd.DataFrame()
    drives_json = pd.DataFrame()
    box_score_json = pd.DataFrame()
    homeTeamSpread = 2.5
    homeTeamId = 0
    awayTeamId = 0
    firstHalfKickoffTeamId = 0
    logger = None
    ran_pipeline = False

    def __init__(self, logger = None, json_data = [], drives_data = [], boxScore=[], spread = 2.5, homeTeam = 0, awayTeam = 0, firstHalfKickoffTeam = 0):
        
        self.plays_json = pd.json_normalize(json_data)
        
        self.drives_json = pd.json_normalize(drives_data)
        

        self.plays_json = pd.merge(self.plays_json, self.drives_json, left_on="driveId", right_on="id", suffixes=[None, "_drive"])
        
        self.box_score_json = pd.json_normalize(boxScore)
        self.homeTeamSpread = float(spread)
        self.homeTeamId = int(homeTeam)
        self.awayTeamId = int(awayTeam)
        self.firstHalfKickoffTeamId = int(firstHalfKickoffTeam)
        self.logger = logger
        self.ran_pipeline = False

    def __setup_penalty_data__(self, play_df):
            ##-- 'Penalty' in play text ----
            #-- T/F flag conditions penalty_flag 
        play_df['penalty_flag'] = False
        play_df.loc[(play_df['type.text'] == "Penalty"), 'penalty_flag'] = True
        play_df.loc[play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True), 'penalty_flag'] = True

            #-- T/F flag conditions penalty_declined 
        play_df['penalty_declined'] = False
        play_df.loc[(play_df['type.text'] == "Penalty") & 
                    (play_df["text"].str.contains("declined", case=False, flags=0, na=False, regex=True)), 'penalty_declined'] = True
        play_df.loc[(play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True)) & 
                    (play_df["text"].str.contains("declined", case=False, flags=0, na=False, regex=True)), 'penalty_declined'] = True

            #-- T/F flag conditions penalty_no_play 
        play_df['penalty_no_play'] = False
        play_df.loc[(play_df['type.text'] == "Penalty") & 
                    (play_df["text"].str.contains("no play", case=False, flags=0, na=False, regex=True)), 'penalty_no_play'] = True
        play_df.loc[(play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True)) & 
                    (play_df["text"].str.contains("no play", case=False, flags=0, na=False, regex=True)), 'penalty_no_play'] = True

            #-- T/F flag conditions penalty_offset 
        play_df['penalty_offset'] = False
        play_df.loc[(play_df['type.text'] == "Penalty") & 
                    (play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True)), 'penalty_offset'] = True
        play_df.loc[(play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True)) & 
                    (play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True)), 'penalty_offset'] = True

            #-- T/F flag conditions penalty_1st_conv 
        play_df['penalty_1st_conv'] = False
        play_df.loc[(play_df['type.text'] == "Penalty") & 
                    (play_df["text"].str.contains("1st down", case=False, flags=0, na=False, regex=True)), 'penalty_1st_conv'] = True
        play_df.loc[(play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True)) & 
                    (play_df["text"].str.contains("1st down", case=False, flags=0, na=False, regex=True)), 'penalty_1st_conv'] = True

            #-- T/F flag for penalty text but not penalty play type -- 
        play_df['penalty_in_text'] = False
        play_df.loc[(play_df["text"].str.contains("penalty", case=False, flags=0, na=False, regex=True)) & 
                    (~(play_df['type.text'] == "Penalty")) & 
                    (~play_df["text"].str.contains("declined", case=False, flags=0, na=False, regex=True)) & 
                    (~play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True)) & 
                    (~play_df["text"].str.contains("no play", case=False, flags=0, na=False, regex=True)), 'penalty_in_text'] = True
        
        play_df["penalty_detail"] = np.select([
            (play_df.penalty_offset == 1),
            (play_df.penalty_declined == 1),
            play_df.text.str.contains(" roughing passer ", case=False, regex=True),
            play_df.text.str.contains(" offensive holding ", case=False, regex=True),
            play_df.text.str.contains(" pass interference", case=False, regex=True),
            play_df.text.str.contains(" encroachment", case=False, regex=True),
            play_df.text.str.contains(" defensive pass interference ", case=False, regex=True),
            play_df.text.str.contains(" offensive pass interference ", case=False, regex=True),
            play_df.text.str.contains(" illegal procedure ", case=False, regex=True),
            play_df.text.str.contains(" defensive holding ", case=False, regex=True),
            play_df.text.str.contains(" holding ", case=False, regex=True),
            play_df.text.str.contains(" offensive offside | offside offense", case=False, regex=True),
            play_df.text.str.contains(" defensive offside | offside defense", case=False, regex=True),
            play_df.text.str.contains(" offside ", case=False, regex=True),
            play_df.text.str.contains(" illegal fair catch signal ", case=False, regex=True),
            play_df.text.str.contains(" illegal batting ", case=False, regex=True),
            play_df.text.str.contains(" neutral zone infraction ", case=False, regex=True),
            play_df.text.str.contains(" ineligible downfield ", case=False, regex=True),
            play_df.text.str.contains(" illegal use of hands ", case=False, regex=True),
            play_df.text.str.contains(" kickoff out of bounds | kickoff out-of-bounds ", case=False, regex=True),
            play_df.text.str.contains(" 12 men on the field ", case=False, regex=True),
            play_df.text.str.contains(" illegal block ", case=False, regex=True),
            play_df.text.str.contains(" personal foul ", case=False, regex=True),
            play_df.text.str.contains(" false start ", case=False, regex=True),
            play_df.text.str.contains(" substitution infraction ", case=False, regex=True),
            play_df.text.str.contains(" illegal formation ", case=False, regex=True),
            play_df.text.str.contains(" illegal touching ", case=False, regex=True),
            play_df.text.str.contains(" sideline interference ", case=False, regex=True),
            play_df.text.str.contains(" clipping ", case=False, regex=True),
            play_df.text.str.contains(" sideline infraction ", case=False, regex=True),
            play_df.text.str.contains(" crackback ", case=False, regex=True),
            play_df.text.str.contains(" illegal snap ", case=False, regex=True),
            play_df.text.str.contains(" illegal helmet contact ", case=False, regex=True),
            play_df.text.str.contains(" roughing holder ", case=False, regex=True),
            play_df.text.str.contains(" horse collar tackle ", case=False, regex=True),
            play_df.text.str.contains(" illegal participation ", case=False, regex=True),
            play_df.text.str.contains(" tripping ", case=False, regex=True),
            play_df.text.str.contains(" illegal shift ", case=False, regex=True),
            play_df.text.str.contains(" illegal motion ", case=False, regex=True),
            play_df.text.str.contains(" roughing the kicker ", case=False, regex=True),
            play_df.text.str.contains(" delay of game ", case=False, regex=True),
            play_df.text.str.contains(" targeting ", case=False, regex=True),
            play_df.text.str.contains(" face mask ", case=False, regex=True),
            play_df.text.str.contains(" illegal forward pass ", case=False, regex=True),
            play_df.text.str.contains(" intentional grounding ", case=False, regex=True),
            play_df.text.str.contains(" illegal kicking ", case=False, regex=True),
            play_df.text.str.contains(" illegal conduct ", case=False, regex=True),
            play_df.text.str.contains(" kick catching interference ", case=False, regex=True),
            play_df.text.str.contains(" unnecessary roughness ", case=False, regex=True),
            play_df.text.str.contains("Penalty, UR"),
            play_df.text.str.contains(" unsportsmanlike conduct ", case=False, regex=True),
            play_df.text.str.contains(" running into kicker ", case=False, regex=True),
            play_df.text.str.contains(" failure to wear required equipment ", case=False, regex=True),
            play_df.text.str.contains(" player disqualification ", case=False, regex=True),
            (play_df.penalty_flag == True)
        ],[
            "Off-Setting",
            "Penalty Declined",
            "Roughing the Passer",
            "Offensive Holding",
            "Pass Interference",
            "Encroachment",
            "Defensive Pass Interference",
            "Offensive Pass Interference",
            "Illegal Procedure",
            "Defensive Holding",
            "Holding",
            "Offensive Offside",
            "Defensive Offside",
            "Offside",
            "Illegal Fair Catch Signal",
            "Illegal Batting",
            "Neutral Zone Infraction",
            "Ineligible Man Down-Field",
            "Illegal Use of Hands",
            "Kickoff Out-of-Bounds",
            "12 Men on the Field",
            "Illegal Block",
            "Personal Foul",
            "False Start",
            "Substitution Infraction",
            "Illegal Formation",
            "Illegal Touching",
            "Sideline Interference",
            "Clipping",
            "Sideline Infraction",
            "Crackback",
            "Illegal Snap",
            "Illegal Helmet contact",
            "Roughing the Holder",
            "Horse-Collar Tackle",
            "Illegal Participation",
            "Tripping",
            "Illegal Shift",
            "Illegal Motion",
            "Roughing the Kicker",
            "Delay of Game",
            "Targeting",
            "Face Mask",
            "Illegal Forward Pass",
            "Intentional Grounding",
            "Illegal Kicking",
            "Illegal Conduct",
            "Kick Catch Interference",
            "Unnecessary Roughness",
            "Unnecessary Roughness",
            "Unsportsmanlike Conduct",
            "Running Into Kicker",
            "Failure to Wear Required Equipment",
            "Player Disqualification",
            "Missing"
        ], default = None)
        
        play_df['penalty_text'] = np.where(
            (play_df.penalty_flag == True),
            play_df.text.str.extract(r"Penalty(.+)", flags=re.IGNORECASE)[0],
            None
        )
        
        play_df['yds_penalty'] = np.where(
            (play_df.penalty_flag == True),
            play_df.penalty_text.str.extract("(.{0,3})yards|yds|yd to the ", flags=re.IGNORECASE)[0], 
            None
        )
        play_df['yds_penalty'] = play_df['yds_penalty'].str.replace( " yards to the | yds to the | yd to the ", "")
        play_df['yds_penalty'] = np.where(
            (play_df.penalty_flag == True) & (play_df.text.str.contains(r"ards\)", case=False, regex=True)) & (play_df.yds_penalty.isna()),
            play_df.text.str.extract(r"(.{0,4})yards\)|Yards\)|yds\)|Yds\)",flags=re.IGNORECASE)[0], 
            play_df.yds_penalty
        )
        play_df['yds_penalty'] = play_df.yds_penalty.str.replace( "yards\\)|Yards\\)|yds\\)|Yds\\)", "").str.replace( "\\(", "")
        return play_df

    def __clean_pbp_data__(self, play_df):
        play_df.id = play_df.id.astype(float)
        play_df['game_play_number'] = np.arange(len(play_df))
        play_df["start.team.id"] = play_df["start.team.id"].astype(int)
        play_df["end.team.id"] = play_df["end.team.id"].fillna(value=play_df["start.team.id"]).astype(int)
        play_df["period"] = play_df["period"].astype(int)

        play_df['half'] = np.where(
            play_df.period <= 2,
            1,
            2
        )
        play_df['lead_half'] = play_df.half.shift(-1)
        play_df.loc[play_df.lead_half.isna() == True, 'lead_half'] = 2
        play_df['end_of_half'] = (play_df.half != play_df.lead_half)

        play_df['down_1'] = (play_df["start.down"] == 1)
        play_df['down_2'] = (play_df["start.down"] == 2)
        play_df['down_3'] = (play_df["start.down"] == 3)
        play_df['down_4'] = (play_df["start.down"] == 4)

        play_df['down_1_end'] = (play_df["end.down"] == 1)
        play_df['down_2_end'] = (play_df["end.down"] == 2)
        play_df['down_3_end'] = (play_df["end.down"] == 3)
        play_df['down_4_end'] = (play_df["end.down"] == 4)

        #-- Touchdowns----
        play_df["scoring_play"] = np.where(play_df["type.text"].isin(scores_vec), True, False)
        play_df["td_play"] = play_df.text.str.contains(r"touchdown|for a TD", case=False, flags=0, na=False, regex=True)
        play_df["touchdown"] = play_df["type.text"].str.contains("touchdown", case=False, flags=0, na=False, regex=True)
        play_df["safety"] = play_df["text"].str.contains("safety", case=False, flags=0, na=False, regex=True)
            #-- Fumbles----
        play_df["fumble_vec"] = play_df["text"].str.contains("fumble", case=False, flags=0, na=False, regex=True)
        play_df["forced_fumble"] = play_df["text"].str.contains("forced by", case=False, flags=0, na=False, regex=True)
            #-- Kicks----
        play_df["kickoff_play"] = np.where(play_df["type.text"].isin(kickoff_vec), True, False)
        play_df["kickoff_tb"] = np.where(
            (play_df["text"].str.contains("touchback", case=False, flags=0, na=False, regex=True)) & 
            (play_df.kickoff_play == True), True, False
            )
        play_df["kickoff_onside"] = np.where(
            (play_df["text"].str.contains(r"on-side|onside|on side", case=False, flags=0, na=False, regex=True)) & 
            (play_df.kickoff_play == True), True, False
        )
        play_df["kickoff_oob"] = np.where(
            (play_df["text"].str.contains(r"out-of-bounds|out of bounds", case=False, flags=0, na=False, regex=True)) & 
            (play_df.kickoff_play == True), True, False
        )
        play_df["kickoff_fair_catch"] = np.where(
            (play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True)) & 
            (play_df.kickoff_play == True), True, False
        )
        play_df["kickoff_downed"] = np.where(
            (play_df["text"].str.contains("downed", case=False, flags=0, na=False, regex=True)) & (play_df.kickoff_play == True), True, False
        )
        play_df["kick_play"] = play_df["text"].str.contains(r"kick|kickoff", case=False, flags=0, na=False, regex=True)
        play_df["kickoff_safety"] = np.where(
            (~play_df["type.text"].isin(['Blocked Punt','Penalty'])) & 
            (play_df["text"].str.contains("kickoff", case=False, flags=0, na=False, regex=True)) & 
            (play_df.safety == True), True, False
        )
            #-- Punts----
        play_df["punt"] = np.where(play_df["type.text"].isin(punt_vec), True, False)
        play_df["punt_play"] = play_df["text"].str.contains("punt", case=False, flags=0, na=False, regex=True)
        play_df["punt_tb"] = np.where(
            (play_df["text"].str.contains("touchback", case=False, flags=0, na=False, regex=True)) & 
            (play_df.punt == True), True, False
        )
        play_df["punt_oob"] = np.where(
            (play_df["text"].str.contains(r"out-of-bounds|out of bounds", case=False, flags=0, na=False, regex=True)) & 
            (play_df.punt == True), True, False
        )
        play_df["punt_fair_catch"] = np.where(
            (play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True)) & 
            (play_df.punt == True), True, False
        )
        play_df["punt_downed"] = np.where(
            (play_df["text"].str.contains("downed", case=False, flags=0, na=False, regex=True)) & 
            (play_df.punt == True), True, False
        )
        play_df["punt_safety"] = np.where(
            (play_df["type.text"].isin(['Blocked Punt','Punt'])) & 
            (play_df["text"].str.contains("punt", case=False, flags=0, na=False, regex=True)) & 
            (play_df.safety == True), True, False
        )
        play_df["penalty_safety"] = np.where((play_df["type.text"].isin(['Penalty'])) & (play_df.safety == True), True, False)
        play_df["punt_blocked"] = np.where(
            (play_df["text"].str.contains("blocked", case=False, flags=0, na=False, regex=True)) & (play_df.punt == True), True, False
        )
            #-- Pass/Rush----
        play_df['rush'] = np.where(
            ((play_df["type.text"] == "Rush")
            | (play_df["type.text"] == "Rushing Touchdown")
            | (play_df["type.text"].isin(["Safety","Fumble Recovery (Opponent)","Fumble Recovery (Opponent) Touchdown", "Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Return Touchdown"]) & play_df["text"].str.contains("run for"))),
            True, False
        )
        play_df['pass'] = np.where(
            (
            (play_df["type.text"].isin(["Pass Reception", "Pass Completion","Passing Touchdown","Sack","Pass","Inteception","Pass Interception Return", "Interception Return Touchdown","Pass Incompletion","Sack Touchdown","Interception Return"]))
            | ((play_df["type.text"] == "Safety") & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Safety") & (play_df["text"].str.contains("pass complete", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Own)") & (play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Own)") & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Own) Touchdown") & (play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Own) Touchdown") & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent)") & (play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent)") & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent) Touchdown") & (play_df["text"].str.contains(r"pass complete|pass incomplete", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Return Touchdown") & (play_df["text"].str.contains(r"pass complete|pass incomplete", case=False, flags=0, na=False, regex=True)))
            | ((play_df["type.text"] == "Fumble Return Touchdown") & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            ),
            True, False
        )
            #-- Sacks----
        play_df['sack_vec'] = np.where(
            (
                (play_df["type.text"].isin(["Sack", "Sack Touchdown"]))
                | ((play_df["type.text"].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown", "Fumble Return Touchdown"]) 
                & (play_df["pass"] == True)
                & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True))
                ))
            ), True, False)
        
        play_df['type.text'] = np.where(play_df["text"].str.contains(" coin toss "), "Coin Toss", play_df["type.text"])

        play_df['pos_team'] = np.select([
            (play_df["start.team.id"] == self.homeTeamId) & (play_df.kickoff_play == True),
            (play_df["start.team.id"] == self.awayTeamId) & (play_df.kickoff_play == True)
        ],
        [
            self.awayTeamId,
            self.homeTeamId
        ], default = play_df["start.team.id"])

        play_df['is_home'] = (play_df.pos_team == self.homeTeamId)
        
        play_df['def_pos_team'] = np.where(play_df.pos_team == self.homeTeamId, self.awayTeamId, self.homeTeamId)
        play_df['pos_team_score'] = np.where(play_df.pos_team == self.homeTeamId, play_df.homeScore, play_df.awayScore)
        play_df['def_pos_team_score'] = np.where(play_df.pos_team == self.homeTeamId, play_df.awayScore, play_df.homeScore)

        play_df['lag_pos_team'] = play_df['pos_team'].shift(1)
        play_df.loc[play_df.lag_pos_team.isna() == True, 'lag_pos_team'] = play_df.pos_team

        play_df['lead_pos_team'] = play_df['pos_team'].shift(-1)
        play_df['lead_pos_team2'] = play_df['pos_team'].shift(-2)

        play_df['pos_score_diff'] = play_df.pos_team_score - play_df.def_pos_team_score
        play_df['lag_pos_score_diff'] = play_df['pos_score_diff'].shift(1)
        play_df.loc[play_df.pos_score_diff.isna() == True, 'lag_pos_score_diff'] = 0

        play_df['pos_score_pts'] = np.where(play_df.lag_pos_team == play_df.pos_team, play_df.pos_score_diff - play_df.lag_pos_score_diff, play_df.pos_score_diff + play_df.lag_pos_score_diff)
        play_df['pos_score_diff_start'] = np.where(play_df.lag_pos_team == play_df.pos_team, play_df.lag_pos_score_diff, -1 * play_df.lag_pos_score_diff)

        play_df['pos_team_timeouts'] = np.where(play_df.kickoff_play == True, play_df["end.defTeamTimeouts"], play_df["end.posTeamTimeouts"])
        play_df['def_pos_team_timeouts'] = np.where(play_df.kickoff_play == True, play_df["end.posTeamTimeouts"], play_df["end.defTeamTimeouts"])
        play_df['pos_team_timeouts_rem_before'] = np.where(play_df.kickoff_play == True, play_df["start.defTeamTimeouts"], play_df["start.posTeamTimeouts"])
        play_df['def_pos_team_timeouts_rem_before'] = np.where(play_df.kickoff_play == True, play_df["start.posTeamTimeouts"], play_df["start.defTeamTimeouts"])
        play_df.loc[play_df.pos_score_diff_start.isna() == True, 'pos_score_diff_start'] = play_df.pos_score_diff

        play_df['pos_team_receives_2H_kickoff'] = (play_df.pos_team == self.firstHalfKickoffTeamId)

        play_df['change_of_poss'] = np.where(play_df["pos_team"] == play_df["lead_pos_team"], False, True)
        play_df['change_of_poss'] = np.where(play_df['change_of_poss'].isna(), 0, play_df['change_of_poss'])

            ## Fix Strip-Sacks to Fumbles----
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == True) 
                & (play_df["pass"] == True) 
                & (play_df.change_of_poss == True) 
                & (play_df.td_play == False) 
                & (play_df["start.down"] != 4) 
                & ~(play_df['type.text'].isin(defense_score_vec)),
            "Fumble Recovery (Opponent)", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == True) 
                & (play_df["pass"] == True) 
                & (play_df.change_of_poss == True) 
                & (play_df.td_play == True),
            "Fumble Recovery (Opponent) Touchdown", play_df['type.text']
        )
            ## Fix rushes with fumbles and a change of possession to fumbles----  
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == True) 
                & (play_df["rush"] == True) 
                & (play_df.change_of_poss == True) 
                & (play_df.td_play == False) 
                & (play_df["start.down"] != 4) 
                & ~(play_df['type.text'].isin(defense_score_vec)),
            "Fumble Recovery (Opponent)", play_df['type.text']
        )

        play_df['type.text'] = np.where(
            (play_df.fumble_vec == True) 
                & (play_df["rush"] == True) 
                & (play_df.change_of_poss == True) 
                & (play_df.td_play == True),
            "Fumble Recovery (Opponent) Touchdown", play_df['type.text']
        )
            ## Portion of touchdown check for plays where touchdown is not listed in the play_type--
        play_df["td_check"] = play_df["text"].str.contains("Touchdown", case=False, flags=0, na=False, regex=True)

            #-- Fix kickoff fumble return TDs ----
        play_df['type.text'] = np.where(
                (play_df.kickoff_play == True) 
                & (play_df.fumble_vec == True) 
                & (play_df.td_play == True)
                & (play_df.td_check == True),
            f"{play_df['type.text']} Touchdown", play_df['type.text']
        )

            #-- Fix punt return TDs ----
        play_df['type.text'] = np.where(
                (play_df.punt_play == True) 
                & (play_df.td_play == True)
                & (play_df.td_check == True),
            f"{play_df['type.text']} Touchdown", play_df['type.text']
        )

            #-- Fix kick return TDs----
        play_df['type.text'] = np.where(
                (play_df.kickoff_play == True) 
                & (play_df.fumble_vec == False) 
                & (play_df.td_play == True)
                & (play_df.td_check == True),
            f"Kickoff Return Touchdown", play_df['type.text']
        )
        
            #-- Fix rush/pass tds that aren't explicit----
        play_df['type.text'] = np.where(
                (play_df.td_play == True) 
                & (play_df.rush == True) 
                & (play_df.fumble_vec == False) 
                & (play_df.td_check == True),
            f"Rushing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df.td_play == True) 
                & (play_df["pass"] == True) 
                & (play_df.fumble_vec == False) 
                & (play_df.td_check == True)
                & ~(play_df['type.text'].isin(int_vec)),
            f"Passing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df["pass"] == True) 
                & (play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Pass"]))
                & (play_df.statYardage == play_df["start.yardsToEndzone"])
                & (play_df.fumble_vec == False)
                & ~(play_df['type.text'].isin(int_vec)),
            f"Passing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df['type.text'].isin(["Blocked Field Goal"])) 
                & (play_df['text'].str.contains("for a TD", case=False, flags=0, na=False, regex=True)),
            f"Blocked Field Goal Touchdown", play_df['type.text']
        )

            #-- Fix duplicated TD play_type labels----
        play_df['type.text'] = np.where(play_df['type.text'] == "Punt Touchdown Touchdown", "Punt Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Fumble Return Touchdown Touchdown", "Fumble Return Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Rushing Touchdown Touchdown", "Rushing Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Uncategorized Touchdown Touchdown", "Uncategorized Touchdown", play_df['type.text'])

            #-- Fix Pass Interception Return TD play_type labels----
        play_df['type.text'] = np.where(play_df["text"].str.contains("pass intercepted for a TD", case=False, flags=0, na=False, regex=True), "Interception Return Touchdown", play_df["type.text"])

            #-- Fix Sack/Fumbles Touchdown play_type labels----
        play_df['type.text'] = np.where(
            (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True))
            & (play_df["text"].str.contains("fumbled", case=False, flags=0, na=False, regex=True))
            & (play_df["text"].str.contains("TD", case=False, flags=0, na=False, regex=True)),
            "Fumble Recovery (Opponent) Touchdown", play_df["type.text"]
        )

            #-- Fix generic pass plays ----
            ##-- first one looks for complete pass
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & (play_df.text.str.contains("pass complete", case=False, flags=0, na=False, regex=True)),
                            "Pass Completion", play_df['type.text'])

            ##-- second one looks for incomplete pass
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & (play_df.text.str.contains("pass incomplete", case=False, flags=0, na=False, regex=True)),
                            "Pass Incompletion", play_df['type.text'])

            ##-- third one looks for interceptions 
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & (play_df.text.str.contains("pass intercepted", case=False, flags=0, na=False, regex=True)),
                            "Pass Interception", play_df['type.text'])

            ##-- fourth one looks for sacked
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & (play_df.text.str.contains("sacked", case=False, flags=0, na=False, regex=True)), "Sack", play_df['type.text'])

            ##-- fifth one play type is Passing Touchdown, but its intercepted 
        play_df['type.text'] = np.where((play_df['type.text'] == "Passing Touchdown") & (play_df.text.str.contains("pass intercepted for a TD", case=False, flags=0, na=False, regex=True)),
                            "Interception Return Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where((play_df['type.text'] == "Passing Touchdown") & (play_df.text.str.contains("pass intercepted for a TD", case=False, flags=0, na=False, regex=True)),
                            "Interception Return Touchdown", play_df['type.text'])
            #--- Moving non-Touchdown pass interceptions to one play_type: "Interception Return" -----
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Interception"]), "Interception Return", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Pass Interception"]), "Interception Return", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Pass Interception Return"]), "Interception Return", play_df['type.text'])

            #--- Moving Kickoff/Punt Touchdowns without fumbles to Kickoff/Punt Return Touchdown
        play_df['type.text'] = np.where((play_df['type.text'] == "Kickoff Touchdown") & (play_df.fumble_vec == False),  "Kickoff Return Touchdown", play_df['type.text'])

        play_df['type.text'] = np.where((play_df['type.text'].isin(["Kickoff", "Kickoff Return (Offense)"])) & 
                            (play_df.fumble_vec == True) & (play_df.change_of_poss == True), 
                            "Kickoff Team Fumble Recovery", play_df['type.text'])

        play_df['type.text'] = np.where((play_df['type.text'] == "Punt Touchdown") & (play_df.fumble_vec == False), "Punt Return Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where((play_df['type.text'] == "Punt") & (play_df.fumble_vec == True) & (play_df.change_of_poss == False), "Punt Team Fumble Recovery", play_df['type.text'])

        play_df['type.text'] = np.where(play_df['type.text'].isin(["Punt Touchdown"]), "Punt Team Fumble Recovery Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Kickoff Touchdown"]), "Kickoff Team Fumble Recovery Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where((play_df['type.text'].isin(["Fumble Return Touchdown"])) & ((play_df["pass"] == True) | (play_df["rush"] == True)), "Fumble Recovery (Opponent) Touchdown", play_df['type.text'])

            #--- Safeties (kickoff, punt, penalty) ----
        play_df['type.text'] = np.where(
            (play_df['type.text'].isin(["Pass Reception", "Rush", "Rushing Touchdown"]) 
            & ((play_df["pass"] == True) | (play_df["rush"] == True)) 
            & (play_df["safety"] == True))
            , "Safety", play_df["type.text"]
        )
        
        play_df['type.text'] = np.where(
                (play_df.kickoff_safety == True),
            f"Kickoff (Safety)", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df.punt_safety == True)
                | (play_df.penalty_safety == True),
            f"{play_df['type.text']} (Safety)", play_df['type.text']
        )
        play_df['type.text'] = np.where(
                (play_df['type.text'] == 'Extra Point Good') &
                (play_df["text"].str.contains("Two-Point", case=False, flags=0, na=False, regex=True)),
                "Two-Point Conversion Good", play_df['type.text']
        )
        play_df['type.text'] = np.where(
                (play_df['type.text'] == 'Extra Point Missed') &
                (play_df["text"].str.contains("Two-Point", case=False, flags=0, na=False, regex=True)),
                "Two-Point Conversion Missed", play_df['type.text']
        )
        play_df = self.__setup_penalty_data__(play_df)
            #--- Sacks ----
        play_df['sack'] = np.select(
            [
                play_df['type.text'].isin(["Sack"]),
                (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"])) & 
                (play_df['pass'] == True) & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)),
                ((play_df['type.text'].isin(["Safety"])) & (play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
            ],
            [
                True,
                True,
                True
            ], default = False)

            #--- Interceptions ------
        play_df["int"] = play_df["type.text"].isin(["Interception Return", "Interception Return Touchdown"])
        play_df["int_td"] = play_df["type.text"].isin(["Interception Return Touchdown"])

            #--- Pass Completions, Attempts and Targets -------
        play_df['completion'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & 
                            play_df['pass'] == True & ~play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))

        play_df['pass_attempt'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown", "Pass Incompletion"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & 
                            play_df['pass'] == True & ~play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))

        play_df['target'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown", "Pass Incompletion"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & 
                            play_df['pass'] == True & ~play_df["text"].str.contains("sacked", case=False, flags=0, na=False, regex=True)))
        play_df['pass_breakup'] = play_df['text'].str.contains('broken up by', case=False, flags=0, na=False, regex=True)
            #--- Pass/Rush TDs ------
        play_df['pass_td'] = (play_df["type.text"] == "Passing Touchdown") | ((play_df["pass"] == True) & (play_df["td_play"] == True))
        play_df['rush_td'] = (play_df["type.text"] == "Rushing Touchdown") | ((play_df["rush"] == True) & (play_df["td_play"] == True))
        
            #-- Change of possession via turnover
        play_df['turnover_vec'] = play_df["type.text"].isin(turnover_vec)
        play_df['offense_score_play'] = play_df["type.text"].isin(offense_score_vec)
        play_df['defense_score_play'] = play_df["type.text"].isin(defense_score_vec)
        play_df['downs_turnover'] = np.where(
            (play_df["type.text"].isin(normalplay))
            & (play_df["statYardage"] < play_df["start.distance"])
            & (play_df["start.down"] == 4)
            & (play_df["penalty_1st_conv"] == False)
        , True, False)

            #-- Touchdowns----
        play_df['scoring_play'] = play_df["type.text"].isin(scores_vec)
        play_df['yds_punted'] = play_df["text"].str.extract(r"(?<= punt for)[^,]+(\d+)", flags=re.IGNORECASE).astype(float)
        play_df['yds_punt_gained'] = np.where(play_df.punt == True, play_df["statYardage"], None)
        play_df['fg_attempt'] =  np.where(
            (play_df["type.text"].str.contains("Field Goal", case=False, flags=0, na=False, regex=True))|
            (play_df["text"].str.contains("Field Goal", case=False, flags=0, na=False, regex=True)), 
            True, False
        )
        play_df['fg_made'] = (play_df["type.text"] == "Field Goal Good")
        play_df['yds_fg'] = play_df["text"].str.extract(r"(\\d{0,2}) Yd|(\\d{0,2}) Yard FG|(\\d{0,2}) Field|(\\d{0,2}) Yard Field", 
                                                        flags=re.IGNORECASE).bfill(axis=1)[0].astype(float)
        play_df['start.yardsToEndzone'] = np.where(
            play_df['fg_attempt'] == True, 
            play_df['yds_fg'] - 17, 
            play_df["start.yardsToEndzone"])
        play_df["start.yardsToEndzone"] = np.select(
        [
            (play_df["start.yardsToEndzone"].isna())&(~play_df["type.text"].isin(kickoff_vec)) &(play_df.is_home == True),
            (play_df["start.yardsToEndzone"].isna())&(~play_df["type.text"].isin(kickoff_vec)) &(play_df.is_home == False)
        ],
        [   
            100-play_df["start.yardLine"].astype(float),
            play_df["start.yardLine"].astype(float)
        ], default = play_df["start.yardsToEndzone"]
        )
            

        play_df["pos_unit"] = np.select(
            [
                play_df.punt == True, 
                play_df.kickoff_play == True,
                play_df.fg_attempt == True,
                play_df["type.text"] == "Defensive 2pt Conversion"
            ], 
            [
                'Punt Offense', 
                'Kickoff Return', 
                'Field Goal Offense',
                'Offense'
            ], 
            default='Offense'
        )
        
        play_df["def_pos_unit"] = np.select(
            [
                play_df.punt == True, 
                play_df.kickoff_play == True,
                play_df.fg_attempt == True,
                play_df["type.text"] == "Defensive 2pt Conversion"
            ], 
            [
                'Punt Return', 
                'Kickoff Defense', 
                'Field Goal Defense',
                'Defense'
            ], 
            default='Defense'
        )
            #--- Lags/Leads play type ----
        play_df['lead_play_type'] = play_df['type.text'].shift(-1)
        #-- Change of pos_team by lead('pos_team', 1)----
        play_df['change_of_pos_team'] = np.where(
            (play_df.pos_team == play_df.lead_pos_team) & (~(play_df.lead_play_type.isin(["End Period", "End of Half"])) | play_df.lead_play_type.isna() == True),
            False,
            np.where(
                (play_df.pos_team == play_df.lead_pos_team2) & ((play_df.lead_play_type.isin(["End Period", "End of Half"])) | play_df.lead_play_type.isna() == True),
                False,
                True
            )
        )
        play_df['change_of_pos_team'] = np.where(play_df['change_of_poss'].isna(), False, play_df['change_of_pos_team'])

        return play_df
    
    def __add_yardage_cols__(self, play_df):
        play_df['yds_rushed'] = None
        play_df['yds_rushed'] = np.select([
            (play_df.rush == True) & (play_df.text.str.contains("run for no gain", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("rush for no gain", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("run for a loss of", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("rush for a loss of", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("run for", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("rush for", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("Yd Run", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("Yd Rush", case=False, flags=0, na=False, regex=True)),
            (play_df.rush == True) & (play_df.text.str.contains("Yard Rush", case=False, flags=0, na=False, regex=True))
        ],[
            0.0,
            0.0,
            -1 * play_df.text.str.extract(r"((?<=run for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            -1 * play_df.text.str.extract(r"((?<=rush for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<=run for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<=rush for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.extract(r"(\d{0,2}) Yd Run", flags=re.IGNORECASE)[0].astype(float),
            play_df.text.str.extract(r"(\d{0,2}) Yd Rush", flags=re.IGNORECASE)[0].astype(float),
            play_df.text.str.extract(r"(\d{0,2}) Yard Rush", flags=re.IGNORECASE)[0].astype(float)
        ], default = None)
        
        
        play_df['yds_receiving'] = None
        play_df['yds_receiving'] = np.select([
            (play_df["pass"] == True) & (play_df.text.str.contains("pass complete to", case=False)) & (play_df.text.str.contains(r"for no gain", case=False)),
            (play_df["pass"] == True) & (play_df.text.str.contains("pass complete to", case=False)) & (play_df.text.str.contains("for a loss", case=False)),
            (play_df["pass"] == True) & (play_df.text.str.contains("pass complete to", case=False)),
        ],[
            0.0,
            -1 * play_df.text.str.extract(r"((?<=for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<=for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float)
        ], default = None)

        play_df['yds_int_return'] = None
        play_df['yds_int_return'] = np.select([
            (play_df["pass"] == True) & (play_df["int_td"] == True) & (play_df.text.str.contains("Yd Interception Return", case=False)),
            (play_df["pass"] == True) & (play_df["int"] == True) & (play_df.text.str.contains(r"for no gain", case=False)),
            (play_df["pass"] == True) & (play_df["int"] == True) & (play_df.text.str.contains(r"for a loss of", case=False)),
            (play_df["pass"] == True) & (play_df["int"] == True) & (play_df.text.str.contains(r"for a TD", case=False)),
            (play_df["pass"] == True) & (play_df["int"] == True) & (play_df.text.str.contains(r"return for", case=False)),
            (play_df["pass"] == True) & (play_df["int"] == True)
        ],[
            play_df.text.str.extract(r"(.+) Interception Return", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            0.0,
            -1 * play_df.text.str.extract(r"((?<= for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float),
            play_df.text.str.replace("for a 1st", "").str.extract(r"((?<=for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\\d+)")[0].astype(float)
        ], default = None)

        #     play_df['yds_fumble_return'] = None
        #     play_df['yds_penalty'] = None
    
        play_df['yds_kickoff'] = None
        play_df['yds_kickoff'] = np.where(
            (play_df["kickoff_play"] == True),
            play_df.text.str.extract(r"((?<= kickoff for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df['yds_kickoff']
        )
        
        play_df['yds_kickoff_return'] = None
        play_df['yds_kickoff_return'] = np.select([
            (play_df.kickoff_play == True) & (play_df.kickoff_tb == True),
            (play_df.kickoff_play == True) & (play_df.fumble_vec == False) & (play_df.text.str.contains(r"for no gain|fair catch|fair caught", regex=True,case = False)),
            (play_df.kickoff_play == True) & (play_df.fumble_vec == False) & (play_df.text.str.contains(r"out-of-bounds|out of bounds", regex=True,case = False)),
            ((play_df.kickoff_downed == True) | (play_df.kickoff_fair_catch == True)),
            (play_df.kickoff_play == True) & (play_df.text.str.contains(r"return for", regex=True,case = False)),
            (play_df.kickoff_play == True)
        ],
        [
            25,
            0,
            40,
            0,
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= returned for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
        ],
        default = play_df['yds_kickoff_return'])
        
        play_df['yds_punted'] = None
        play_df['yds_punted'] = np.select([
            (play_df.punt == True) & (play_df.punt_blocked == True),
            (play_df.punt == True)
        ],
        [
            0,
            play_df.text.str.extract(r"((?<= punt for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default = play_df.yds_punted)

        play_df['yds_punt_return'] = np.select([
            (play_df.punt == True) & (play_df.punt_tb == 1),
            (play_df.punt == True) & (play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True)),
            (play_df.punt == True) & ((play_df.punt_downed == True) | (play_df.punt_oob == True) | (play_df.punt_fair_catch == True)),
            (play_df.punt == True) & (play_df.punt_blocked == False),
            (play_df.punt == True) & (play_df.punt_blocked == True),
        ],
        [
            20,
            0,
            0,
            play_df.text.str.extract(r"((?<= returns for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default=None)
        
        play_df['yds_fumble_return'] = np.select([
            (play_df.fumble_vec == True) & (play_df.kickoff_play == False),
        ],
        [
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default=None)
        
        play_df['yds_sacked'] = np.select([
            (play_df.sack == True),
        ],
        [
            -1 * play_df.text.str.extract(r"((?<= sacked)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default=None)
        
        play_df['yds_penalty'] = np.select([
            (play_df.penalty_detail == 1),
        ],
        [
            -1 * play_df.text.str.extract(r"((?<= sacked)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default=None)

        play_df['yds_penalty'] = np.select([
            play_df.penalty_detail.isin(["Penalty Declined","Penalty Offset"]),
            play_df.yds_penalty.notna(),
            (play_df.penalty_detail.notna()) & (play_df.yds_penalty.isna()) & (play_df.rush == True),
            (play_df.penalty_detail.notna()) & (play_df.yds_penalty.isna()) & (play_df.int == True),
            (play_df.penalty_detail.notna()) & (play_df.yds_penalty.isna()) & (play_df["pass"] == 1) & (play_df["sack"] == False) & (play_df["type.text"] != "Pass Incompletion"),
            (play_df.penalty_detail.notna()) & (play_df.yds_penalty.isna()) & (play_df["pass"] == 1) & (play_df["sack"] == False) & (play_df["type.text"] == "Pass Incompletion"),
            (play_df.penalty_detail.notna()) & (play_df.yds_penalty.isna()) & (play_df["pass"] == 1) & (play_df["sack"] == True),
            (play_df["type.text"] == "Penalty")
        ],
        [
            0,
            play_df.yds_penalty.astype(float),
            play_df.statYardage.astype(float) - play_df.yds_rushed.astype(float),
            play_df.statYardage.astype(float) - play_df.yds_int_return.astype(float),
            play_df.statYardage.astype(float) - play_df.yds_receiving.astype(float),
            play_df.statYardage.astype(float),
            play_df.statYardage.astype(float) - play_df.yds_sacked.astype(float),
            play_df.statYardage.astype(float),
        ], default=None)
        return play_df
    
    def __add_player_cols__(self, play_df):
        play_df['rush_player'] = None
        play_df['receiver_player'] = None
        play_df['pass_player'] = None
        play_df['sack_players'] = None
        play_df['sack_player1'] = None
        play_df['sack_player2'] = None
        play_df['interception_player'] = None
        play_df['pass_breakup_player'] = None
        play_df['fg_kicker_player'] = None
        play_df['fg_return_player'] = None
        play_df['fg_block_player'] = None
        play_df['punter_player'] = None
        play_df['punt_return_player'] = None
        play_df['punt_block_player'] = None
        play_df['punt_block_return_player'] = None
        play_df['kickoff_player'] = None
        play_df['kickoff_return_player'] = None
        play_df['fumble_player'] = None
        play_df['fumble_forced_player'] = None
        play_df['fumble_recovered_player'] = None
        play_df['rush_player_name'] = None
        play_df['receiver_player_name'] = None
        play_df['passer_player_name'] = None
        play_df['sack_player_name'] = None
        play_df['sack_player_name2'] = None
        play_df['interception_player_name'] = None
        play_df['pass_breakup_player_name'] = None
        play_df['fg_kicker_player_name'] = None
        play_df['fg_return_player_name'] = None
        play_df['fg_block_player_name'] = None
        play_df['punter_player_name'] = None
        play_df['punt_return_player_name'] = None
        play_df['punt_block_player_name'] = None
        play_df['punt_block_return_player_name'] = None
        play_df['kickoff_player_name'] = None
        play_df['kickoff_return_player_name'] = None
        play_df['fumble_player_name'] = None
        play_df['fumble_forced_player_name'] = None
        play_df['fumble_recovered_player_name'] = None

        ## Extract player names
        # RB names
        play_df['rush_player'] = np.where(
            (play_df.rush == 1),
            play_df.text.str.extract(r"(.{0,25} )run |(.{0,25} )\d{0,2} Yd Run|(.{0,25} )rush ").bfill(axis=1)[0],
            None
        )
        play_df['rush_player'] = play_df.rush_player.str.replace(r" run | \d+ Yd Run| rush ", "", regex=True)

                
        # QB names 
        play_df['pass_player'] = np.where(
            (play_df["pass"] == 1) & (play_df["type.text"] != "Passing Touchdown"),
            play_df.text.str.extract(r"pass from (.*?) \(|(.{0,30} )pass |(.+) sacked by|(.+) sacked for|(.{0,30} )incomplete ").bfill(axis=1)[0],
            play_df['pass_player']
        )
        play_df['pass_player'] = play_df.pass_player.str.replace("pass | sacked by| sacked for| incomplete", "", regex=True)
        
        play_df['pass_player'] = np.where(
            (play_df["pass"] == 1) & (play_df["type.text"] == "Passing Touchdown"),
            play_df.text.str.extract("pass from(.+)")[0],
            play_df['pass_player']
        )
        play_df['pass_player'] = play_df.pass_player.str.replace("pass from", "", regex=True)
        play_df['pass_player'] = play_df.pass_player.str.replace(r"\(.+\)", "", regex=True)
        play_df['pass_player'] = play_df.pass_player.str.replace(r" \,", "", regex=True)
        
        play_df['pass_player'] = np.where(
            (play_df["type.text"] == "Passing Touchdown") & play_df.pass_player.isna(),
            play_df.text.str.extract("(.+)pass complete to")[0],
            play_df['pass_player']
        )
        play_df['pass_player'] = play_df.pass_player.str.replace(" pass complete to(.+)", "", regex=True)
        play_df['pass_player'] = play_df.pass_player.str.replace(" pass complete to", "", regex=True)
        
        play_df['pass_player'] = np.where(
            (play_df["type.text"] == "Passing Touchdown") & play_df.pass_player.isna(),
            play_df.text.str.extract("(.+)pass,to")[0],
            play_df['pass_player']
        )
        
        play_df['pass_player'] = play_df.pass_player.str.replace(" pass,to(.+)", "", regex=True)
        play_df['pass_player'] = play_df.pass_player.str.replace(" pass,to", "", regex=True)

        
        play_df['receiver_player'] = np.where(
            (play_df["pass"] == 1) & ~play_df.text.str.contains("sacked", case=False, flags=0, na=False, regex=True),
            play_df.text.str.extract("to (.+)")[0],
            None
        )
        
        play_df['receiver_player'] = np.where(
            play_df.text.str.contains("Yd pass", case=False, flags=0, na=False, regex=True),
            play_df.text.str.extract("(.{0,25} )\\d{0,2} Yd pass", flags=re.IGNORECASE)[0],
            play_df['receiver_player']
        )
            
        play_df['receiver_player'] = np.where(
            play_df.text.str.contains("Yd TD pass", case=False),
            play_df.text.str.extract("(.{0,25} )\\d{0,2} Yd TD pass", flags=re.IGNORECASE)[0],
            play_df['receiver_player']
        )
            
        play_df['receiver_player'] = np.where(
            (play_df["type.text"] == "Sack")
            | (play_df["type.text"] == "Interception Return")
            | (play_df["type.text"] == "Interception Return Touchdown")
            | (play_df["type.text"].isin(["Fumble Recovery (Opponent) Touchdown","Fumble Recovery (Opponent)"]) & play_df.text.str.contains("sacked", case=False)),
            None,
            play_df['receiver_player']
        )

        play_df.receiver_player = play_df.receiver_player.str.replace("to ", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("\\,.+", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("for (.+)", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(r" (\d{1,2})", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" Yd pass", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" Yd TD pass", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("pass complete to", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("penalty", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" \"", "", case=False,regex=True)
        play_df.receiver_player = np.where(
            ~(play_df.receiver_player.str.contains("III", na=False)),
            play_df.receiver_player.str.replace("[A-Z]{3,}","", case=True,regex=True),
            play_df.receiver_player
        )

        play_df.receiver_player = play_df.receiver_player.str.replace(" &", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("A&M", "", case=True,regex=False)
        play_df.receiver_player = play_df.receiver_player.str.replace(" ST", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" GA", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" UL", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" FL", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" OH", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" NC", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" \"", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" \\u00c9", "", case=True,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace(" fumbled,", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("the (.+)", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("pass incomplete to", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("(.+)pass incomplete to", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("(.+)pass incomplete", "", case=False,regex=True)
        play_df.receiver_player = play_df.receiver_player.str.replace("pass incomplete","", case=False,regex=True)
        
        play_df['sack_players'] = np.where(
            (play_df["sack"] == True) | (play_df["fumble_vec"] == True) & (play_df["pass"] == True) ,
            play_df.text.str.extract("sacked by(.+)", flags=re.IGNORECASE)[0],
            play_df.sack_players
        )
        
        play_df['sack_players'] = play_df['sack_players'].str.replace("for (.+)","", case=True, regex=True)
        play_df['sack_players'] = play_df['sack_players'].str.replace("(.+) by ","", case=True, regex=True)
        play_df['sack_players'] = play_df['sack_players'].str.replace(" at the (.+)","", case=True, regex=True)
        play_df['sack_player1'] = play_df['sack_players'].str.replace("and (.+)","", case=True, regex=True)
        play_df['sack_player2'] = np.where(play_df['sack_players'].str.contains("and (.+)"),
                                        play_df['sack_players'].str.replace("(.+) and","", case=True, regex=True),
                                        None)
        
        play_df['interception_player'] = np.where(
            (play_df["type.text"] == "Interception Return") | (play_df["type.text"] == "Interception Return Touchdown") & 
            play_df['pass'] == True, play_df.text.str.extract('intercepted (.+)', flags=re.IGNORECASE)[0], 
            play_df.interception_player
        )
        
        play_df['interception_player'] = np.where(
            play_df.text.str.contains('Yd Interception Return', case=True, regex=True),
            play_df.text.str.extract('(.{0,25} )\\d{0,2} Yd Interception Return|(.{0,25} )\\d{0,2} yd interception return', flags=re.IGNORECASE).bfill(axis=1)[0],
            play_df.interception_player
        )
        play_df['interception_player'] = play_df['interception_player'].str.replace("return (.+)","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("(.+) intercepted","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("intercepted","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("Yd Interception Return","", regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("for a 1st down","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("(\\d{1,2})","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("for a TD","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace("at the (.+)","", case = True, regex = True)
        play_df['interception_player'] = play_df['interception_player'].str.replace(" by ","", case = True, regex = True)

        play_df['pass_breakup_player'] = np.where(
            play_df["pass"] == True, play_df.text.str.extract("broken up by (.+)"), play_df.pass_breakup_player
        )
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("(.+) broken up by", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("broken up by", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("Penalty(.+)", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("SOUTH FLORIDA", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("WEST VIRGINIA", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("MISSISSIPPI ST", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("CAMPBELL", "", case = True, regex = True)
        play_df['pass_breakup_player'] = play_df['pass_breakup_player'].str.replace("COASTL CAROLINA", "", case = True, regex = True)

        play_df["punter_player"] = np.where(
            play_df['type.text'].str.contains("Punt", regex = True), 
            play_df.text.str.extract("(.{0,30}) punt", flags=re.IGNORECASE)[0], 
            play_df.punter_player
        )
        play_df["punter_player"] = play_df["punter_player"].str.replace(" punt", "", case = False, regex = True)
        play_df["punter_player"] = play_df["punter_player"].str.replace(" for(.+)", "", case = False, regex = True)
        
        play_df["punt_return_player"] = np.where(
            play_df["type.text"].str.contains("Punt",  regex = True), 
            play_df.text.str.extract(", (.{0,25}) returns|fair catch by (.{0,25})|, returned by (.{0,25})", flags=re.IGNORECASE).bfill(axis=1)[0], 
            play_df.punt_return_player
        )
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(", ", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" returns", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" returned", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace("fair catch by", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" at (.+)", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" for (.+)", "", case = False, regex = True)

        play_df["punt_block_player"] = np.where(
            play_df["type.text"].str.contains("Punt", case = True, regex=True), 
            play_df.text.str.extract("punt blocked by (.{0,25})| blocked by(.+)", flags=re.IGNORECASE).bfill(axis=1)[0], 
            play_df.punt_block_player
        )
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("punt blocked by |for a(.+)", "", case = True, regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("blocked by(.+)", "", case = True, regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("blocked(.+)", "", case = True, regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace(" for(.+)", "", case = True, regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace(",(.+)", "", case = True, regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("punt blocked by |for a(.+)", "", case = True, regex = True)

        play_df["punt_block_player"] = np.where(
            play_df["type.text"].str.contains("yd return of blocked punt"), play_df.text.str.extract("(.+) yd return of blocked"), 
            play_df.punt_block_player
        )
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("blocked|Blocked", "", regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("\\d+", "", regex = True)
        play_df["punt_block_player"] = play_df["punt_block_player"].str.replace("yd return of", "", regex = True)
        
        play_df["punt_block_return_player"] = np.where(
            (play_df["type.text"].str.contains("Punt", case=False, flags=0, na=False, regex=True)) & (play_df.text.str.contains("blocked", case=False, flags=0, na=False, regex=True) & play_df.text.str.contains("return", case=False, flags=0, na=False, regex=True)), 
            play_df.text.str.extract("(.+) return"), 
            play_df.punt_block_return_player
        )
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("(.+)blocked by {punt_block_player}","")
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("blocked by {punt_block_player}","")
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("return(.+)", "", regex = True)
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("return", "", regex = True)
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("(.+)blocked by", "", regex = True)
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("for a TD(.+)|for a SAFETY(.+)", "", regex = True)
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace("blocked by", "", regex = True)
        play_df["punt_block_return_player"] = play_df["punt_block_return_player"].str.replace(", ", "", regex = True)

        play_df["kickoff_player"] = np.where(
            play_df["type.text"].str.contains("Kickoff"), 
            play_df.text.str.extract("(.{0,25}) kickoff|(.{0,25}) on-side").bfill(axis=1)[0], 
            play_df.kickoff_player
        )
        play_df["kickoff_player"] = play_df["kickoff_player"].str.replace(" on-side| kickoff","", regex=True)
        
        play_df["kickoff_return_player"] = np.where(
            play_df["type.text"].str.contains("ickoff"), 
            play_df.text.str.extract(", (.{0,25}) return|, (.{0,25}) fumble|returned by (.{0,25})").bfill(axis=1)[0], 
            play_df.kickoff_return_player
        )
        play_df["kickoff_return_player"] = play_df["kickoff_return_player"].str.replace(", ","", case=False, regex=True)
        play_df["kickoff_return_player"] = play_df["kickoff_return_player"].str.replace(" return| fumble| returned by| for ", "", case=False, regex=True)
        
        play_df["fg_kicker_player"] = np.where(
            play_df["type.text"].str.contains("Field Goal"), 
            play_df.text.str.extract("(.{0,25} )\\d{0,2} yd field goal| (.{0,25} )\\d{0,2} yd fg|(.{0,25} )\\d{0,2} yard field goal").bfill(axis=1)[0], 
            play_df.fg_kicker_player
        )
        play_df["fg_kicker_player"] = play_df["fg_kicker_player"].str.replace(" Yd Field Goal|Yd FG |yd FG| yd FG","", case = False, regex = True)
        play_df["fg_kicker_player"] = play_df["fg_kicker_player"].str.replace("(\\d{1,2})","", case = False, regex = True)
        
        play_df["fg_block_player"] = np.where(
            play_df["type.text"].str.contains("Field Goal"), 
            play_df.text.str.extract("blocked by (.{0,25})"), 
            play_df.fg_block_player
        )
        play_df["fg_block_player"] = play_df["fg_block_player"].str.replace(",(.+)", "", case = False, regex = True)
        play_df["fg_block_player"] = play_df["fg_block_player"].str.replace("blocked by ", "", case = False, regex = True)
        play_df["fg_block_player"] = play_df["fg_block_player"].str.replace("  (.)+", "", case = False, regex = True)
        
        play_df["fg_return_player"] = np.where(
            (play_df["type.text"].str.contains("Field Goal")) &
            (play_df["type.text"].str.contains("blocked by|missed")) &
            (play_df["type.text"].str.contains("return")) , 
            play_df.text.str.extract("  (.+)"), 
            play_df.fg_return_player
        )
        
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace(",(.+)", "", case=False, regex=True) 
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace("return ", "", case=False, regex=True) 
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace("returned ", "", case=False, regex=True) 
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace(" for (.+)", "", case=False, regex=True) 
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace(" for (.+)", "", case=False, regex=True) 

        play_df["fg_return_player"] = np.where(
            play_df["type.text"].isin(["Missed Field Goal Return", "Missed Field Goal Return Touchdown"]),
            play_df.text.str.extract("(.+)return"), 
            play_df.fg_return_player
        )
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace(" return", "", case = False, regex = True)
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace("(.+),", "", case = False, regex = True)
        
        play_df["fumble_player"] = np.where(
            play_df["text"].str.contains("fumble", case=False, flags=0, na=False, regex=True),
            play_df["text"].str.extract("(.{0,25} )fumble"),
            play_df.fumble_player
        )
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" fumble(.+)", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace("fumble", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" yds", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" yd", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace("yardline", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" yards| yard|for a TD|or a safety", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" for ", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(" a safety", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace("r no gain", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace("(.+)(\\d{1,2})", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace("(\\d{1,2})", "", case = False, regex = True)
        play_df["fumble_player"] = play_df["fumble_player"].str.replace(", ", "", case = False, regex = True)
        play_df["fumble_player"] = np.where(play_df["type.text"] == "Penalty", None, play_df.fumble_player)
        
        play_df["fumble_forced_player"] = np.where(
            (play_df.text.str.contains("fumble", case=False, flags=0, na=False, regex=True)) & 
            (play_df.text.str.contains("forced by", case=False, flags=0, na=False, regex=True)),
            play_df.text.str.extract("forced by(.{0,25})"), 
            play_df.fumble_forced_player)
        
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace("(.+)forced by", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace("forced by", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace(", recove(.+)", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace(", re(.+)", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace(", fo(.+)", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace(", r", "", case = False, regex = True)
        play_df["fumble_forced_player"] = play_df["fumble_forced_player"].str.replace(", ", "", case = False, regex = True)
        play_df["fumble_forced_player"] = np.where(play_df["type.text"] == "Penalty", None, play_df.fumble_forced_player)
        
        play_df["fumble_recovered_player"] = np.where(
            (play_df.text.str.contains("fumble", case=False, flags=0, na=False, regex=True)) & 
            (play_df.text.str.contains("recovered by", case=False, flags=0, na=False, regex=True)),
            play_df.text.str.extract("recovered by(.{0,30})"), 
            play_df.fumble_recovered_player)
        
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("for a 1ST down", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("for a 1st down", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("(.+)recovered", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("(.+) by", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(", recove(.+)", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(", re(.+)", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("a 1st down", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(" a 1st down", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(", for(.+)", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(" for a", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(" fo", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(" , r", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(", r", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("  (.+)", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace(" ,", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("penalty(.+)", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = play_df["fumble_recovered_player"].str.replace("for a 1ST down", "", case = False, regex = True)
        play_df["fumble_recovered_player"] = np.where(play_df["type.text"] == "Penalty", None, play_df.fumble_recovered_player)

        ## Extract player names
        play_df['passer_player_name'] = play_df['pass_player'].str.strip()
        play_df['rusher_player_name'] = play_df['rush_player'].str.strip()
        play_df['receiver_player_name'] = play_df['receiver_player'].str.strip()
        play_df['sack_player_name'] = play_df['sack_player1'].str.strip()
        play_df['sack_player_name2'] = play_df['sack_player2'].str.strip()
        play_df['pass_breakup_player_name'] = play_df['pass_breakup_player'].str.strip()
        play_df['interception_player_name'] = play_df['interception_player'].str.strip()
        play_df['fg_kicker_player_name'] = play_df['fg_kicker_player'].str.strip()
        play_df['fg_block_player_name'] = play_df['fg_block_player'].str.strip()
        play_df['fg_return_player_name'] = play_df['fg_return_player'].str.strip()
        play_df['kickoff_player_name'] = play_df['kickoff_player'].str.strip()
        play_df['kickoff_return_player_name'] = play_df['kickoff_return_player'].str.strip()
        play_df['punter_player_name'] = play_df['punter_player'].str.strip()
        play_df['punt_block_player_name'] = play_df['punt_block_player'].str.strip()
        play_df['punt_return_player_name'] = play_df['punt_return_player'].str.strip()
        play_df['punt_block_return_player_name'] = play_df['punt_block_return_player'].str.strip()
        play_df['fumble_player_name'] = play_df['fumble_player'].str.strip()
        play_df['fumble_forced_player_name'] = play_df['fumble_forced_player'].str.strip()
        play_df['fumble_recovered_player_name'] = play_df['fumble_recovered_player'].str.strip()
        
        play_df.drop([
            'rush_player', 
            'receiver_player', 
            'pass_player', 
            'sack_player1', 
            'sack_player2',
            'pass_breakup_player', 
            'interception_player', 
            'punter_player', 
            'fg_kicker_player', 
            'fg_block_player',
            'fg_return_player',
            'kickoff_player',
            'kickoff_return_player', 
            'punt_return_player',
            'punt_block_player',
            'punt_block_return_player',
            'fumble_player',
            'fumble_forced_player',
            'fumble_recovered_player'
        ],axis=1, inplace=True)
        
        return play_df

    def __calculate_ep_exp_val__(self, matrix):
        return matrix[:,0] * ep_class_to_score_mapping[0] + matrix[:,1] * ep_class_to_score_mapping[1] + matrix[:,2] * ep_class_to_score_mapping[2] + matrix[:,3] * ep_class_to_score_mapping[3] + matrix[:,4] * ep_class_to_score_mapping[4] + matrix[:,5] * ep_class_to_score_mapping[5] + matrix[:,6] * ep_class_to_score_mapping[6]
    
    def __process_epa__(self, play_df):
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down"] = 1
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_1"] = True
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_2"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_3"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_4"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "distance"] = 10
        play_df["start.yardsToEndzone.touchback"] = 99
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "start.yardsToEndzone.touchback"] = 75
        
        start_touchback_data = play_df[ep_start_touchback_columns]
        start_touchback_data.columns = ep_final_names
        # self.logger.info(start_data.iloc[[36]].to_json(orient="records"))

        dtest_start_touchback = xgb.DMatrix(start_touchback_data)
        EP_start_touchback_parts = ep_model.predict(dtest_start_touchback)
        EP_start_touchback = self.__calculate_ep_exp_val__(EP_start_touchback_parts)

        start_data = play_df[ep_start_columns]
        start_data.columns = ep_final_names
        # self.logger.info(start_data.iloc[[36]].to_json(orient="records"))

        dtest_start = xgb.DMatrix(start_data)
        EP_start_parts = ep_model.predict(dtest_start)
        EP_start = self.__calculate_ep_exp_val__(EP_start_parts)

        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "end.TimeSecsRem"] = 0
        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "end.yardsToEndzone"] = 99
        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "down_1_end"] = True
        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "down_2_end"] = False
        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "down_3_end"] = False
        play_df.loc[play_df["end.TimeSecsRem"] <= 0, "down_4_end"] = False

        play_df.loc[play_df["end.yardsToEndzone"] >= 100, "end.yardsToEndzone"] = 99
        play_df.loc[play_df["end.yardsToEndzone"] <= 0, "end.yardsToEndzone"] = 99
        play_df["pos_score_diff_end"] = np.where(
            (play_df["type.text"].isin(end_change_vec)) | (play_df.downs_turnover == True), 
            -1*play_df.pos_score_diff, 
            play_df.pos_score_diff
        )
        end_data = play_df[ep_end_columns]
        end_data.columns = ep_final_names
        # self.logger.info(end_data.iloc[[36]].to_json(orient="records"))
        dtest_end = xgb.DMatrix(end_data)
        EP_end_parts = ep_model.predict(dtest_end)

        EP_end = self.__calculate_ep_exp_val__(EP_end_parts)

        play_df["EP_start_touchback"] = EP_start_touchback
        play_df['EP_start'] = EP_start
        play_df['EP_end'] = EP_end
        kick = 'kick)'
        play_df['EP_start'] = np.where(
            play_df["type.text"].isin(['Extra Point Good','Extra Point Missed', 'Two-Point Conversion Good', 'Two-Point Conversion Missed']), 
            0.92, play_df['EP_start']
        )
        play_df.EP_end = np.select([
            # End of Half
            (play_df["type.text"].str.lower().str.contains("end of game", case=False, flags=0, na=False, regex=True)) | 
            (play_df["type.text"].str.lower().str.contains("end of game", case=False, flags=0, na=False, regex=True)) | 
            (play_df["type.text"].str.lower().str.contains("end of half", case=False, flags=0, na=False, regex=True)) | 
            (play_df["type.text"].str.lower().str.contains("end of half", case=False, flags=0, na=False, regex=True)),
            # Safeties
            ((play_df["type.text"].isin(defense_score_vec)) & 
            (play_df["text"].str.lower().str.contains('safety', case=False, regex=True))),
            # Defense TD + Successful Two-Point Conversion
            ((play_df["type.text"].isin(defense_score_vec)) & 
            (play_df["text"].str.lower().str.contains('conversion', case=False, regex=False)) & 
            (~play_df["text"].str.lower().str.contains('failed\s?\)', case=False, regex=True))),
            # Defense TD + Failed Two-Point Conversion
            ((play_df["type.text"].isin(defense_score_vec)) & 
            (play_df["text"].str.lower().str.contains('conversion', case=False, regex=False)) & 
            (play_df["text"].str.lower().str.contains('failed\s?\)', case=False, regex=True))),
            # Defense TD + Kick/PAT Missed
            ((play_df["type.text"].isin(defense_score_vec)) & 
            (play_df["text"].str.contains('PAT', case=True, regex=False)) & 
            (play_df["text"].str.lower().str.contains('missed\s?\)', case=False, regex=True))),
            # Defense TD + Kick/PAT Good
            ((play_df["type.text"].isin(defense_score_vec)) & 
            (play_df["text"].str.lower().str.contains(kick, case=False, regex=False))),
            # Defense TD 
            (play_df["type.text"].isin(defense_score_vec)),
            # Offense TD + Failed Two-Point Conversion
            ((play_df["type.text"].isin(offense_score_vec)) & 
            (play_df["text"].str.lower().str.contains('conversion', case=False, regex=False)) & 
            (play_df["text"].str.lower().str.contains('failed\s?\)', case=False, regex=True))),
            # Offense TD + Successful Two-Point Conversion
            ((play_df["type.text"].isin(offense_score_vec)) & 
            (play_df["text"].str.lower().str.contains('conversion', case=False, regex=False)) & 
            (~play_df["text"].str.lower().str.contains('failed\s?\)', case=False, regex=True))),
            # Offense Made FG
            ((play_df["type.text"].isin(offense_score_vec)) & 
            (play_df["type.text"].str.lower().str.contains('field goal', case=False, flags=0, na=False, regex=True)) & 
            (play_df["type.text"].str.lower().str.contains('good', case=False, flags=0, na=False, regex=True))),
            # Missed FG -- Not Needed
            # (play_df["type.text"].isin(offense_score_vec)) & 
            # (play_df["type.text"].str.lower().str.contains('field goal', case=False, flags=0, na=False, regex=True)) & 
            # (~play_df["type.text"].str.lower().str.contains('good', case=False, flags=0, na=False, regex=True)),
            # Offense TD + Kick/PAT Missed
            ((play_df["type.text"].isin(offense_score_vec)) & 
            (~play_df['text'].str.lower().str.contains('conversion', case=False, regex=False)) &
            ((play_df['text'].str.contains('PAT', case=True, regex=False))) & 
            ((play_df['text'].str.lower().str.contains('missed\s?\)', case=False, regex=True)))),
            # Offense TD + Kick PAT Good
            ((play_df["type.text"].isin(offense_score_vec)) & 
            (play_df['text'].str.lower().str.contains(kick, case=False, regex=False))),
            # Offense TD 
            (play_df["type.text"].isin(offense_score_vec)),
            # Extra Point Good (pre-2014 data)
            (play_df["type.text"] == "Extra Point Good"),
            # Extra Point Missed (pre-2014 data)
            (play_df["type.text"] == "Extra Point Missed"),
            # Two-Point Good (pre-2014 data)
            (play_df["type.text"] == "Two-Point Conversion Good"),
            # Two-Point Missed (pre-2014 data)
            (play_df["type.text"] == "Two-Point Conversion Missed"),
            # Flips for Turnovers that aren't kickoffs
            (((play_df["type.text"].isin(end_change_vec)) | (play_df.downs_turnover == True)) & (play_df.kickoff_play==False)),
            # Flips for Turnovers that are on kickoffs
            (play_df["type.text"].isin(kickoff_turnovers))
        ],
        [
            0,
            -2,
            -6,
            -8,
            -6,
            -7,
            -6,
            6,
            8,
            3,
            6,
            7,
            6,
            1,
            0,
            2,
            0,
            (play_df.EP_end * -1),
            (play_df.EP_end * -1)
        ], default = play_df.EP_end)
        play_df['lag_EP_end'] = play_df['EP_end'].shift(1)
        play_df['lag_change_of_pos_team'] = play_df.change_of_pos_team.shift(1)
        play_df['lag_change_of_pos_team'] = np.where(play_df['lag_change_of_pos_team'].isna(), False, play_df['lag_change_of_pos_team'])
        play_df['EP_between'] = np.where(
            play_df.lag_change_of_pos_team == True,
            play_df['EP_start'] + play_df['lag_EP_end'],
            play_df['EP_start'] - play_df['lag_EP_end']
        )
        play_df['EP_start'] = np.where(
            (play_df["type.text"].isin(['Timeout','End Period'])) & (play_df['lag_change_of_pos_team'] == False),
            play_df['lag_EP_end'], 
            play_df['EP_start']
        )
        play_df['EPA'] = np.select(
            [
                (play_df["scoring_play"] == False) & (play_df['end_of_half'] == True),
                (play_df["type.text"].isin(kickoff_vec)),
                (play_df["penalty_in_text"]) & (play_df["type.text"] != "Penalty") & (~play_df["type.text"].isin(kickoff_vec))
            ],
            [
                -1*play_df['EP_start'],
                play_df['EP_end'] - play_df['EP_start_touchback'],
                (play_df['EP_end'] - play_df['EP_start'] + play_df['EP_between'])
            ],
            default = (play_df['EP_end'] - play_df['EP_start'])
        )
        
        play_df['def_EPA'] = -1*play_df['EPA']
        play_df['EPA_rush'] = np.where((play_df.rush == True), play_df.EPA, None)
        play_df['EPA_pass'] = np.where((play_df['pass'] == True), play_df.EPA,None)
        play_df['middle_8'] =  np.where((play_df['start.adj_TimeSecsRem'] >= 1560) & (play_df['start.adj_TimeSecsRem'] <= 2040), True, False)
        play_df['rz_play'] =  np.where(play_df['start.yardsToEndzone'] <= 20, True, False)
        play_df['scoring_opp'] =  np.where(play_df['start.yardsToEndzone'] <= 40, True, False)
        play_df['stuffed_run'] =  np.where((play_df.rush == True) & (play_df.yds_rushed <= 0), True, False)
        play_df['stopped_run'] =  np.where((play_df.rush == True) & (play_df.yds_rushed <= 2), True, False)
        play_df['opportunity_run'] =  np.where((play_df.rush == True) & (play_df.yds_rushed >= 4), True, False)
        play_df['highlight_run'] =  np.where((play_df.rush == True) & (play_df.yds_rushed >= 8), True, False)
        play_df['short_rush_success'] = np.where(
            (play_df['start.distance'] < 2) & (play_df.rush == True) & (play_df.statYardage >= play_df['start.distance']), True, False
        )
        play_df['short_rush_attempt'] = np.where(
            (play_df['start.distance'] < 2) & (play_df.rush == True), True, False
        )
        play_df['power_rush_success'] = np.where(
            (play_df['start.distance'] < 2) & (play_df.rush == True) & (play_df.statYardage >= play_df['start.distance']), True, False
        )
        play_df['power_rush_attempt'] = np.where(
            (play_df['start.distance'] < 2) & (play_df.rush == True), True, False
        )
        play_df['EPA_explosive'] = np.where(
            ((play_df['pass'] == True) & (play_df['EPA'] >= 2.4))|
            (((play_df['rush'] == True) & (play_df['EPA'] >= 1.8))), True, False)
        play_df['EPA_explosive_pass'] = np.where(((play_df['pass'] == True) & (play_df['EPA'] >= 2.4)), True, False)
        play_df['EPA_explosive_rush'] = np.where((((play_df['rush'] == True) & (play_df['EPA'] >= 1.8))), True, False)
        play_df['standard_down'] = np.where(
            play_df.down_1 == True, True, np.where(
                (play_df.down_2 == True) & (play_df['start.distance'] < 8), True, np.where(
                    (play_df.down_3 == True) & (play_df['start.distance'] < 5), True, np.where(
                        (play_df.down_4 == True) & (play_df['start.distance'] < 5), True, False 
                    )
                )
            )
        )
        play_df['passing_down'] = np.where(
            play_df.down_1 == True, False, np.where(
                (play_df.down_2 == True) & (play_df['start.distance'] >= 8), True, np.where(
                    (play_df.down_3 == True) & (play_df['start.distance'] >= 5), True, np.where(
                        (play_df.down_4 == True) & (play_df['start.distance'] >= 5), True,  False 
                    )
                )
            )
        )
        play_df['EPA_success'] =  np.where(
            play_df.EPA > 0, True, False
        )
        play_df['EPA_success_standard_down'] =  np.where(
            (play_df.EPA > 0) & (play_df.standard_down == True), True, False
        )
        play_df['EPA_success_passing_down'] =  np.where(
            (play_df.EPA > 0) & (play_df.passing_down == True), True, False
        )
        play_df['EPA_success_pass'] =  np.where(
            (play_df.EPA > 0) & (play_df['pass'] == True), True, False
        )
        play_df['EPA_success_rush'] =  np.where(
            (play_df.EPA > 0) & (play_df.rush == True), True, False
        )
        play_df['EPA_success_EPA'] = np.where(
            play_df.EPA > 0, play_df.EPA, None
        )
        play_df['EPA_success_standard_down_EPA'] =  np.where(
            (play_df.EPA > 0) & (play_df.standard_down == True), play_df.EPA, None
        )
        play_df['EPA_success_passing_down_EPA'] =  np.where(
            (play_df.EPA > 0) & (play_df.passing_down == True), play_df.EPA, None
        )
        play_df['EPA_success_pass_EPA'] =  np.where(
            (play_df.EPA > 0) & (play_df['pass'] == True), play_df.EPA, None
        )
        play_df['EPA_success_rush_EPA'] =  np.where(
            (play_df.EPA > 0) & (play_df.rush == True), True, False
        )
        play_df['sp'] = np.where(
           (play_df.fg_attempt == True)|(play_df.punt == True)|(play_df.kickoff_play == True),True,False 
        )
        play_df['play'] = np.where(
            (play_df['type.text'] != 'Timeout'), True, False
        )
        play_df['scrimmage_play'] = np.where(
            (play_df.sp == False) & (play_df['type.text'] != 'Timeout'), True, False
        )
        play_df['EPA_penalty'] = np.select(
            [
                (play_df['type.text'].isin(['Penalty','Penalty (Kickoff)'])),
                (play_df['penalty_in_text'] == True)
            ],
            [
                play_df['EPA'],
                play_df['EP_end'] - play_df['EP_start']
            ], default = None
        )
        play_df['EPA_sp'] = np.where(
           (play_df.fg_attempt == True)|(play_df.punt == True)|(play_df.kickoff_play == True), play_df['EPA'], False 
        )
        play_df['EPA_fg'] = np.where(
           (play_df.fg_attempt == True), play_df['EPA'], None 
        )
        play_df['EPA_punt'] = np.where(
           (play_df.punt == True), play_df['EPA'], None 
        )
        play_df['EPA_kickoff'] = np.where(
           (play_df.kickoff_play == True), play_df['EPA'], None 
        )
        play_df['TFL'] = np.where(
            (play_df['type.text'] != 'Penalty') & (play_df.sp == False) & (play_df.statYardage < 0), True, False
        )
        play_df['TFL_pass'] = np.where(
            (play_df['TFL'] == True) & (play_df['pass'] == True), True, False
        )
        play_df['TFL_rush'] = np.where(
            (play_df['TFL'] == True) & (play_df['rush'] == True), True, False
        )
        play_df['havoc'] = np.where(
            (play_df['forced_fumble'] == True)|(play_df['int'] == True)|(play_df['TFL'] == True)|(play_df['pass_breakup'] == True),
            True, False
        )
        play_df['havoc_pass'] = np.where(
            (play_df['havoc'] == True) & (play_df['pass'] == True), True, False
        )
        play_df['havoc_rush'] = np.where(
            (play_df['havoc'] == True) & (play_df['rush'] == True), True, False
        )
        return play_df

    def __process_wpa__(self, play_df):
        play_df['ExpScoreDiff'] = play_df.pos_score_diff_start + play_df.EP_start
        play_df['ExpScoreDiff_Time_Ratio'] = play_df['ExpScoreDiff'] / (play_df['start.adj_TimeSecsRem'] + 1)

        play_df['pos_team_spread'] = np.where(
            (play_df["pos_team"] == self.homeTeamId),
            self.homeTeamSpread,
            -1 * self.homeTeamSpread
        )
        # play_df['pos_team_spread'] = np.where(
        #     (play_df["type.text"].isin(end_change_vec)) | (play_df.downs_turnover == True), 
        #     -1*play_df.pos_team_spread, 
        #     play_df.pos_team_spread
        # )

        play_df['elapsed_share'] = ((3600 - play_df['start.adj_TimeSecsRem']) / 3600).clip(0, 3600)
        play_df['spread_time'] = play_df.pos_team_spread * np.exp(-4 * play_df.elapsed_share)

        play_df['ExpScoreDiff_end'] = play_df.pos_score_diff_start + play_df.EP_end
        play_df['ExpScoreDiff_Time_Ratio_end'] = play_df.ExpScoreDiff_end / (play_df["end.adj_TimeSecsRem"] + 1)

        play_df['elapsed_share_end'] = ((3600 - play_df["end.adj_TimeSecsRem"]) / 3600).clip(0, 3600)
        play_df['spread_time_end'] = play_df.pos_team_spread * np.exp(-4 * play_df.elapsed_share_end)

        start_data = play_df[wp_start_columns]
        start_data.columns = wp_final_names
        # self.logger.info(start_data.iloc[[36]].to_json(orient="records"))
        dtest_start = xgb.DMatrix(start_data)
        WP_start = wp_model.predict(dtest_start)

        play_df['wp_before'] = WP_start

        play_df['wp_before'] = np.select([
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  0),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  0.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -0.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  1),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -1),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  1.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -1.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  2),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -2),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  2.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -2.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  3),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -3),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  3.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -3.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  4),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -4),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  4.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -4.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  5.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -5.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  6),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -6),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  6.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -6.5),   
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  7),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -7),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  7.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  -7.5),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  8),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -8), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  8.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -8.5),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  9),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -9),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  9.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -9.5),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  10),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -10),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  10.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -10.5),   
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  11),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -11),   
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  11.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -11.5),    
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  12),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -12),  
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  12.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -12.5), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  13),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -13), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  13.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -13.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  14),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -14), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  14.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -14.5), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  15),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -15), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  15.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -15.5), 
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  16),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -16),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  16.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -16.5),    
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  17),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -17),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  17.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -17.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  18),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -18),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  18.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -18.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  19),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -19),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread ==  19.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread == -19.5),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread >=  20),
            (play_df.game_play_number == 1) & (play_df.pos_team_spread >= -20)
        ],
        [
            0.50,
            0.50,
            0.50,
            0.512,
            0.4880,
            0.5250,
            0.4660,
            0.5340,
            0.4660,
            0.5430,
            0.4570,
            0.5740,
            0.4260,
            0.6060,
            0.3940,
            0.6190,
            0.3810,
            0.6310,
            0.3690,
            0.6410,
            0.3590,
            0.6510,
            0.3490,
            0.6640,
            0.3360,
            0.6770,
            0.3230,   
            0.7030,
            0.2970,  
            0.7300,
            0.2700,  
            0.7380,
            0.2620, 
            0.7460,
            0.2540,  
            0.7510,
            0.2490,  
            0.7550,
            0.2450,  
            0.7740,
            0.2260,
            0.7930,
            0.2080,   
            0.7990,
            0.2010,   
            0.8060,
            0.1940,    
            0.8160,
            0.1840,  
            0.8260,
            0.1740, 
            0.8300,
            0.1700, 
            0.8350,
            0.1650,
            0.8510,
            0.1490, 
            0.8680,
            0.1320, 
            0.8740,
            0.1260, 
            0.8810,
            0.1190, 
            0.8860,
            0.1140,
            0.8910,
            0.1090,    
            0.9140,
            0.0860,
            0.9370,
            0.0630,
            0.9500,
            0.0500,
            0.9620,
            0.0380,
            0.9730,
            0.0270,
            0.9840,
            0.0160,
            0.9999,
            0.0001,
        ], default = play_df.wp_before)

        play_df['def_wp_before']  = 1 - play_df.wp_before
        play_df['home_wp_before'] = np.where(play_df.pos_team == self.homeTeamId,
                                        play_df.wp_before, 
                                        play_df.def_wp_before)
        play_df['away_wp_before'] = np.where(play_df.pos_team != self.homeTeamId,
                                        play_df.wp_before, 
                                        play_df.def_wp_before)

        play_df['lead_wp_before'] = play_df['wp_before'].shift(-1)
        play_df['lead_wp_before2'] = play_df['wp_before'].shift(-2)

        # base wpa
        play_df['wpa_base'] = play_df.lead_wp_before - play_df.wp_before
        play_df['wpa_base_nxt'] = play_df.lead_wp_before2 - play_df.wp_before
        play_df['wpa_base_ind'] = (play_df.pos_team == play_df.lead_pos_team)
        play_df['wpa_base_nxt_ind'] = (play_df.pos_team == play_df.lead_pos_team2)

        # account for turnover
        play_df['wpa_change'] = (1 - play_df.lead_wp_before) - play_df.wp_before
        play_df['wpa_change_nxt'] = (1 - play_df.lead_wp_before2) - play_df.wp_before
        play_df['wpa_change_ind'] = (play_df.pos_team != play_df.lead_pos_team)
        play_df['wpa_change_nxt_ind'] = (play_df.pos_team != play_df.lead_pos_team2)

        play_df['wpa_half_end'] = np.select([
            (play_df.end_of_half == 1) & (play_df.wpa_base_nxt_ind == 1) & (play_df.playType != "Timeout"),
            (play_df.end_of_half == 1) & (play_df.wpa_change_nxt_ind == 1) & (play_df.playType != "Timeout"),
            (play_df.end_of_half == 1) & (play_df.pos_team_receives_2H_kickoff == False) & (play_df.playType == "Timeout"),
            (play_df.wpa_change_ind == 1)
        ],
        [
            play_df.wpa_base_nxt,
            play_df.wpa_change_nxt,
            play_df.wpa_base,
            play_df.wpa_change
        ],
        default = play_df.wpa_base)

        play_df['wpa'] = np.where(
            (play_df.end_of_half == 1) & (play_df.playType != "Timeout"), 
            play_df.wpa_half_end, 
            np.where(
                play_df.lead_play_type.isin(["End Period", "End of Half"]) & (play_df.change_of_pos_team == 0),
                play_df.wpa_base_nxt,
                np.where(
                    play_df.lead_play_type.isin(["End Period", "End of Half"]) & (play_df.change_of_pos_team == 1),
                    play_df.wpa_change_nxt,
                    np.where(play_df.wpa_change_ind == 1, play_df.wpa_change, play_df.wpa_base)
                )
            )
        )

        play_df['wp_after'] = play_df.wp_before + play_df.wpa
        play_df['def_wp_after'] = 1 - play_df.wp_after
        play_df['home_wp_after'] = np.where(play_df.pos_team == self.homeTeamId,
                        play_df.home_wp_before + play_df.wpa,
                        play_df.home_wp_before - play_df.wpa)
        play_df['away_wp_after'] = np.where(play_df.pos_team != self.homeTeamId,
                        play_df.away_wp_before + play_df.wpa,
                        play_df.away_wp_before - play_df.wpa)

        return play_df
    
    def __add_drive_data__(self, play_df):
        base_groups = play_df.groupby(['driveId'])
        play_df['drive_start'] = np.where(
            play_df.pos_team == self.homeTeamId,
            100 - play_df["start.yardLine_drive"].astype(float),
            play_df["start.yardLine_drive"].astype(float)
        )
        play_df['prog_drive_EPA'] = base_groups['EPA'].apply(lambda x: x.cumsum())
        play_df['prog_drive_WPA'] = base_groups['wpa'].apply(lambda x: x.cumsum())
        play_df['drive_total_yards'] = base_groups['statYardage'].apply(lambda x: x.cumsum())
        return play_df

    def create_box_score(self):
        if (self.ran_pipeline == False):
            self.run_processing_pipeline()
        # have to run the pipeline before pulling this in
        self.plays_json['completion'] = self.plays_json['completion'].astype(float)
        self.plays_json['pass_attempt'] = self.plays_json['pass_attempt'].astype(float)
        self.plays_json['target'] = self.plays_json['target'].astype(float)
        self.plays_json['yds_receiving'] = self.plays_json['yds_receiving'].astype(float)
        self.plays_json['yds_rushed'] = self.plays_json['yds_rushed'].astype(float)
        self.plays_json['rush'] = self.plays_json['rush'].astype(float)
        self.plays_json['rush_td'] = self.plays_json['rush_td'].astype(float)
        self.plays_json['pass'] = self.plays_json['pass'].astype(float)
        self.plays_json['pass_td'] = self.plays_json['pass_td'].astype(float)
        self.plays_json['EPA'] = self.plays_json['EPA'].astype(float)
        self.plays_json['wpa'] = self.plays_json['wpa'].astype(float)
        self.plays_json['int'] = self.plays_json['int'].astype(float)
        self.plays_json['int_td'] = self.plays_json['int_td'].astype(float)
        self.plays_json['def_EPA'] = self.plays_json['def_EPA'].astype(float)
        self.plays_json['EPA_rush'] = self.plays_json['EPA_rush'].astype(float)
        self.plays_json['EPA_pass'] = self.plays_json['EPA_pass'].astype(float)
        self.plays_json['EPA_success'] = self.plays_json['EPA_success'].astype(float)
        self.plays_json['EPA_success_pass'] = self.plays_json['EPA_success_pass'].astype(float)
        self.plays_json['EPA_success_rush'] = self.plays_json['EPA_success_rush'].astype(float)
        self.plays_json['EPA_success_standard_down'] = self.plays_json['EPA_success_standard_down'].astype(float)
        self.plays_json['EPA_success_passing_down'] = self.plays_json['EPA_success_passing_down'].astype(float)
        self.plays_json['middle_8'] = self.plays_json['middle_8'].astype(float)
        self.plays_json['rz_play'] = self.plays_json['rz_play'].astype(float)
        self.plays_json['scoring_opp'] = self.plays_json['scoring_opp'].astype(float)
        self.plays_json['stuffed_run'] = self.plays_json['stuffed_run'].astype(float)
        self.plays_json['stopped_run'] = self.plays_json['stopped_run'].astype(float)
        self.plays_json['opportunity_run'] = self.plays_json['opportunity_run'].astype(float)
        self.plays_json['highlight_run'] =  self.plays_json['highlight_run'].astype(float)
        self.plays_json['short_rush_success'] = self.plays_json['short_rush_success'].astype(float)
        self.plays_json['short_rush_attempt'] = self.plays_json['short_rush_attempt'].astype(float)
        self.plays_json['power_rush_success'] = self.plays_json['power_rush_success'].astype(float)
        self.plays_json['power_rush_attempt'] = self.plays_json['power_rush_attempt'].astype(float)
        self.plays_json['EPA_explosive'] = self.plays_json['EPA_explosive'].astype(float)
        self.plays_json['EPA_explosive_pass'] = self.plays_json['EPA_explosive_pass'].astype(float)
        self.plays_json['EPA_explosive_rush'] = self.plays_json['EPA_explosive_rush'].astype(float)
        self.plays_json['standard_down'] = self.plays_json['standard_down'].astype(float)
        self.plays_json['passing_down'] = self.plays_json['passing_down'].astype(float)
        self.plays_json['fumble_vec'] = self.plays_json['fumble_vec'].astype(float)
        self.plays_json['sack'] = self.plays_json['sack'].astype(float)
        self.plays_json['penalty_flag'] = self.plays_json['penalty_flag'].astype(float)
        self.plays_json['play'] = self.plays_json['play'].astype(float)
        self.plays_json['scrimmage_play'] = self.plays_json['scrimmage_play'].astype(float)
        self.plays_json['sp'] = self.plays_json['sp'].astype(float)
        self.plays_json['kickoff_play'] = self.plays_json['kickoff_play'].astype(float)
        self.plays_json['punt'] = self.plays_json['punt'].astype(float)
        self.plays_json['fg_attempt'] = self.plays_json['fg_attempt'].astype(float)
        self.plays_json['EPA_penalty'] = self.plays_json['EPA_penalty'].astype(float)
        self.plays_json['EPA_sp'] = self.plays_json['EPA_sp'].astype(float)
        self.plays_json['EPA_fg'] = self.plays_json['EPA_fg'].astype(float)
        self.plays_json['EPA_punt'] = self.plays_json['EPA_punt'].astype(float)
        self.plays_json['EPA_kickoff'] = self.plays_json['EPA_kickoff'].astype(float)
        self.plays_json['TFL'] = self.plays_json['TFL'].astype(float)
        self.plays_json['TFL_pass'] = self.plays_json['TFL_pass'].astype(float)
        self.plays_json['TFL_rush'] = self.plays_json['TFL_rush'].astype(float)
        self.plays_json['havoc'] = self.plays_json['havoc'].astype(float)
        self.plays_json['havoc_pass'] = self.plays_json['havoc_pass'].astype(float)
        self.plays_json['havoc_rush'] = self.plays_json['havoc_rush'].astype(float)

        pass_box = self.plays_json[self.plays_json["pass"] == 1]
        rush_box = self.plays_json[self.plays_json.rush == 1]

        passer_box = pass_box.groupby(by=["pos_team","passer_player_name"], as_index=False).agg(
            Comp = ('completion', sum),
            Att = ('pass_attempt',sum),
            Yds = ('yds_receiving',sum),
            Pass_TD = ('pass_td', sum),
            Int = ('int', sum),
            YPA = ('yds_receiving', mean),
            EPA = ('EPA', sum),
            EPA_per_Play = ('EPA', mean),
            WPA = ('wpa', sum),
            SR = ('EPA_success', mean)
        ).round(2)
        passer_box = passer_box.replace({np.nan: None})

        rusher_box = rush_box.groupby(by=["pos_team","rusher_player_name"], as_index=False).agg(
            Car= ('rush', sum),
            Yds= ('yds_rushed',sum),
            Rush_TD = ('rush_td',sum),
            YPC= ('yds_rushed', mean),
            EPA= ('EPA', sum),
            EPA_per_Play= ('EPA', mean),
            WPA= ('wpa', sum),
            SR = ('EPA_success', mean)
        ).round(2)
        rusher_box = rusher_box.replace({np.nan: None})

        receiver_box = pass_box.groupby(by=["pos_team","receiver_player_name"], as_index=False).agg(
            Rec= ('completion', sum),
            Tar= ('target',sum),
            Yds= ('yds_receiving',sum),
            Rec_TD = ('pass_td', sum),
            YPT= ('yds_receiving', mean),
            EPA= ('EPA', sum),
            EPA_per_Play= ('EPA', mean),
            WPA= ('wpa', sum),
            SR = ('EPA_success', mean)
        ).round(2)
        receiver_box = receiver_box.replace({np.nan: None})
        
        team_box = self.plays_json.groupby(by=["pos_team"], as_index=False).agg(
            EPA_plays = ('play', sum),
            scrimmage_plays = ('scrimmage_play', sum),
            EPA_overall_total = ('EPA', sum),
            EPA_passing_overall = ('EPA_pass', sum),
            EPA_rushing_overall = ('EPA_rush', sum),
            EPA_per_play = ('EPA', mean),
            EPA_passing_per_play = ('EPA_pass', mean),
            EPA_rushing_per_play = ('EPA_rush', mean),
            rushes = ('rush', sum),
            rushing_power_success= ('power_rush_success', sum),
            rushing_power_attempt= ('power_rush_attempt', sum),
            rushing_stuff_rate = ('stuffed_run', sum),
            rushing_stopped_rate = ('stopped_run', sum),
            rushing_opportunity_rate = ('opportunity_run', sum),
            rushing_highlight_run = ('highlight_run', sum),
            passes = ('pass', sum),
            passes_completed = ('completion', sum),
            passes_attempted = ('pass_attempt', sum),
            EPA_explosive = ('EPA_explosive', sum),
            EPA_explosive_passing = ('EPA_explosive_pass', sum),
            EPA_explosive_rushing = ('EPA_explosive_rush', sum),
            EPA_success = ('EPA_success', sum),
            EPA_success_pass = ('EPA_success_pass', sum),
            EPA_success_rush = ('EPA_success_rush', sum),
            EPA_success_standard_down = ('EPA_success_standard_down', sum),
            EPA_success_passing_down = ('EPA_success_passing_down', sum),
            EPA_penalty = ('EPA_penalty', sum),
            special_teams_plays = ('sp', sum),
            EPA_sp = ('EPA_sp', sum),
            EPA_fg = ('EPA_fg', sum),
            EPA_punt = ('EPA_punt', sum),
            kickoff_plays = ('kickoff_play', sum),
            EPA_kickoff = ('EPA_kickoff', sum),
            TFL = ('TFL', sum),
            TFL_pass = ('TFL_pass', sum),
            TFL_rush = ('TFL_rush', sum),
            havoc_total = ('havoc', sum),
            havoc_total_pass = ('havoc_pass', sum),
            havoc_total_rush = ('havoc_rush', sum)
        ).round(2)

        team_box = team_box.replace({np.nan:None})

        return {
            "pass" : json.loads(passer_box.to_json(orient="records")),
            "rush" : json.loads(rusher_box.to_json(orient="records")),
            "receiver" : json.loads(receiver_box.to_json(orient="records")),
            "team" : json.loads(team_box.to_json(orient="records"))
        }
        
    def run_processing_pipeline(self):
        if (self.ran_pipeline == False):
            self.plays_json = self.__clean_pbp_data__(self.plays_json)
            self.plays_json = self.__add_yardage_cols__(self.plays_json)
            self.plays_json = self.__add_player_cols__(self.plays_json)
            self.plays_json = self.__process_epa__(self.plays_json)
            self.plays_json = self.__process_wpa__(self.plays_json)
            self.plays_json = self.__add_drive_data__(self.plays_json)
            self.plays_json = self.plays_json.replace({np.nan: None})
            self.ran_pipeline = True
        else:
            self.logger.info("Already ran pipeline for this game. Doing nothing.")
        return self.plays_json