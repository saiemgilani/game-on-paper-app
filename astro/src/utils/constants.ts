import { range } from "./misc";

export const CURRENT_YEAR = 2026;
export const SCHEDULE_AVAILABLE_SEASONS = range(2002, CURRENT_YEAR);
export const AVAILABLE_SEASONS = range(2014, CURRENT_YEAR);
export const ALPHABET = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

export const FBS_CONFERENCES = ['1','4','5','8','9','12','15','17','37','151','80', '18'];
export const NETWORK_MAPPINGS: Record<string, string> = {
    "FOX" : 'https://www.foxsports.com/live',
    "FS1" : 'https://www.foxsports.com/live/fs1',
    "FS2" : 'https://www.foxsports.com/live/fs2',
    "BTN" : 'https://www.foxsports.com/live/btn',
    "NBC" : 'https://www.nbcsports.com/live',
    "Peacock" : 'https://www.peacocktv.com',
    "CBSSN" : 'https://www.cbssports.com/cbs-sports-network/',
    "CBS" : 'https://www.cbssports.com/live/',
    'PAC12' : 'https://pac-12.com/live',
    'NFL NET' : 'https://www.nfl.com/network/watch/nfl-network-live',
    'CW NETWORK' : "https://www.cwtv.com/sports/",
    "THE CW NETWORK" : "https://www.cwtv.com/sports/",
    "The CW Network" : "https://www.cwtv.com/sports/",
    "MWSN": "https://themw.com/watch/",
    "MWN": "https://themw.com/watch/",
    "MWN App": "https://themw.com/watch/",
    "truTV": "https://www.trutv.com/watchtrutv",
    "TNT": "https://www.tntdrama.com/watchtnt",
    "USA Net": "https://www.usanetwork.com/sports"
};

export const GAME_QUARANTINE_LIST = [
    "401411157",
    "401403861",
    "401628329",
    "401634301",
    "401634212",
    "401628398"
]

const SICKOS_GOTW = [];

export const MEME_LIST = [61];
export const SPECIAL_IMAGES: { [teamId: string]: string} = {
    "61": "/assets/img/ennui-uga.png",
    // "2390": "/assets/img/upside-down-u.png",
};

export const PLAYER_METRIC_CATEGORIES: Record<string, Record<string, string>> = {
    "passing": {
        "statistics.dropbacks": "Dropbacks",
        "statistics.sackAdjustedYards": "Sack-Adj Yds",
        "advanced.totalEPA": "EPA",
        "statistics.yardsPerDropback": "Yards/DB",
        "advanced.epaPerPlay": "EPA/DB",
        "advanced.successRate": "Pass SR%",
    }, 
    "rushing": {
        "statistics.plays": "Carries",
        "statistics.yards": "Yards",
        "advanced.totalEPA": "EPA",
        "statistics.yardsPerPlay": "Yards/Rush",
        "advanced.epaPerPlay": "EPA/Rush",
        "advanced.successRate": "Rush SR%",
    }, 
    "receiving": {
        "statistics.catches": "Catches",
        "statistics.targets": "Targets",
        "statistics.catchPct": "Catch %",
        "statistics.yards": "Yards",
        "advanced.totalEPA": "EPA",
        "statistics.yardsPerPlay": "Yards/Tgt",
        "advanced.epaPerPlay": "EPA/Tgt",
        "advanced.successRate": "Rec SR%",
    }
};

export const PLAYER_METRIC_FORMATTING_VALUES: Record<string, Record<string, number[]>> = {
    "passing": {
        "statistics.games": [1,2,0],
        "statistics.dropbacks": [1,2,0], // multiplier, power10, fixed
        "statistics.sackAdjustedYards": [1,2,1],
        "advanced.totalEPA": [1,2,2],
        "statistics.yardsPerDropback": [1,2,2],
        "advanced.epaPerPlay": [1,2,2],
        "advanced.successRate": [100,2,1],
    }, 
    "rushing": {
        "statistics.games": [1,2,0],
        "statistics.plays": [1,2,0],
        "statistics.yards": [1,2,1],
        "advanced.totalEPA": [1,2,2],
        "statistics.yardsPerPlay": [1,2,2],
        "advanced.epaPerPlay": [1,2,2],
        "advanced.successRate": [100,2,1],
    }, 
    "receiving": {
        "statistics.games": [1,2,0],
        "statistics.catches": [1,2,0],
        "statistics.targets": [1,2,0],
        "statistics.catchPct": [100,2,1],
        "statistics.yards": [1,2,1],
        "advanced.totalEPA": [1,2,2],
        "statistics.yardsPerPlay": [1,2,2],
        "advanced.epaPerPlay": [1,2,2],
        "advanced.successRate": [100,2,1],
    }
};


export const TEAM_METRIC_CATEGORIES: Record<string, Record<string, string>> = {
    "differential": {
        "overall.adjEpaPerPlay": "Adj EPA/Play",
        "overall.epaPerPlay": "EPA/Play",
        "overall.yardsPerPlay": "Yards/Play",
        "overall.successRate": "SR%",
    }, 
    "offensive": {
        "overall.adjEpaPerPlay": "Adj EPA/Play",
        "overall.epaPerPlay": "EPA/Play",
        "overall.yardsPerPlay": "Yards/Play",
        "overall.successRate": "SR%",

        "passing.epaPerPlay": "EPA/DB",
        "passing.yardsPerPlay": "Yards/DB",
        "passing.successRate": "Pass SR%",

        "rushing.epaPerPlay": "EPA/Rush",
        "rushing.yardsPerPlay": "Yards/Rush",
        "rushing.successRate": "Rush SR%",

        "overall.havocRate": "Havoc %"
    }, 
    "defensive": {
        "overall.adjEpaPerPlay": "Adj EPA/Play",
        "overall.epaPerPlay": "EPA/Play",
        "overall.yardsPerPlay": "Yards/Play",
        "overall.successRate": "SR%",

        "passing.epaPerPlay": "EPA/DB",
        "passing.yardsPerPlay": "Yards/DB",
        "passing.successRate": "Pass SR%",

        "rushing.epaPerPlay": "EPA/Rush",
        "rushing.yardsPerPlay": "Yards/Rush",
        "rushing.successRate": "Rush SR%",

        "overall.havocRate": "Havoc %"
    }
};

export const TEAM_METRIC_FORMATTING_VALUES: Record<string, Record<string, number[]>> = {
    "differential": {
        "overall.adjEpaPerPlay": [1,2,2],
        "overall.epaPerPlay": [1,2,2],
        "overall.yardsPerPlay": [1,2,2],
        "overall.successRate": [100,2,1],
    }, 
    "offensive": {
        "overall.adjEpaPerPlay": [1,2,2],
        "overall.epaPerPlay": [1,2,2],
        "overall.yardsPerPlay": [1,2,2],
        "overall.successRate": [100,2,1],  

        "passing.epaPerPlay": [1,2,2],
        "passing.yardsPerPlay": [1,2,2],
        "passing.successRate": [100,2,1], 

        "rushing.epaPerPlay": [1,2,2],
        "rushing.yardsPerPlay": [1,2,2],
        "rushing.successRate": [100,2,1], 

        "overall.havocRate": [100,2,1], 
    }, 
    "defensive": {
        "overall.adjEpaPerPlay": [1,2,2],
        "overall.epaPerPlay": [1,2,2],
        "overall.yardsPerPlay": [1,2,2],
        "overall.successRate": [100,2,1],  

        "passing.epaPerPlay": [1,2,2],
        "passing.yardsPerPlay": [1,2,2],
        "passing.successRate": [100,2,1], 

        "rushing.epaPerPlay": [1,2,2],
        "rushing.yardsPerPlay": [1,2,2],
        "rushing.successRate": [100,2,1], 

        "overall.havocRate": [100,2,1], 
    }
};

export const TEAM_METRIC_HOVER_TEXT: Record<string, Record<string, string>> = {
    "differential": {
        "overall.adjEpaPerPlay": "Accounts for home-field advantange, accounting for home-field advantage, quality of opponent, and garbage time in FBS vs FBS games.",
    }, 
    "offensive": {
        "overall.adjEpaPerPlay": "Accounts for home-field advantange, accounting for home-field advantage, quality of opponent, and garbage time in FBS vs FBS games.",
        "passing.epaPerPlay": "DB: Dropbacks, includes pass attempts and sacks.",
        "passing.yardsPerPlay": "DB: Dropbacks, includes pass attempts and sacks.",
    }, 
    "defensive": {
        "overall.adjEpaPerPlay": "Accounts for home-field advantange, accounting for home-field advantage, quality of opponent, and garbage time in FBS vs FBS games.",
        "passing.epaPerPlay": "DB: Dropbacks, includes pass attempts and sacks.",
        "passing.yardsPerPlay": "DB: Dropbacks, includes pass attempts and sacks.",
    }
};


export const METRIC_KEY_TITLE_MAPPING: Record<string, string> = {
    "EPA_plays" : "Total Plays",
    "scrimmage_plays" : "Scrimmage Plays",
    "EPA_overall_total" : "Total EPA",
    "EPA_overall_off" : "&emsp;&emsp;EPA",
    "EPA_overall_offense" : "&emsp;&emsp;Offensive EPA",
    "EPA_passing_overall" : "&emsp;&emsp;EPA",
    "EPA_rushing_overall" : "&emsp;&emsp;EPA",
    "EPA_per_play" : "&emsp;&emsp;EPA/Play",
    "EPA_passing_per_play" : "&emsp;&emsp;EPA/Play",
    "EPA_rushing_per_play" : "&emsp;&emsp;EPA/Play",
    "rushes" : "Rushes",
    "rushing_power" : "&emsp;&emsp;Power Run Attempts (Down &#8805; 3, Distance &#8804; 2)",
    "rushing_power_success" : "&emsp;&emsp;Successful Power Runs (Rate)",
    "rushing_stuff" : "&emsp;&emsp;Stuffed Runs (Yds Gained &#8804; 0)",
    "rushing_stopped" : "&emsp;&emsp;Stopped Runs (Yds Gained &#8804; 2)",
    "rushing_opportunity" : "&emsp;&emsp;Opportunity Runs (Yds Gained &#8805; 4)",
    "rushing_highlight" : "&emsp;&emsp;Highlight Runs (Yds Gained &#8805; 8)",
    "havoc_total" : "Havoc Plays Created",
    "havoc_total_pass" : "&emsp;&emsp;Passing",
    "havoc_total_rush" : "&emsp;&emsp;Rushing",
    "EPA_penalty": "&emsp;&emsp;Penalty EPA",
    "special_teams_plays" : "Total Plays",
    "EPA_sp" : "Total EPA",
    "EPA_special_teams" : "&emsp;&emsp;Special Teams EPA",
    "EPA_fg" : "&emsp;&emsp;Field Goal EPA",
    "EPA_punt" : "&emsp;&emsp;Punting EPA",
    "EPA_kickoff" : "&emsp;&emsp;Kickoff Return EPA",
    "TFL" : "TFLs Generated",
    "TFL_pass" : "&emsp;&emsp;Passing",
    "TFL_rush" : "&emsp;&emsp;Rushing",
    "EPA_success" : "Successful Plays (EPA > 0)",
    "EPA_success_pass" : "&emsp;&emsp;When Passing",
    "EPA_success_rush" : "&emsp;&emsp;When Rushing",
    "EPA_success_standard_down" : "&emsp;&emsp;On Standard Downs",
    "EPA_success_passing_down": "&emsp;&emsp;On Passing Downs",
    "EPA_success_early_down": "&emsp;&emsp;On Early Downs",
    "EPA_success_early_down_pass": "&emsp;&emsp;Successful Passes (Rate)",
    "EPA_success_early_down_rush": "&emsp;&emsp;Successful Rushes (Rate)",
    "early_downs": "Early Downs",
    "early_down_pass": "&emsp;&emsp;Passes",
    "early_down_rush": "&emsp;&emsp;Rushes",
    "EPA_success_late_down": "&emsp;&emsp;On Late Downs",
    "EPA_success_late_down_pass": "&emsp;&emsp;Successful Passes (Rate)",
    "EPA_success_late_down_rush": "&emsp;&emsp;Successful Rushes (Rate)",
    "late_downs": "Late Downs",
    "late_down_pass": "&emsp;&emsp;Passes",
    "late_down_rush": "&emsp;&emsp;Rushes",
    "EPA_explosive" : "Explosive Plays",
    "EPA_explosive_passing" : "&emsp;&emsp;When Passing (EPA > 2.4)",
    "EPA_explosive_rushing" : "&emsp;&emsp;When Rushing (EPA > 1.8)",
    "scoring_opps_opportunities" : "Scoring Opps",
    "scoring_opps_points" : "&emsp;&emsp;Total Points",
    "scoring_opps_pts_per_opp" : "&emsp;&emsp;Points per Opp",
    "field_pos_avg_start" : "Avg Starting FP",
    "field_pos_avg_starting_predicted_pts" : "&emsp;&emsp;Predicted Points",
    "sacks" : "Sacks Generated",
    "turnovers" : "Turnovers",
    "expected_turnovers" : "Expected Turnovers",
    "turnover_margin" : "Turnover Margin",
    "expected_turnover_margin" : "Expected Turnover Margin",
    "turnover_luck" : "Turnover Luck (pts)",
    "PD" : "Passes Defensed",
    "INT" : "&emsp;&emsp;Interceptions",
    "Int" : "&emsp;&emsp;Interceptions",
    "def_int" : "Interceptions",
    "fumbles" : "Fumbles Forced",
    "total_fumbles" : "&emsp;&emsp;Fumbles",
    "fumbles_lost" : "&emsp;&emsp;Fumbles Lost",
    "fumbles_recovered" : "&emsp;&emsp;Fumbles Recovered",
    "middle_8": "\"Middle 8\" Plays",
    "middle_8_pass": "&emsp;&emsp;Passes",
    "middle_8_rush": "&emsp;&emsp;Rushes",
    "EPA_middle_8": "&emsp;&emsp;EPA",
    "EPA_middle_8_success": "&emsp;&emsp;During \"Middle 8\"",
    "EPA_middle_8_success_pass": "&emsp;&emsp;Successful Passes (Rate)",
    "EPA_middle_8_success_rush": "&emsp;&emsp;Successful Rushes (Rate)",
    "EPA_middle_8_per_play" : "&emsp;&emsp;EPA/play",
    "EPA_early_down" : "&emsp;&emsp;EPA",
    "EPA_early_down_per_play" : "&emsp;&emsp;EPA/Play",
    "EPA_late_down" : "&emsp;&emsp;EPA",
    "EPA_late_down_per_play" : "&emsp;&emsp;EPA/Play",
    "late_down_avg_distance" : "&emsp;&emsp;Avg Distance",
    "first_downs_created" : "First Downs Created",
    "early_down_first_down" : "&emsp;&emsp;First Downs Created",
    "passes" : "Passes",
    "drives" : "Total",
    "drive_total_gained_yards_rate" : "Available Yards %",
    "yards_per_drive" : "Yards/Drive",
    "plays_per_drive" : "Plays/Drive",
    "avg_field_position": "Avg Starting Field Position",
    "rushing_highlight_yards": "<a href=\"https://www.footballstudyhall.com/2018/2/2/16963820/college-football-advanced-stats-glossary\">Highlight Yards</a>",
    "rushing_highlight_yards_per_opp": "&emsp;&emsp;Per Rush Opportunity",
    "line_yards": "<a href=\"https://www.footballstudyhall.com/2018/2/2/16963820/college-football-advanced-stats-glossary\">OL Line Yards</a>",
    "line_yards_per_carry": "&emsp;&emsp;Per Carry",
    "yards_per_rush": "&emsp;&emsp;Yards/Play",
    "yards_per_pass": "&emsp;&emsp;Yards/Play",
    "yards_per_play": "&emsp;&emsp;Yards/Play",
    "off_yards" : "&emsp;&emsp;Yards",
    "rush_yards" : "&emsp;&emsp;Yards",
    "pass_yards" : "&emsp;&emsp;Yards",
    "total_yards":  "Total Yards",
    "total_off_yards" : "&emsp;&emsp;Offensive Yards",
    "total_sp_yards":"&emsp;&emsp;Special Teams Yards",
    "total_pen_yards":"&emsp;&emsp;Penalty Yards",
    "EPA_misc" : "&emsp;&emsp;Non-Scrimmage/Misc EPA",
    "open_field_yards" : "Open-Field Yards",
    "second_level_yards" : "Second-Level Yards",
    "drive_stopped_rate" : "<a href=\"https://theathletic.com/2419632/2021/03/02/college-football-defense-rankings-stop-rate/\">Stop Rate</a>",
    "EPA_non_explosive" : "EPA w/o Explosive Plays",
    "EPA_non_explosive_per_play" : "&emsp;&emsp;EPA/Play",
    "EPA_non_explosive_passing" : "&emsp;&emsp;When Passing",
    "EPA_non_explosive_passing_per_play" : "&emsp;&emsp;&emsp;&emsp;EPA/Play",
    "EPA_non_explosive_rushing" : "&emsp;&emsp;When Rushing",
    "EPA_non_explosive_rushing_per_play" : "&emsp;&emsp;&emsp;&emsp;EPA/Play"
};

export const TURNOVER_VEC: string[] = [
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

export const BOX_SCORE_NON_RATE_DECIMAL_COLUMNS: string[] = ["expected_turnovers","expected_turnover_margin","turnover_luck","EPA_middle_8_per_play","EPA_middle_8","EPA_middle_8_per_play","EPA_middle_8","EPA_early_down_per_play","EPA_early_down","EPA_sp","EPA_special_teams","EPA_kickoff","EPA_punt","EPA_fg","EPA_overall_off","EPA_per_play","EPA_passing_overall","EPA_passing_per_play", "EPA_rushing_overall","EPA_rushing_per_play","points_per_drive","yards_per_drive","plays_per_drive","avg_field_position","rushing_highlight_yards_per_opp","line_yards_per_carry","yards_per_rush","yards_per_pass","yards_per_play","drive_stopped_rate","EPA_non_explosive","EPA_non_explosive_passing","EPA_non_explosive_rushing","EPA_non_explosive_per_play","EPA_non_explosive_passing_per_play","EPA_non_explosive_rushing_per_play", "EPA_late_down_per_play", "EPA_late_down", "late_down_avg_distance"];
export const BOX_SCORE_NON_RATE_COLUMNS: string[] = ["EPA_plays","scrimmage_plays","expected_turnover_margin","turnover_margin","turnovers","expected_turnovers","turnover_luck","early_downs","late_downs","fumbles","INT","PD","middle_8","EPA_middle_8_per_play","EPA_middle_8","EPA_early_down_per_play","EPA_early_down","fumbles_lost","fumbles_recovered","Int","TFL","TFL_pass","TFL_rush","total_fumbles","def_int","points_per_drive","drives","points_per_drive","yards_per_drive","plays_per_drive","drive_total_gained_yards_rate","avg_field_position","rushing_highlight_yards","line_yards","yards_per_rush","yards_per_pass","yards_per_play","off_yards","pass_yards","rush_yards","EPA_overall_offense","EPA_penalty","EPA_overall_total","second_level_yards","open_field_yards","drive_stopped_rate","EPA_non_explosive","EPA_non_explosive_passing","EPA_non_explosive_rushing","EPA_non_explosive_per_play","EPA_non_explosive_passing_per_play","EPA_non_explosive_rushing_per_play"]; 
export const BOX_SCORE_NON_RATE_PERCENT_COLUMNS: string[] = ["drive_total_gained_yards_rate","drive_stopped_rate","EPA_success_rate_third","EPA_success_rate_rz"];