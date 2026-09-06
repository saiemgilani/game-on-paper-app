import type { ESPNCompetition, ESPNScheduleEvent, ESPNTeam, ESPNCompetitor, ESPNStatus } from "../resources/espn";
import { MEME_LIST, SDV_BASE_METRIC_TITLES, FBS_CONFERENCES } from "./constants";
import { GLOBAL_GROUP_LIST } from "../resources/schedule"

export type RGBColor = { r: number, g: number, b: number};
export const STANDARD_THEME_COLOR = "#2394fd"
export const STANDARD_THEME_BACKGROUND_RGBA = "rgba(35, 148, 253, 0.25)"
export const STANDARD_THEME_HOVER_RGBA = "rgba(35, 148, 253, 0.5)"

export const WHITE_THEME_COLOR = "#ffffff"
export const WHITE_THEME_BACKGROUND_RGBA = "rgba(255, 255, 255, 0.25)"
export const WHITE_THEME_HOVER_RGBA = "rgba(255, 255, 255, 0.5)"

export const BLACK_THEME_COLOR = "#000000"
export const BLACK_THEME_BACKGROUND_RGBA = "rgba(0, 0, 0, 0.25)"
export const BLACK_THEME_HOVER_RGBA = "rgba(0, 0, 0, 0.5)"

export enum SpiceLevel {
    WATER = 'testing',
    BELL = 'none',
    SERRANO = 'close-late',
    CAYENNE = 'ranked-upset',
    GHOST = 'ranked-close-late',
    REAPER = 'fcs-upset'
}


export function cleanUpParams(payload: any): any {
    let query = {...payload};
    for (let param in query) { 
        if (query[param] === undefined /* In case of undefined assignment */
            || query[param] === null 
            || query[param] === ""
        ) {    
            delete query[param];
        }
    }
    return query;
}

// async function ping(url) {
//     let check = { "status": 404 };
//     try {
//         check = await axios.get(url)
//         return { "status": check.status } 
//     } catch (err) {
//         console.error(`Error while checking status of ${url}: ${err}`)
//         return { "status": 500 };
//     }
// }

export async function sleep(sec: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, sec * 1000);
  });
}

export async function waitForElement(document: HTMLDocument, id: string, delay: number = 0.1, maxTimeout: number = 1.0): Promise<HTMLElement> {
    let target = null;
    let sumDelay = 0;
    while (target == null) {
        console.log(`Waiting for id ${id} to be available...`)
        target = document.getElementById(id)
        if (target) {
            console.log(`id ${id} found, rendering chart`)
            break;
        } else if (sumDelay < maxTimeout) {
            console.log(`id ${id} not available, sleeping for ${delay} sec...`)
            await sleep(delay)
            sumDelay += delay
        } else {
            throw Error(`waiting for id ${id} has taken longer than maxTimeout of ${maxTimeout} sec`)
        }
    }
    return target
}

// function generateChecksum(game) {
//     return crypto.createHash('sha256').update(JSON.stringify(game)).digest('hex');
// }


// https://stackoverflow.com/questions/8273047/javascript-function-similar-to-python-range
export function range(start: number, end: number): number[] {
    return Array.from(Array(end + 1).keys()).slice(start);
}

export function roundNumber(value: string | number | undefined | null, power10: number, fixed: number): string {
    if (typeof value == "number") {
        value = `${value}`;
    }
    return (Math.round(parseFloat(value || "0") * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

export function hexToRgb(hex: string): RGBColor | null {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

export function getNumberWithOrdinal(n: number): string {
    let s = ["th", "st", "nd", "rd"];
    let v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function toTitleCase(str: string) {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  );
}


export function toUnique<T>(a: T[]): T[] {
    return a.sort().filter(function(item, pos, ary) {
        return !pos || item != ary[pos - 1];
    });
}

export function formatDown(down: number, playType: string): string {
    if (playType.includes("Kickoff")) {
        return "Kickoff"
    } else if (playType.includes("Extra Point") || playType.includes("Conversion")) {
        return "PAT"
    } else if (down > -1) {
        return getNumberWithOrdinal(down)
    } else {
        return `${down}`;
    }
}

export function formatYardline(yardsToEndzone: number, offenseAbbreviation: string, defenseAbbreviation: string, playType: string): string {
    if (yardsToEndzone == 50) {
        return "50";
    } else if (yardsToEndzone < 50) {
        return `${defenseAbbreviation} ${yardsToEndzone}`
    } else if (playType?.includes("Kickoff") ?? false) {
        return `${defenseAbbreviation} ${100 - yardsToEndzone}`
    } else {
        return `${offenseAbbreviation} ${100 - yardsToEndzone}`
    }
}

export function formatDistance(period: number, down: number, type: string, distance: number, yardline: number): string {
    if (period >= 5 && down == 0) {
        return "2PT"
    }
    var dist = (distance == 0 || yardline <= distance) ? "Goal" : distance
    var downForm = formatDown(down, type)
    if (downForm.includes("Kickoff") || downForm.includes("PAT")) {
        return downForm
    } else {
        return downForm + " & " + dist
    }
}

export function tryDivide(value: number, denom: number): number {
    if (!denom) {
        return 0
    }
    return value / denom
}

export function determineLuminance(color: string): number | null {
    const rgb = hexToRgb(color)
    if (rgb) {
        return ((0.2126*rgb.r) + (0.7152*rgb.g) + (0.0722*rgb.b)) / 255
    }
    return null;
}

// https://stackoverflow.com/a/52453462
function deltaE(rgbA: number[], rgbB: number[]): number {
    let labA = rgb2lab(rgbA);
    let labB = rgb2lab(rgbB);
    let deltaL = labA[0] - labB[0];
    let deltaA = labA[1] - labB[1];
    let deltaB = labA[2] - labB[2];
    let c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
    let c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
    let deltaC = c1 - c2;
    let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
    deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
    let sc = 1.0 + 0.045 * c1;
    let sh = 1.0 + 0.015 * c1;
    let deltaLKlsl = deltaL / (1.0);
    let deltaCkcsc = deltaC / (sc);
    let deltaHkhsh = deltaH / (sh);
    let i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
    return i < 0 ? 0 : Math.sqrt(i);
}

function rgb2lab(rgb: number[]): number[] {
    let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
    r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    x = (x > 0.008856) ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = (y > 0.008856) ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = (z > 0.008856) ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)]
}

export function getCurrentViewport(document: HTMLDocument, window: Window): 'xs' | 'sm' | 'md' | 'lg' | 'xl' {
// https://stackoverflow.com/a/8876069
    const width = Math.max(
        document.documentElement.clientWidth,
        window.innerWidth || 0
    )
    if (width <= 576) return 'xs'
    if (width <= 768) return 'sm'
    if (width <= 992) return 'md'
    if (width <= 1200) return 'lg'
    return 'xl'
}

export function getImageSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 25;
        case 'md':
        case 'lg':
        case 'xl':
            return 37.5;
    }
}

export function getTitleSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 15;
        case 'md':
        case 'lg':
        case 'xl':
            return 20;
    }
}

export function getAxisTitleSizeForViewport(viewport: 'xs' | 'sm' | 'md' | 'lg' | 'xl'): number {
    switch (viewport) {
        case 'xs':
        case 'sm':
            return 10
        case 'md':
        case 'lg':
        case 'xl':
            return 15;
    }
}

/**
 * Normalize an ESPN team color into a usable CSS hex.
 * ESPN omits `color` entirely for some schools (LIU 2341, West Florida 110242,
 * most non-FBS), which used to throw on `.startsWith` and 500 the team page /
 * kill DriveChart hydration. Always returns a paintable color.
 */
/**
 * Join class names, dropping anything falsy.
 *
 * Interpolating an optional class straight into a template literal renders the
 * string "undefined" into the class attribute when it is not set -- which is
 * what put `class="row border rounded m-2 mb-4 undefined spice-level-none"` on
 * every game card on the scoreboard and home page.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(" ");
}

export function teamColorHex(color: string | null | undefined, fallback: string = STANDARD_THEME_COLOR): string {
    const c = (color ?? "").trim();
    if (!c) return fallback;
    return c.startsWith("#") ? c : `#${c}`;
}

export function adjustTeamColorsForContrast(awayTeam: { color: string, alternateColor: string }, homeTeam: { color: string, alternateColor: string }): RGBColor[] {
    let awayTeamColor = hexToRgb(awayTeam.color) || { r: 0, g: 0, b: 255 }
    let homeTeamColor = hexToRgb(homeTeam.color) || { r: 255, g: 0, b: 0 }

    // if the homeTeamColor and the awayTeamColor are too similar, make the awayTeam use their alt
    let dEHome = deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b])
    if (dEHome <= 49 && awayTeam.alternateColor != null) {
        awayTeamColor = hexToRgb(awayTeam.alternateColor) || { r: 0, g: 0, b: 255 }
        console.log(`updating away team color from primary ${JSON.stringify(hexToRgb(awayTeam.color))} to alt: ${JSON.stringify(awayTeamColor)}`)
        if (deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b]) <= 49) {
            awayTeamColor = hexToRgb(awayTeam.color) || { r: 0, g: 0, b: 255 }
            console.log(`resetting away team color from alt ${JSON.stringify(hexToRgb(awayTeam.alternateColor))} from alt: ${JSON.stringify(awayTeamColor)} bc of similarity`)
        }
    }

    // if either color is too similar to white, use gray
    let colors = [homeTeamColor, awayTeamColor]
    var adjusted = false;
    colors.forEach((clr, idx) => {
        var dEBackground = deltaE([clr.r, clr.g, clr.b], [255,255,255])
        if (dEBackground <= 49) {
            adjusted = true;
            if (idx == 0) {
                homeTeamColor = hexToRgb("#CCCCCC") || { r: 204, g: 204, b: 204 }
            } else {
                awayTeamColor = hexToRgb("#CCCCCC") || { r: 204, g: 204, b: 204 }
            }
            console.log(`updating color at index ${idx} to gray bc of background`)
        }
    })

    // if both colors are now gray, reset the homeTeamColor
    let dEHomeAdj = deltaE([awayTeamColor.r, awayTeamColor.g, awayTeamColor.b], [homeTeamColor.r, homeTeamColor.g, homeTeamColor.b])
    if (dEHomeAdj <= 49 && adjusted) {
        homeTeamColor = hexToRgb(homeTeam.color) || { r: 255, g: 0, b: 0 }
        console.log(`resetting home color to ${JSON.stringify(homeTeamColor)} because of similarity to gray away color`)
    }

    return [awayTeamColor, homeTeamColor]
}

export function adjustColorForContrast(primaryColor: RGBColor, altColor: RGBColor, comparisonColor: RGBColor): RGBColor {
    // const compColor = (isDarkMode) ? hexToRgb("#000000") : hexToRgb("#FFFFFF")
    let dEBGTeam = deltaE([primaryColor.r, primaryColor.g, primaryColor.b], [comparisonColor.r, comparisonColor.g, comparisonColor.b])
    let dEBGAlt = deltaE([altColor.r, altColor.g, altColor.b], [comparisonColor.r, comparisonColor.g, comparisonColor.b])

    var teamColor = primaryColor;
    if (dEBGTeam > 49) {
        teamColor = primaryColor
        console.log(`set team color to primary ${JSON.stringify(primaryColor)} because no similarity to background`)
    } else if (dEBGTeam <= 49 && dEBGAlt > 49) {
        teamColor = altColor
        console.log(`set team color to alt ${JSON.stringify(altColor)} because of similarity to background`)
    } else {
        teamColor = primaryColor
        console.log(`set team color to primary ${JSON.stringify(primaryColor)} because backup`)
    }
    
    return teamColor
}

export function calculateCumulativeSums(arr: number[]): number[] {
    const cumulativeSum = (sum => (value: number) => sum += value)(0);
    return arr.map(cumulativeSum);
}

export function cleanField(team: any, field: string): string {
    if (!team) {
        return ""
    }

    if (team.team_id && MEME_LIST.includes(Number(team.team_id))) {
        return team[field]?.toLocaleLowerCase() || ""
    }

    if (team.teamId && MEME_LIST.includes(Number(team.teamId))) {
        return team[field]?.toLocaleLowerCase() || ""
    }

    if (MEME_LIST.includes(Number(team.id))) {
        return team[field]?.toLocaleLowerCase() || ""
    }
    return team[field] || ""
}

export function cleanAbbreviation(team: any): string {
    return cleanField(team, "abbreviation")
}

export function cleanName(team: any): string {
    return cleanField(team, "name")
}

export function cleanLocation(team: any): string {
    return cleanField(team, "location")
}

export function cleanNickname(team: any): string {
    return cleanField(team, "nickname")
}

export function translateValue(input: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  var leftRange = inMax - inMin;
  var rightRange = outMax - outMin;
  var scaledValue = (input - inMin) / leftRange;
  return outMin + (scaledValue * rightRange);
}

export function retrieveValue(dictionary: any, key: string): string {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        if (sub) {
            sub = sub[k];
        }
    }
    return sub;
}


export function getPercentileKey(metric: string): string {
    const cleanedMetric = (
        metric
            .replace("_off", "")
            .replace("_def", "")
            .replace("_margin", "")
    )
    switch (cleanedMetric) {
        case "EPAplay": 
            return "EPAplay";
        case "yardsplay": 
            return "yardsplay";
        case "success": 
            return "success";
        case "EPAplay_pass": 
            return "EPAdropback";
        case "yardsplay_pass": 
            return "yardsdropback";
        case "success_pas": 
            return "pass_success";
        case "EPAplay_rush": 
            return "EPArush";
        case "yardsplay_rush": 
            return "yardsrush";
        case "success_rush": 
            return "rush_success";
        case "havoc": 
            return "havoc";
        case "explosive_pass":
            return "pass_explosive";
        case "explosive_rush":
            return "rush_explosive";
        case "opportunity_rate":
            return "opportunity_run";
        case "line_yards":
            return "lineyards";
        case "play_stuffed":
            return "play_stuffed";
        case "explosive":
            return "explosive";
        case "nonExplosiveEpaPerPlay":
            return "nonExplosiveEpaPerPlay";
        case "early_down_EPA":
            return "early_down_EPA";
        case "late_down_success":
            return "late_down_success";
        case "third_down_distance":
            return "third_down_distance";
        default:
            return metric;
    }
}

export function generateColorRampValue(input: number | undefined | null, max: number, inverted: boolean = false): string | null {
    if (!input && input != 0) {
        return null;
    }
    
    let value = inverted ? (max - input) / max : (input) / max
    let step = Math.round(value / 0.1)
    let clampedStep = Math.min(Math.max(step, 0), 9)

    if (clampedStep == 4 || clampedStep == 5) {
        return null
    } else {
        return `hulk-bg-level-${clampedStep}`
    }
}

export function generateTeamMetricTitle(metric: string): string {
    const cleanedMetric = metric.replace("_def","").replace("_off","").replace("net_","").replace("off_","").replace("def_","").replace("_margin","").replace("_pass","").replace("_rush","").replace("pass_","").replace("rush_","")

    let title = SDV_BASE_METRIC_TITLES[cleanedMetric] || metric

    let prefix = ""
    if (metric.includes("_off") || metric.includes("off_")) {
        prefix = "Off"
    } else if (metric.includes("_def") || metric.includes("def_")) {
        prefix = "Def"
    } else if (metric.includes("_margin") || metric.includes("net_")) {
        prefix = "Net"
    } 
    
    if (metric.includes("_pass")) {
        if (title.includes("Play")) {
            title = title.replace("Play", "Dropback")
        } else if (!title.startsWith("Pass")) {
            title = `Pass ${title}`
        }
    } else if (metric.includes("_rush")) {
        if (title.includes("Play")) {
            title = title.replace("Play", "Rush")
        } else if (!title.startsWith("Rush")) {
            title = `Rush ${title}`
        }
    }
    
    if (!prefix) {
        return title;
    } else {
        return `${prefix} ${title}`;
    }
}


export function formatNumberForMetric(metric: string, value: number): string {
    const cleanedMetric = metric.replace("_def","").replace("_off","").replace("net_","").replace("off_","").replace("def_","").replace("_margin","").replace("_pass","").replace("_rush","").replace("pass_","").replace("rush_","")
    
    switch (cleanedMetric) {
        case "net_adj_epa":
        case "adj_epa": 
        case "strength_faced":
        case "EPAplay": 
        case "EPAdropback":
        case "EPArush":
        case "yardsplay": 
        case "yardsdropback":
        case "yardsrush":
        case "lineyards":
        case "line_yards":
        case "nonExplosiveEpaPerPlay":
        case "early_down_EPA":
        case "third_down_distance":
            return `${roundNumber(value, 2, 2)}`;
        case "success": 
        case "havoc":
        case "explosive":
        case "play_stuffed":
        case "opportunity_run":
        case "opportunity_rate":
        case "late_down_success":
            return `${roundNumber((100.0 * value), 2, 0)}%`
        default:
            return `${roundNumber(value, 2, 2)}`;
    }
}

export function shouldInvertSortForMetric(category: string, metric: string): boolean {
    return (category == "defensive" && !["havoc_def", "havoc", "play_stuffed_def", "play_stuffed", "third_down_distance_def", "third_down_distance"].includes(metric)) || (category == "offensive" && ["havoc_off", "havoc", "play_stuffed_off", "play_stuffed", "third_down_distance_off", "third_down_distance"].includes(metric))
}

export function generateCategoryForMetric(metric: string): string {
    return (metric.includes("_margin") || metric.startsWith("net_")) ? "Differential" : ((metric.includes("_off") || metric.includes("off_")) ? "Offensive" : "Defensive");
}

export function modifyMetricForCategory(category: string, metric: string) {
    if (category == "offensive" && ["adj_def_epa", "net_adj_epa"].includes(metric)) {
        return "adj_off_epa"
    } else if (category == "defensive" && ["adj_off_epa", "net_adj_epa"].includes(metric)) {
        return "adj_def_epa"
    } else if (category == "differential" && ["adj_off_epa", "adj_def_epa"].includes(metric)) {
        return "net_adj_epa"
    } else if (category == "offensive" && (metric.includes("_def") || metric.includes("_margin"))) {
        return metric.replace("_def", "_off").replace("_margin", "_off")
    } else if (category == "defensive" && (metric.includes("_off") || metric.includes("_margin"))) {
        return metric.replace("_off", "_def").replace("_margin", "_def")
    } else if (category == "differential" && (metric.includes("_off") || metric.includes("_def"))) {
        return metric.replace("_off", "_margin").replace("_def", "_margin")
    }
    return metric;
}

export function generateSubCategoryForMetric(metric: string): string {
    if (metric.includes("passrate_")) {
        return "Passing"
    }
    if (metric.includes("rushrate_") || metric.includes("play_stuffed") || metric.includes("opportunity_rate") || metric.includes("opportunity_run") || ["line_yards", "lineyards", "opportunity_rate", "opportunity_run"].includes(metric)) {
        return "Rushing"
    }

    if (metric.includes("_pass")) {
        return "Passing"
    }

    if (metric.includes("_rush")) {
        return "Rushing"
    }

    return "Other"
}

export function isEventFavorite(favorites: { teams?: (string | number)[], games?: (string | number)[] }, g: ESPNScheduleEvent | ESPNCompetition): boolean {
    if ((favorites.games || []).includes(g.id)) {
        return true;
    }

    const ids = Object.keys(g).includes("competitions") ? (g as ESPNScheduleEvent).competitions.flatMap(c => c.competitors.map(p => p.id)) : (g as ESPNCompetition).competitors.map(p => p.id)
    const idSet = new Set(ids)
    if (idSet.intersection(new Set((favorites.teams || []))).size > 0) {
        return true
    }
    
    return false
}

export function isTeamFavorite(favorites?: { teams?: (string | number)[], games?: (string | number)[] }, tId?: string | number): boolean {
    if (!favorites) {
        return false;
    }

    if (!tId) {
        return false;
    }

    if ((favorites.teams || []).includes(tId)) {
        return true;
    }
    
    return false
}

// adapted from https://www.math.ucla.edu/~tom/distributions/normal.html?
export function calculateNormCdf(x: number, mean: number, sd: number): number {
    const z = (x - mean) / sd
    const T = 1 / (1+.2316419 * Math.abs(z));
	const D = .3989423 * Math.exp(-z*z/2);
	const Prob = D * T * (.3193815 + T * (-.3565638 + T * (1.781478 + T * (-1.821256 + T * 1.330274))));
	return (z > 0) ? (1 - Prob) : Prob;
}

export async function safeCachePut(cache: KVNamespace, key: string, value: string, ttl: number,
                                   metadata?: Record<string, unknown>): Promise<void> {
    try {
        await cache.put(key, value, { expirationTtl: ttl, metadata })
    } catch (e: any) {
        console.error(`ERROR while writing to KV with key ${key}: ${e}, ${e.stack}`)
    }
}

export function cleanScore(score: { displayValue: string } | string): number {
    return (typeof(score) == 'object') ? parseInt(score.displayValue) : parseInt(score)
}

export function isChampionshipEvent(gameNote: string): boolean {
    return (
        gameNote.includes("CFP")
        || gameNote.includes("College Football Playoff")
        || gameNote.includes("National Championship")
        || gameNote.includes("FCS Championship")
        || gameNote.includes("Celebration Bowl") // HBCU National Championship
        || gameNote.includes("Division II Championship")
        || gameNote.includes("Division III Championship")
    );
}



export function getRecordString(competitor: ESPNCompetitor): string {
    if (!competitor.records) {
        return '';
    }
    const records = competitor.records || [];
    const overallStuff = records.filter(item => item.type == "total")[0];
    const overall = overallStuff?.summary || "0-0"
    
    let base = '';
    if (overall) {
        base += `${overall}`
    }

    const confStuff = records.filter(item => item.type == "vsconf")[0];
    const confRec = confStuff?.summary || "0-0"

    const indyConfs = [18, 35, 80, 81];
    const confId = parseInt(competitor.team.conferenceId);
    // const conf = CONFERENCE_MAP[confId];
    const conf = GLOBAL_GROUP_LIST.find((p) => p.id == confId);
    if (confStuff && conf && !indyConfs.includes(confId)) {
        base += `, ${confRec} ${conf.name}`
    } else if (conf) {
        base += ` ${conf.name}`
    }
    return `<span class="small text-muted h6">${base}</span>`;
}

export function generateMarginalString(input: number | undefined | null, power10: number, fixed: number): string {
    if (!input && input != 0) {
        return "N/A";
    }

    if (input >= 0) {
        return `+${roundNumber(input, power10, fixed)}`;
    } else {
        return roundNumber(input, power10, fixed);
    }
}

export function formatRank(rank: number | undefined | null) {
    if (!rank && rank != 0) {
        return "N/A"
    }

    let tied = String(rank)?.includes(".5") || false
    let rankString = ""
    if (rank && tied) {
        rankString = `T-${roundNumber(Math.floor(rank), 2, 0)}`;
    } else if (rank) {
        rankString = `${roundNumber(Math.floor(rank), 2, 0)}`
    } else {
        rankString = "N/A"
    }
    return rankString
}

export function produceTeamLogoLink(team?: { team_id: string | number, school: string, season?: string | number } | null, headerType: string = "h4", showNickname: boolean = false, imgSize: string = "35px"): string {
    if (!team) {
        return `<${headerType} class="d-inline"><a href="/teams"><img class="img-fluid" width="${imgSize}" src="/assets/img/favicon.svg" alt="unknown team"/></a> Unknown Team</${headerType}>`
    }
    const teamLink = (team.season) ? `/year/${team.season}/team/${team.team_id}` : `/team/${team.team_id}`
    return `<${headerType} class="d-inline"><a href="${teamLink}"><img class="img-fluid team-logo-${team.team_id}" width="${imgSize}" src="https://a.espncdn.com/i/teamlogos/ncaa/500/${team.team_id}.png" alt="ESPN team id ${team.team_id}"/></a>${showNickname ? (" " + cleanField(team, "school")) : ""}</${headerType}>`
}

export function capitalizeFirstLetter(val: string): string {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

export function deduplicateByKey(array: any[], key: string): any[] {
    var seen: Record<any, boolean> = {};
    return array.filter(function(item) {
        const val = item[key]
        return seen.hasOwnProperty(val) ? false : (seen[val] = true);
    });
}