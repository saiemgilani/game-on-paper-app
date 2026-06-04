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