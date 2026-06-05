import { range } from "./misc";

export const CURRENT_YEAR = 2026;
export const AVAILABLE_SEASONS = range(2002, CURRENT_YEAR);
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

export const SPICE_LEVELS = {
    WATER: "testing",
    BELL: "none",
    SERRANO: "close-late",
    CAYENNE: "ranked-upset",
    GHOST: "ranked-close-late",
    REAPER: "fcs-upset"
};

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
        "statistics.carries": "Carries",
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
        "statistics.dropbacks": [1,2,0],
        "statistics.sackAdjustedYards": [1,2,1],
        "advanced.totalEPA": [1,2,2],
        "statistics.yardsPerDropback": [1,2,2],
        "advanced.epaPerPlay": [1,2,2],
        "advanced.successRate": [100,2,1],
    }, 
    "rushing": {
        "statistics.carries": [1,2,0],
        "statistics.yards": [1,2,1],
        "advanced.totalEPA": [1,2,2],
        "statistics.yardsPerPlay": [1,2,2],
        "advanced.epaPerPlay": [1,2,2],
        "advanced.successRate": [100,2,1],
    }, 
    "receiving": {
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

export const SUMMARY_LAST_UPDATED = '2026-01-01';