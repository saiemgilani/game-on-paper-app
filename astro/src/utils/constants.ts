import { range } from "./misc";

export const CURRENT_YEAR = 2025;
export const AVAILABLE_SEASONS = range(2002, 2025);
export const ALPHABET = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
export const CONFERENCE_MAP = {
    80: "FBS (I-A)",
    1: "ACC",
    151: "AAC",
    4: "Big 12",
    5: "B1G",
    12: "C-USA",
    18: "Independent",
    15: "MAC",
    17: "MWC",
    9: "Pac-12",
    8: "SEC",
    37: "Sun Belt",

    81: "FCS (I-AA)",
    176: "ASUN",
    20: "Big Sky",
    40: "Big South",
    48: "CAA",
    22: "Ivy",
    24: "MEAC",
    21: "MVFC",
    25: "NEC",
    26: "OVC",
    27: "Patriot",
    28: "Pioneer",
    31: "SWAC",
    29: "Southern",
    30: "Southland",
    // 26: "WAC",

    35: "Div II/III"
}
export const FBS_CONFERENCES = ['1','4','5','8','9','12','15','17','37','151','80', '18'];
export const MEME_LIST = [61];
export const NETWORK_MAPPINGS = {
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
    "TNT": "https://www.tntdrama.com/watchtnt"
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