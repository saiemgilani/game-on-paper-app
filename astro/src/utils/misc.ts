import type { ESPNTeam } from "../resources/espn";
import { MEME_LIST } from "./constants";


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
//         logger.error(`Error while checking status of ${url}: ${err}`)
//         return { "status": 500 };
//     }
// }

// async function sleep(sec) {
//   return new Promise((resolve) => {
//     setTimeout(resolve, sec * 1000);
//   });
// }

// function generateChecksum(game) {
//     return crypto.createHash('sha256').update(JSON.stringify(game)).digest('hex');
// }


// https://stackoverflow.com/questions/8273047/javascript-function-similar-to-python-range
export function range(start: number, end: number): number[] {
    return Array.from(Array(end + 1).keys()).slice(start);
}

export function roundNumber(value: string | number | null, power10: number, fixed: number): string {
    if (typeof value == "number") {
        value = `${value}`;
    }
    return (Math.round(parseFloat(value || "0") * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

export function hexToRgb(hex: string): { r: number, g: number, b: number } | null {
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

export function formatDistance(down: number, type: string, distance: number, yardline: number): string {
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

export function adjustColorsForContrast(awayTeam: ESPNTeam, homeTeam: ESPNTeam): { r: number, g: number, b: number}[] {
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

export function calculateCumulativeSums(arr: number[]): number[] {
    const cumulativeSum = (sum => (value: number) => sum += value)(0);
    return arr.map(cumulativeSum);
}

export function cleanField(team: any, field: "abbreviation" | "name" | "location" | "team"): string {
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

export function translateValue(input: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  var leftRange = inMax - inMin;
  var rightRange = outMax - outMin;
  var scaledValue = (input - inMin) / leftRange;
  return outMin + (scaledValue * rightRange);
}