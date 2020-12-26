import pandas as pd
import numpy as np
import xgboost as xgb
import re
from flask_logs import LogSetup

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

wp_start_columns = ["pos_team_receives_2H_kickoff","spread_time","start.TimeSecsRem","start.adj_TimeSecsRem","ExpScoreDiff_Time_Ratio","pos_score_diff_start","start.down","start.distance","start.yardsToEndzone","is_home","start.posTeamTimeouts","start.defTeamTimeouts","period"]
wp_end_columns = ["pos_team_receives_2H_kickoff","spread_time_end","end.TimeSecsRem","end.adj_TimeSecsRem","ExpScoreDiff_Time_Ratio_end","pos_score_diff_start_end","end.down","end.distance","end.yardsToEndzone","is_home","end.posTeamTimeouts","end.defTeamTimeouts","period"]

ep_start_columns = ["start.TimeSecsRem","start.yardsToEndzone","start.distance","down_1","down_2","down_3","down_4","pos_score_diff_start"]
ep_end_columns = ["end.TimeSecsRem","end.yardsToEndzone","end.distance","down_1_end","down_2_end","down_3_end","down_4_end","pos_score_diff_start_end"]

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

class PlayProcess(object):
    plays_json = pd.DataFrame()
    homeTeamSpread = 2.5
    homeTeamId = 0
    awayTeamId = 0
    firstHalfKickoffTeamId = 0
    logger = None

    def __init__(self, logger = None, json_data = [], spread = 2.5, homeTeam = 0, awayTeam = 0, firstHalfKickoffTeam = 0):
        self.plays_json = pd.json_normalize(json_data)
        self.homeTeamSpread = float(spread)
        self.homeTeamId = int(homeTeam)
        self.awayTeamId = int(awayTeam)
        self.firstHalfKickoffTeamId = int(firstHalfKickoffTeam)
        self.logger = logger

    def __setup_penalty_data__(self, play_df):
        #     #-- 'Penalty' in play text ----
            #-- T/F flag conditions penalty_flag 
        play_df['penalty_flag'] = False
        play_df.loc[(play_df['type.text'] == "penalty"), 'penalty_flag'] = True
        play_df.loc[play_df["text"].str.contains("penalty"), 'penalty_flag'] = True

            #-- T/F flag conditions penalty_declined 
        play_df['penalty_declined'] = False
        play_df.loc[(play_df['type.text'] == "penalty") & play_df["text"].str.contains("declined"), 'penalty_declined'] = True
        play_df.loc[play_df["text"].str.contains("penalty") & play_df["text"].str.contains("declined"), 'penalty_declined'] = True

            #-- T/F flag conditions penalty_no_play 
        play_df['penalty_no_play'] = False
        play_df.loc[(play_df['type.text'] == "penalty") & play_df["text"].str.contains("no play"), 'penalty_no_play'] = True
        play_df.loc[play_df["text"].str.contains("penalty") & play_df["text"].str.contains("no play"), 'penalty_no_play'] = True

            #-- T/F flag conditions penalty_offset 
        play_df['penalty_offset'] = False
        play_df.loc[(play_df['type.text'] == "penalty") & play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True), 'penalty_offset'] = True
        play_df.loc[play_df["text"].str.contains("penalty") & play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True), 'penalty_offset'] = True

            #-- T/F flag conditions penalty_1st_conv 
        play_df['penalty_1st_conv'] = False
        play_df.loc[(play_df['type.text'] == "penalty") & play_df["text"].str.contains("1st down"), 'penalty_1st_conv'] = True
        play_df.loc[play_df["text"].str.contains("penalty") & play_df["text"].str.contains("1st down"), 'penalty_1st_conv'] = True

            #-- T/F flag for penalty text but not penalty play type -- 
        play_df['penalty_text'] = False
        play_df.loc[play_df["text"].str.contains("penalty") & ~(play_df['type.text'] == "penalty") & ~play_df["text"].str.contains("declined") & ~play_df["text"].str.contains(r"off-setting", case=False, flags=0, na=False, regex=True) & ~play_df["text"].str.contains("no play"), 'penalty_text'] = True
        
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
            (play_df.penalty_flag == 1)
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
        
        play_df['penalty_text'] = np.where((play_df.penalty_flag == True),
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
            (play_df.penalty_flag == 1) & play_df.text.str.contains(r"ards\)", case=False, regex=True) & play_df.yds_penalty.isna(),
            play_df.text.str.extract(r"(.{0,4})yards\)|Yards\)|yds\)|Yds\)",flags=re.IGNORECASE)[0], 
            play_df.yds_penalty)
        play_df['yds_penalty'] = play_df.yds_penalty.str.replace( "yards\\)|Yards\\)|yds\\)|Yds\\)", "").str.replace( "\\(", "")
        return play_df

    def __clean_pbp_data__(self, play_df):
        play_df.id = play_df.id.astype(float)
        play_df = play_df.sort_values(by="id", ascending=True)
        play_df["start.team.id"] = play_df["start.team.id"].astype(int)
        play_df["end.team.id"] = play_df["end.team.id"].astype(int)
        
        play_df['is_home'] = (play_df["start.team.id"] == self.homeTeamId)
        play_df['pos_team_receives_2H_kickoff'] = (play_df["start.team.id"] == self.firstHalfKickoffTeamId)
        play_df['down_1'] = (play_df["start.down"] == 1)
        play_df['down_2'] = (play_df["start.down"] == 2)
        play_df['down_3'] = (play_df["start.down"] == 3)
        play_df['down_4'] = (play_df["start.down"] == 4)

        play_df['down_1_end'] = (play_df["end.down"] == 1)
        play_df['down_2_end'] = (play_df["end.down"] == 2)
        play_df['down_3_end'] = (play_df["end.down"] == 3)
        play_df['down_4_end'] = (play_df["end.down"] == 4)

        play_df['pos_score_diff_start'] = np.where(
            (play_df.is_home == True),
            (play_df.homeScore - play_df.awayScore),
            (play_df.awayScore - play_df.homeScore)
        )

        play_df['pos_score_diff_start_end'] = np.where(
            (play_df.is_home == True),
            (play_df.homeScore - play_df.awayScore),
            (play_df.awayScore - play_df.homeScore)
        )

        play_df.pos_score_diff_start = np.select([
            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('safety')),
            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('conversion') & (~play_df.text.str.lower().str.contains('failed'))),
            (play_df["type.text"].isin(defense_score_vec) & (~play_df.text.str.lower().str.contains('conversion')) & (~play_df.text.str.lower().str.contains('kick'))),
            (play_df["type.text"].isin(defense_score_vec) & (~play_df.text.str.lower().str.contains('conversion')) & play_df.text.str.lower().str.contains('kick')),

            (play_df["type.text"].isin(offense_score_vec) & play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(offense_score_vec) & play_df.text.str.lower().str.contains('conversion') & (~play_df.text.str.lower().str.contains('failed'))),
            (play_df["type.text"].isin(offense_score_vec) & play_df["type.text"].str.lower().str.contains('field goal') & play_df.playType.str.lower().str.contains('good')),
            (play_df["type.text"].isin(offense_score_vec) & (~play_df.text.str.lower().str.contains('conversion')) & (~play_df.text.str.lower().str.contains('kick'))),
            (play_df["type.text"].isin(offense_score_vec) & (~play_df.text.str.lower().str.contains('conversion')) & play_df.text.str.lower().str.contains('kick'))
        ],
        [
            (play_df.pos_score_diff_start - (-2)),
            (play_df.pos_score_diff_start - (-6)),
            (play_df.pos_score_diff_start - (-8)),
            (play_df.pos_score_diff_start - (-6)),
            (play_df.pos_score_diff_start - (-7)),

            (play_df.pos_score_diff_start - 6),
            (play_df.pos_score_diff_start - 8),
            (play_df.pos_score_diff_start - 3),
            (play_df.pos_score_diff_start - 6),
            (play_df.pos_score_diff_start - 7)
        ], default = play_df.pos_score_diff_start)

        #-- Touchdowns----
        play_df["scoring_play"] = np.where(play_df["type.text"].isin(scores_vec), True, False)
        play_df["td_play"] = play_df.text.str.contains(r"touchdown|for a TD", case=False, flags=0, na=False, regex=True)
        play_df["touchdown"] = play_df["type.text"].str.contains("touchdown")
        play_df["safety"] = play_df["text"].str.contains("safety")
            #-- Fumbles----
        play_df["fumble_vec"] = play_df["text"].str.contains("fumble")
            #-- Kicks----
        play_df["kickoff_play"] = np.where(play_df["type.text"].isin(kickoff_vec), True, False)
        play_df["kickoff_tb"] = np.where(play_df["text"].str.contains("touchback") & play_df.kickoff_play == True, True, False)
        play_df["kickoff_onside"] = np.where(play_df["text"].str.contains(r"on-side|onside|on side", case=False, flags=0, na=False, regex=True) & play_df.kickoff_play == True, True, False)
        play_df["kickoff_oob"] = np.where(play_df["text"].str.contains(r"out-of-bounds|out of bounds", case=False, flags=0, na=False, regex=True) & play_df.kickoff_play == True, True, False)
        play_df["kickoff_fair_catch"] = np.where(play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True) & play_df.kickoff_play == True, True, False)
        play_df["kickoff_downed"] = np.where(play_df["text"].str.contains("downed") & play_df.kickoff_play == True, True, False)
        play_df["kick_play"] = play_df["text"].str.contains(r"kick|kickoff", case=False, flags=0, na=False, regex=True)
        play_df["kickoff_safety"] = np.where(~play_df["type.text"].isin(['Blocked Punt','Penalty']) & play_df["text"].str.contains("kickoff") & play_df.safety == True, True, False)
            #-- Punts----
        play_df["punt"] = np.where(play_df["type.text"].isin(punt_vec), True, False)
        play_df["punt_play"] = play_df["text"].str.contains("punt")
        play_df["punt_tb"] = np.where(play_df["text"].str.contains("touchback") & play_df.punt == True, True, False)
        play_df["punt_oob"] = np.where(play_df["text"].str.contains(r"out-of-bounds|out of bounds", case=False, flags=0, na=False, regex=True) & play_df.punt == True, True, False)
        play_df["punt_fair_catch"] = np.where(play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True) & play_df.punt == True, True, False)
        play_df["punt_downed"] = np.where(play_df["text"].str.contains("downed") & play_df.punt == True, True, False)
        play_df["punt_safety"] = np.where(play_df["type.text"].isin(['Blocked Punt','Punt']) & play_df["text"].str.contains("punt") & play_df.safety == True, True, False)
        play_df["penalty_safety"] = np.where(play_df["type.text"].isin(['Penalty']) & play_df.safety == True, True, False)
        play_df["punt_blocked"] = np.where(play_df["text"].str.contains("blocked") & play_df.punt == True, True, False)
            #-- Pass/Rush----
        play_df['rush'] = np.where(
            ((play_df["type.text"] == "Rush")
            | (play_df["type.text"] == "Rushing Touchdown")
            | (play_df["type.text"].isin(["Safety","Fumble Recovery (Opponent)","Fumble Recovery (Opponent) Touchdown", "Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Return Touchdown"]) & play_df["text"].str.contains("run for"))),
            True, False
        )
        play_df['pass'] = np.where(
            (
            (play_df["type.text"].isin(["Pass Reception", "Pass Completion","Pass Touchdown","Sack","Pass","Inteception","Pass Interception Return", "Interception Return Touchdown","Pass Incompletion","Sack Touchdown","Interception Return"]))
            | ((play_df["type.text"] == "Safety") & play_df["text"].str.contains("sacked"))
            | ((play_df["type.text"] == "Safety") & play_df["text"].str.contains("pass complete"))
            | ((play_df["type.text"] == "Fumble Recovery (Own)") & play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True))
            | ((play_df["type.text"] == "Fumble Recovery (Own)") & play_df["text"].str.contains("sacked"))
            | ((play_df["type.text"] == "Fumble Recovery (Own) Touchdown") & play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True))
            | ((play_df["type.text"] == "Fumble Recovery (Own) Touchdown") & play_df["text"].str.contains("sacked"))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent)") & play_df["text"].str.contains(r"pass complete|pass incomplete|pass intercepted", case=False, flags=0, na=False, regex=True))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent)") & play_df["text"].str.contains("sacked"))
            | ((play_df["type.text"] == "Fumble Recovery (Opponent) Touchdown") & play_df["text"].str.contains(r"pass complete|pass incomplete", case=False, flags=0, na=False, regex=True))
            | ((play_df["type.text"] == "Fumble Return Touchdown") & play_df["text"].str.contains(r"pass complete|pass incomplete", case=False, flags=0, na=False, regex=True))
                | ((play_df["type.text"] == "Fumble Return Touchdown") & play_df["text"].str.contains("sacked"))
            ),
            True, False
        )
        #-- Sacks----
        play_df['sack_vec'] = np.where(
            (
                (play_df["type.text"].isin(["Sack", "Sack Touchdown"]))
                | ((play_df["type.text"].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown", "Fumble Return Touchdown"]) 
                & (play_df["pass"] == 1)
                & (play_df["text"].str.contains("sacked"))
                ))
            ), True, False)
        
        play_df['type.text'] = np.where(play_df["text"].str.contains(" coin toss "), "Coin Toss", play_df["type.text"])
        play_df['change_of_poss'] = np.where(play_df["start.team.id"] == play_df["start.team.id"].shift(-1), False, True)
        play_df['change_of_poss'] = np.where(play_df['change_of_poss'].isna(), 0, play_df['change_of_poss'])

        ## Fix Strip-Sacks to Fumbles----
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == 1) 
                & (play_df["pass"] == 1) 
                & (play_df.change_of_poss == 1) 
                & (play_df.td_play == 0) 
                & (play_df["start.down"] != 4) 
                & ~(play_df['type.text'].isin(defense_score_vec)),
            "Fumble Recovery (Opponent)", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == 1) 
                & (play_df["pass"] == 1) 
                & (play_df.change_of_poss == 1) 
                & (play_df.td_play == 1),
            "Fumble Recovery (Opponent) Touchdown", play_df['type.text']
        )
            ## Fix rushes with fumbles and a change of possession to fumbles----  
        play_df['type.text'] = np.where(
            (play_df.fumble_vec == 1) 
                & (play_df["rush"] == 1) 
                & (play_df.change_of_poss == 1) 
                & (play_df.td_play == 0) 
                & (play_df["start.down"] != 4) 
                & ~(play_df['type.text'].isin(defense_score_vec)),
            "Fumble Recovery (Opponent)", play_df['type.text']
        )

        play_df['type.text'] = np.where(
            (play_df.fumble_vec == 1) 
                & (play_df["rush"] == 1) 
                & (play_df.change_of_poss == 1) 
                & (play_df.td_play == 1),
            "Fumble Recovery (Opponent) Touchdown", play_df['type.text']
        )
            ## Portion of touchdown check for plays where touchdown is not listed in the play_type--
        play_df["td_check"] = play_df["text"].str.contains("Touchdown")

            #-- Fix kickoff fumble return TDs ----
        play_df['type.text'] = np.where(
                (play_df.kickoff_play == 1) 
                & (play_df.fumble_vec == 1) 
                & (play_df.td_play == 1)
                & (play_df.td_check == 1),
            f"{play_df['type.text']} Touchdown", play_df['type.text']
        )

            #-- Fix punt return TDs ----
        play_df['type.text'] = np.where(
                (play_df.punt_play == 1) 
                & (play_df.td_play == 1)
                & (play_df.td_check == 1),
            f"{play_df['type.text']} Touchdown", play_df['type.text']
        )

            #-- Fix kick return TDs----
        play_df['type.text'] = np.where(
                (play_df.kickoff_play == 1) 
                & (play_df.fumble_vec == 0) 
                & (play_df.td_play == 1)
                & (play_df.td_check == 1),
            f"Kickoff Return Touchdown", play_df['type.text']
        )
        
            #-- Fix rush/pass tds that aren't explicit----
        play_df['type.text'] = np.where(
                (play_df.td_play == 1) 
                & (play_df.rush == 1) 
                & (play_df.fumble_vec == 0) 
                & (play_df.td_check == 1),
            f"Rushing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df.td_play == 1) 
                & (play_df["pass"] == 1) 
                & (play_df.fumble_vec == 0) 
                & (play_df.td_check == 1)
                & ~(play_df['type.text'].isin(int_vec)),
            f"Passing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df["pass"] == 1) 
                & (play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Pass"]))
                & (play_df.statYardage == play_df["start.yardsToEndzone"])
                & (play_df.fumble_vec == 0)
                & ~(play_df['type.text'].isin(int_vec)),
            f"Passing Touchdown", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df['type.text'].isin(["Blocked Field Goal"])) 
                & (play_df['text'].str.contains("for a TD")),
            f"Blocked Field Goal Touchdown", play_df['type.text']
        )

            #-- Fix duplicated TD play_type labels----
        play_df['type.text'] = np.where(play_df['type.text'] == "Punt Touchdown Touchdown", "Punt Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Fumble Return Touchdown Touchdown", "Fumble Return Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Rushing Touchdown Touchdown", "Rushing Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'] == "Uncategorized Touchdown Touchdown", "Uncategorized Touchdown", play_df['type.text'])

            #-- Fix Pass Interception Return TD play_type labels----
        play_df['type.text'] = np.where(play_df["text"].str.contains("pass intercepted for a TD"), "Interception Return Touchdown", play_df["type.text"])

            #-- Fix Sack/Fumbles Touchdown play_type labels----
        play_df['type.text'] = np.where(
            play_df["text"].str.contains("sacked")
            & play_df["text"].str.contains("fumbled")
            & play_df["text"].str.contains("TD"),
            "Fumble Recovery (Opponent) Touchdown", play_df["type.text"]
        )

            #-- Fix generic pass plays ----
            ##-- first one looks for complete pass
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & play_df.text.str.contains("pass complete"),
                            "Pass Completion", play_df['type.text'])

            ##-- second one looks for incomplete pass
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & play_df.text.str.contains("pass incomplete"),
                            "Pass Incompletion", play_df['type.text'])

            ##-- third one looks for interceptions 
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & play_df.text.str.contains("pass intercepted"),
                            "Pass Interception", play_df['type.text'])

            ##-- fourth one looks for sacked
        play_df['type.text'] = np.where((play_df['type.text'] == "Pass") & play_df.text.str.contains("sacked"), "Sack", play_df['type.text'])

            ##-- fifth one play type is Passing Touchdown, but its intercepted 
        play_df['type.text'] = np.where((play_df['type.text'] == "Passing Touchdown") & play_df.text.str.contains("pass intercepted for a TD"),
                            "Interception Return Touchdown", play_df['type.text'])

            #--- Moving non-Touchdown pass interceptions to one play_type: "Interception Return" -----
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Interception"]), "Interception Return", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Pass Interception"]), "Interception Return", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Pass Interception Return"]), "Interception Return", play_df['type.text'])

            #--- Moving Kickoff/Punt Touchdowns without fumbles to Kickoff/Punt Return Touchdown
        play_df['type.text'] = np.where((play_df['type.text'] == "Kickoff Touchdown") & (play_df.fumble_vec == 0),  "Kickoff Return Touchdown", play_df['type.text'])

        play_df['type.text'] = np.where(play_df['type.text'].isin(["Kickoff", "Kickoff Return (Offense)"]) & 
                            (play_df.fumble_vec == 1) & (play_df.change_of_poss == 1), 
                            "Kickoff Team Fumble Recovery", play_df['type.text'])

        play_df['type.text'] = np.where((play_df['type.text'] == "Punt Touchdown") & (play_df.fumble_vec == 0), "Punt Return Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where((play_df['type.text'] == "Punt") & (play_df.fumble_vec == 1) & (play_df.change_of_poss == 0), "Punt Team Fumble Recovery", play_df['type.text'])

        play_df['type.text'] = np.where(play_df['type.text'].isin(["Punt Touchdown"]), "Punt Team Fumble Recovery Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where(play_df['type.text'].isin(["Kickoff Touchdown"]), "Kickoff Team Fumble Recovery Touchdown", play_df['type.text'])
        play_df['type.text'] = np.where((play_df['type.text'].isin(["Fumble Return Touchdown"])) & ((play_df["pass"] == 1) | (play_df["rush"] == 1)), "Fumble Recovery (Opponent) Touchdown", play_df['type.text'])

            #--- Safeties (kickoff, punt, penalty) ----
        play_df['type.text'] = np.where(
            (play_df['type.text'].isin(["Pass Reception", "Rush", "Rushing Touchdown"]) 
            & ((play_df["pass"] == 1) | (play_df["rush"] == 1)) 
            & (play_df["safety"] == True))
            , "Safety", play_df["type.text"]
        )
        
        play_df['type.text'] = np.where(
                (play_df.kickoff_safety == 1),
            f"Kickoff (Safety)", play_df['type.text']
        )
        
        play_df['type.text'] = np.where(
                (play_df.punt_safety == 1)
                | (play_df.penalty_safety == 1),
            f"{play_df['type.text']} (Safety)", play_df['type.text']
        )

        play_df = self.__setup_penalty_data__(play_df)
            #--- Sacks ----
        play_df['sack'] = ((play_df['type.text'].isin(["Sack"]) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & (play_df['pass'] == 1) & play_df["text"].str.contains("sacked")))
                            | (play_df['type.text'].isin(["Safety"]) & play_df["text"].str.contains("sacked")))

            #--- Interceptions ------
        play_df["int"] = play_df["type.text"].isin(["Interception Return", "Interception Return Touchdown"])
        play_df["int_td"] = play_df["type.text"].isin(["Interception Return Touchdown"])

            #--- Pass Completions, Attempts and Targets -------
        play_df['completion'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & play_df['pass'] == 1 & ~play_df["text"].str.contains("sacked")))

        play_df['pass_attempt'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown", "Pass Incompletion"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & play_df['pass'] == 1 & ~play_df["text"].str.contains("sacked")))

        play_df['target'] = ((play_df['type.text'].isin(["Pass Reception", "Pass Completion", "Passing Touchdown", "Pass Incompletion"])) 
                            | (play_df['type.text'].isin(["Fumble Recovery (Own)", "Fumble Recovery (Own) Touchdown", "Fumble Recovery (Opponent)", "Fumble Recovery (Opponent) Touchdown"]) & play_df['pass'] == 1 & ~play_df["text"].str.contains("sacked")))

            #--- Pass/Rush TDs ------
        play_df['pass_td'] = (play_df["type.text"] == "Passing Touchdown")
        play_df['rush_td'] = (play_df["type.text"] == "Rushing Touchdown")
        
            #-- Change of possession via turnover
        play_df['turnover_vec'] = play_df["type.text"].isin(turnover_vec)
        play_df['offense_score_play'] = play_df["type.text"].isin(offense_score_vec)
        play_df['defense_score_play'] = play_df["type.text"].isin(defense_score_vec)
        play_df['downs_turnover'] = np.where(
            (play_df["type.text"].isin(normalplay))
            & (play_df["statYardage"] < play_df["start.distance"])
            & (play_df["start.down"] == 4)
            & (play_df["penalty_1st_conv"] != 1)
        , True, False)

            #-- Touchdowns----
        play_df['scoring_play'] = play_df["type.text"].isin(scores_vec)
        play_df['yds_punted'] = play_df["text"].str.extract(r"(?<= punt for)[^,]+(\d+)", flags=re.IGNORECASE).astype(float)
        play_df['yds_punt_gained'] = np.where(play_df.punt == 1, play_df["statYardage"], None)
        play_df['fg_inds'] = play_df["type.text"].str.contains("Field Goal")
        play_df['fg_made'] = (play_df["type.text"] == "Field Goal Good")
        play_df['yds_fg'] = play_df["text"].str.extract(r"(\d{0,2}) Yd|Yard FG|Field", flags=re.IGNORECASE).astype(float)
        play_df['start.yardsToEndzone'] = np.where(play_df['fg_inds'] == True, play_df['yds_fg'] - 17, play_df["start.yardsToEndzone"])

        play_df["pos_unit"] = np.select(
            [
                play_df.punt == 1, 
                play_df.kickoff_play == 1,
                play_df.fg_inds == True,
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
                play_df.punt == 1, 
                play_df.kickoff_play == 1,
                play_df.fg_inds == True,
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
        play_df['lag_play_type3'] = play_df['type.text'].shift(3)
        play_df['lag_play_type2'] = play_df['type.text'].shift(2)
        play_df['lag_play_type'] = play_df['type.text'].shift(1)
        
        play_df['lead_play_type'] = play_df['type.text'].shift(-1)
        play_df['lead_play_type2'] = play_df['type.text'].shift(-2)
        play_df['lead_play_type3'] = play_df['type.text'].shift(-3)

        return play_df
    
    def __add_yardage_cols__(self, play_df):
        play_df['yds_rushed'] = None
        play_df['yds_rushed'] = np.select([
            (play_df.rush == True) & play_df.text.str.contains("run for no gain"),
            (play_df.rush == True) & play_df.text.str.contains("run for a loss of"),
            (play_df.rush == True) & play_df.text.str.contains("run for"),
            (play_df.rush == True) & play_df.text.str.contains("Yd Run")
        ],[
            0.0,
            -1 * play_df.text.str.extract(r"((?<=run for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<=run for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"(\d{0,2}) Yd Run", flags=re.IGNORECASE)[0].astype(float)
        ], default = None)
        
        
        play_df['yds_receiving'] = None
        play_df['yds_receiving'] = np.select([
            (play_df["pass"] == True) & play_df.text.str.contains("pass complete to", case=False) & play_df.text.str.contains(r"for no gain", case=False),
            (play_df["pass"] == True) & play_df.text.str.contains("pass complete to", case=False) & play_df.text.str.contains("for a loss", case=False),
            (play_df["pass"] == True) & play_df.text.str.contains("pass complete to", case=False),
        ],[
            0.0,
            -1 * play_df.text.str.extract(r"((?<=for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<=for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ], default = None)

        play_df['yds_int_return'] = None
        play_df['yds_int_return'] = np.select([
            (play_df["pass"] == True) & (play_df["int_td"] == True) & play_df.text.str.contains("Yd Interception Return", case=False),
            (play_df["pass"] == True) & (play_df["int"] == True) & play_df.text.str.contains(r"for no gain", case=False),
            (play_df["pass"] == True) & (play_df["int"] == True) & play_df.text.str.contains(r"for a loss of", case=False),
            (play_df["pass"] == True) & (play_df["int"] == True) & play_df.text.str.contains(r"for a TD", case=False),
            (play_df["pass"] == True) & (play_df["int"] == True) & play_df.text.str.contains(r"return for", case=False),
            (play_df["pass"] == True) & (play_df["int"] == True)
        ],[
            play_df.text.str.extract(r"(.+) Interception Return", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            0.0,
            -1 * play_df.text.str.extract(r"((?<= for a loss of)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
            play_df.text.str.replace("for a 1st", "").str.extract(r"((?<=for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
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
            (play_df.kickoff_play == 1) & (play_df.kickoff_tb == 1),
            (play_df.kickoff_play == 1) & (play_df.fumble_vec == 0) & play_df.text.str.contains(r"for no gain|fair catch|fair caught", regex=True,case = False),
            (play_df.kickoff_play == 1) & (play_df.fumble_vec == 0) & play_df.text.str.contains(r"out-of-bounds|out of bounds", regex=True,case = False),
            ((play_df.kickoff_downed == 1) | (play_df.kickoff_fair_catch == 1)),
            (play_df.kickoff_play == 1)
        ],
        [
            25,
            0,
            40,
            0,
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float),
        ],
        default = play_df['yds_kickoff_return'])
        
        play_df['yds_punted'] = None
        play_df['yds_punted'] = np.select([
            (play_df.punt == 1) & (play_df.punt_blocked == 1),
            (play_df.punt == 1)
        ],
        [
            0,
            play_df.text.str.extract(r"((?<= punt for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default = play_df.yds_punted)

        play_df['yds_punt_return'] = np.select([
            (play_df.punt == 1) & (play_df.punt_tb == 1),
            (play_df.punt == 1) & play_df["text"].str.contains(r"fair catch|fair caught", case=False, flags=0, na=False, regex=True),
            (play_df.punt == 1) & ((play_df.punt_downed == 1) | (play_df.punt_oob == 1) | (play_df.punt_fair_catch == 1)),
            (play_df.punt == 1) & (play_df.punt_blocked == 0),
            (play_df.punt == 1) & (play_df.punt_blocked == 1),
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
            (play_df.fumble_vec == 1) & (play_df.kickoff_play != 1),
        ],
        [
            play_df.text.str.extract(r"((?<= return for)[^,]+)", flags=re.IGNORECASE)[0].str.extract(r"(\d+)")[0].astype(float)
        ],
        default=None)
        
        play_df['yds_sacked'] = np.select([
            (play_df.sack == 1),
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
            play_df.penalty_detail.notna() & play_df.yds_penalty.isna() & (play_df.rush == 1),
            play_df.penalty_detail.notna() & play_df.yds_penalty.isna() & (play_df.int == 1),
            play_df.penalty_detail.notna() & play_df.yds_penalty.isna() & (play_df["pass"] == 1) & (play_df["sack"] == 0) & (play_df["type.text"] != "Pass Incompletion"),
            play_df.penalty_detail.notna() & play_df.yds_penalty.isna() & (play_df["pass"] == 1) & (play_df["sack"] == 0) & (play_df["type.text"] == "Pass Incompletion"),
            play_df.penalty_detail.notna() & play_df.yds_penalty.isna() & (play_df["pass"] == 1) & (play_df["sack"] == 1),
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
            play_df.text.str.extract(r"(.{0,25} )run |(.{0,25} )\d{0,2} Yd Run").bfill(axis=1)[0],
            None
        )
        play_df['rush_player'] = play_df.rush_player.str.replace(r" run | \d+ Yd Run", "", regex=True)

                
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
            (play_df["pass"] == 1) & ~play_df.text.str.contains("sacked"),
            play_df.text.str.extract("to (.+)")[0],
            None
        )
        
        play_df['receiver_player'] = np.where(
            play_df.text.str.contains("Yd pass", case=False),
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
            (play_df["sack"] == 1) | (play_df["fumble_vec"] == 1) & (play_df["pass"] == 1) ,
            play_df.text.str.extract("sacked by(.+)", flags=re.IGNORECASE)[0],
            play_df.sack_players
        )
        
        play_df['sack_players'] = play_df['sack_players'].str.replace("for (.+)","", case=True, regex=True)
        play_df['sack_players'] = play_df['sack_players'].str.replace("(.+) by ","", case=True, regex=True)
        play_df['sack_player1'] = play_df['sack_players'].str.replace("and (.+)","", case=True, regex=True)
        play_df['sack_player2'] = np.where(play_df['sack_players'].str.contains("and (.+)"),
                                        play_df['sack_players'].str.replace("(.+) and","", case=True, regex=True),
                                        None)
        
        play_df['interception_player'] = np.where(
            (play_df["type.text"] == "Interception Return") | (play_df["type.text"] == "Interception Return Touchdown") & 
            play_df['pass'] == 1, play_df.text.str.extract('intercepted (.+)', flags=re.IGNORECASE)[0], 
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

        play_df['pass_breakup_player'] = np.where(
            play_df["pass"] == 1, play_df.text.str.extract("broken up by (.+)"), play_df.pass_breakup_player
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
            play_df.text.str.extract(", (.{0,25}) returns|fair catch by (.{0,25})", flags=re.IGNORECASE).bfill(axis=1)[0], 
            play_df.punt_return_player
        )
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(", ", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" returns", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace("fair catch by", "", case = False, regex = True)
        play_df["punt_return_player"] = play_df["punt_return_player"].str.replace(" at (.+)", "", case = False, regex = True)

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
            play_df["type.text"].str.contains("Punt") & play_df.text.str.contains("blocked") & play_df.text.str.contains("return"), 
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
            play_df.text.str.extract(", (.{0,25}) return|, (.{0,25}) fumble").bfill(axis=1)[0], 
            play_df.kickoff_return_player
        )
        play_df["kickoff_return_player"] = play_df["kickoff_return_player"].str.replace(", ","", case=False, regex=True)
        play_df["kickoff_return_player"] = play_df["kickoff_return_player"].str.replace(" return| fumble", "", case=False, regex=True)
        
        play_df["fg_kicker_player"] = np.where(
            play_df["type.text"].str.contains("Field Goal"), 
            play_df.text.str.extract("(.{0,25} )\\d{0,2} yd field goal| (.{0,25} )\\d{0,2} yd fg").bfill(axis=1)[0], 
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
            play_df["type.text"].str.contains("Field Goal") &
            play_df["type.text"].str.contains("blocked by|missed") &
            play_df["type.text"].str.contains("return") , 
            play_df.text.str.extract("  (.+)"), 
            play_df.fg_return_player
        )
        
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace(",(.+)", "", case=False, regex=True) 
        play_df["fg_return_player"] = play_df["fg_return_player"].str.replace("return ", "", case=False, regex=True) 
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
            play_df["fumble_player"].str.contains("fumble"),
            play_df["fumble_player"].str.extract("(.{0,25} )fumble"),
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
            play_df.text.str.contains("fumble") & play_df.text.str.contains("forced by"),
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
            play_df.text.str.contains("fumble") & play_df.text.str.contains("recovered by"),
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
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_1"] = True
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_2"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_3"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "down_4"] = False
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "distance"] = 10
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "start.yardsToEndzone"] = 75
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "pos_score_diff_start"] = -1 * play_df.pos_score_diff_start
        play_df.loc[play_df["type.text"].isin(kickoff_vec), "pos_score_diff_start_end"] = -1 * play_df.pos_score_diff_start_end

        start_data = play_df[ep_start_columns]
        start_data.columns = ep_final_names
        self.logger.info(start_data.iloc[[12]].to_json(orient="records"))

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

        end_data = play_df[ep_end_columns]
        end_data.columns = ep_final_names
        self.logger.info(end_data.iloc[[12]].to_json(orient="records"))
        dtest_end = xgb.DMatrix(end_data)
        EP_end_parts = ep_model.predict(dtest_end)

        EP_end = self.__calculate_ep_exp_val__(EP_end_parts)

        play_df['EP_start'] = EP_start
        play_df['EP_end'] = EP_end

        play_df.EP_end = np.select([
            (play_df.playType.isin(turnover_vec) | (play_df["start.team.id"] != play_df["end.team.id"])),
            (play_df.playType.str.lower().str.contains("end of game") | play_df.playType.str.lower().str.contains("end of game") | play_df.playType.str.lower().str.contains("end of half") | play_df.playType.str.lower().str.contains("end of half")),

            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('safety')),
            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(defense_score_vec) & play_df.text.str.lower().str.contains('conversion') & ~play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(defense_score_vec) & ~play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('missed')),
            (play_df["type.text"].isin(defense_score_vec) & ~play_df.text.str.lower().str.contains('conversion') & ~play_df.text.str.lower().str.contains('missed')),

            (play_df["type.text"].isin(offense_score_vec) & play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(offense_score_vec) & play_df.text.str.lower().str.contains('conversion') & ~play_df.text.str.lower().str.contains('failed')),
            (play_df["type.text"].isin(offense_score_vec) & play_df["type.text"].str.lower().str.contains('field goal') & (play_df.playType.str.lower().str.contains('good'))),
            (play_df["type.text"].isin(offense_score_vec) & play_df["type.text"].str.lower().str.contains('field goal') & ~play_df.playType.str.lower().str.contains('good')),
            (play_df["type.text"].isin(offense_score_vec) & ~play_df.text.str.lower().str.contains('conversion') & play_df.text.str.lower().str.contains('missed')),
            (play_df["type.text"].isin(offense_score_vec) & ~play_df.text.str.lower().str.contains('conversion') & ~play_df.text.str.lower().str.contains('missed'))
        ],
        [
            (play_df.EP_end * -1),
            0,

            -2,
            -6,
            -8,
            -6,
            -7,

            6,
            8,
            3,
            0,
            6,
            7
        ], default = play_df.EP_end)

        play_df['EPA'] = play_df['EP_end'] - play_df['EP_start']
        return play_df

    def __process_wpa__(self, play_df):
        play_df['ExpScoreDiff'] = play_df.pos_score_diff_start + play_df.EP_start
        play_df['ExpScoreDiff_Time_Ratio'] = play_df['ExpScoreDiff'] / (play_df['start.adj_TimeSecsRem'] + 1)

        play_df['pos_team_spread'] = np.where(
            (play_df.is_home == True),
            self.homeTeamSpread,
            (-1 * self.homeTeamSpread)
        )

        play_df['elapsed_share'] = ((3600 - play_df['start.adj_TimeSecsRem']) / 3600).clip(0, 3600)
        play_df['spread_time'] = play_df.pos_team_spread * np.exp(-4 * play_df.elapsed_share)

        play_df['ExpScoreDiff_end'] = play_df.pos_score_diff_start_end + play_df.EP_end
        play_df['ExpScoreDiff_Time_Ratio_end'] = play_df.ExpScoreDiff_end / (play_df["end.adj_TimeSecsRem"] + 1)

        play_df['elapsed_share_end'] = ((3600 - play_df["end.adj_TimeSecsRem"]) / 3600).clip(0, 3600)
        play_df['spread_time_end'] = play_df.pos_team_spread * np.exp(-4 * play_df.elapsed_share_end)

        start_data = play_df[wp_start_columns]
        start_data.columns = wp_final_names
        self.logger.info(start_data.iloc[[12]].to_json(orient="records"))
        dtest_start = xgb.DMatrix(start_data)
        WP_start = wp_model.predict(dtest_start)

        end_data = play_df[wp_end_columns]
        end_data.columns = wp_final_names
        self.logger.info(end_data.iloc[[12]].to_json(orient="records"))
        dtest_end = xgb.DMatrix(end_data)
        WP_end = wp_model.predict(dtest_end)

        play_df['WP_start'] = WP_start
        play_df['WP_end'] = WP_end

        play_df.iloc[-1]['WP_end'] = np.select([
            (play_df.is_home == True) & (play_df.homeScore > play_df.awayScore),
            (play_df.is_home == False) & (play_df.homeScore < play_df.awayScore),
            (play_df.is_home == True) & (play_df.homeScore < play_df.awayScore),
            (play_df.is_home == False) & (play_df.homeScore > play_df.awayScore)
        ],
        [
            1.0,
            1.0,
            0.0,
            0.0
        ], default = play_df.WP_end)

        play_df['WPA'] = play_df['WP_end'] - play_df['WP_start']
        return play_df

        
    def run_processing_pipeline(self):
        self.plays_json = self.__clean_pbp_data__(self.plays_json)
        self.plays_json = self.__add_yardage_cols__(self.plays_json)
        self.plays_json = self.__add_player_cols__(self.plays_json)
        self.plays_json = self.__process_epa__(self.plays_json)
        self.plays_json = self.__process_wpa__(self.plays_json)
        return self.plays_json