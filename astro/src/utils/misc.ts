import type { ESPNCompetition, ESPNScheduleEvent, ESPNTeam, ESPNCompetitor, ESPNStatus } from "../resources/espn";
import { MEME_LIST, SDV_BASE_METRIC_TITLES, FBS_CONFERENCES, SDV_TEAM_METRIC_CATEGORIES } from "./constants";
import { espnLogoLeague, leaguePath, type League } from "./league";
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

/** "2004 to 2025", a single year, or a placeholder when a table returned nothing (never "undefined"). */
export function yearRange(seasons: number[]): string {
    const s = [...new Set(seasons)].sort();
    if (s.length === 0) return 'none yet';
    return s.length > 1 ? `${s[0]} to ${s[s.length - 1]}` : `${s[0]}`;
}

/** "2024", "2024 and 2026", "2023, 2024, and 2026": a list the way a sentence says it, Oxford comma included. */
export function joinWithAnd(items: (string | number)[]): string {
    if (items.length < 2) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function roundNumber(value: string | number | undefined | null, power10: number, fixed: number): string {
    if (typeof value == "number") {
        value = `${value}`;
    }
    return (Math.round(parseFloat(value || "0") * (Math.pow(10, power10))) / (Math.pow(10, power10))).toFixed(fixed)
}

/**
 * Text that is safe inside an HTML attribute or a text node. For the handful of
 * places that build markup as a string (the admin dashboard's tables) rather
 * than letting Astro escape it.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/**
 * A usable number, or null. The one guard for "did this field carry a number":
 * null, undefined, "", "NA" and anything non-finite (NaN, Infinity) read null.
 * Every caller that used to re-declare its own finite-number check uses this.
 */
export function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '' || value === 'NA') return null;
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
}

/** A rate stored as a fraction, in percentage points. Null stays null. */
export function toPercent(value: unknown): number | null {
    const n = finiteNumber(value);
    return n === null ? null : n * 100;
}

/**
 * Present-and-finite, so a column the producer did not publish reads as absent
 * rather than as a zero. The three formatters below are the only ones the site
 * needs for a producer-backed table cell -- they live here, beside
 * `roundNumber`, rather than being re-declared per component.
 */
export function numberOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    // the WHOLE string or nothing: `parseFloat` reads a numeric prefix, so a
    // malformed producer value ("12abc") used to render and aggregate as 12
    const text = v.trim();
    if (text === '' || text === 'NA') return null;
    const x = Number(text);
    return Number.isFinite(x) ? x : null;
}

/** A numeric cell: `roundNumber` when there is a number, an em dash when there is not. */
export function formatNumber(v: unknown, fixed: number, power10: number = 2): string {
    const x = numberOrNull(v);
    return x === null ? "—" : roundNumber(x, power10, fixed);
}

/** A 0-1 rate as a percentage ("48.0%"), or an em dash when absent. */
export function formatPercent(v: unknown, fixed: number = 1): string {
    const x = numberOrNull(v);
    return x === null ? "—" : `${roundNumber(x * 100, 2, fixed)}%`;
}

/**
 * Decimal places for a metric cell: an explicit 0 means zero places, a missing
 * value means one. Shared by both BinionBoxScore twins so the guard cannot
 * drift between them (`decimalPoints || 1` silently turns an explicit 0 into 1).
 */
export function metricDecimalPoints(decimalPoints: number | null | undefined): number {
    return decimalPoints ?? 1;
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

// ---------------------------------------------------------------------------
// One colour decision per game (flag 'game-colours'). The page decides once
// and hands the same pairs to every chart, so the drive chart, the WP/EP
// charts, the radar and the Deserved Win % bars can no longer disagree.
//
// A pair is usable when the two colours are far enough apart (CIE ΔE2000) and
// each reads on the page background. The light and dark themes get a pair
// each, so a dark team colour stays true on the light theme and is only lifted
// where the dark theme needs it. Consumers pick the pair with the site's own
// theme switch, `prefers-color-scheme` (dark-game.css, DarkModeLogos).
// ---------------------------------------------------------------------------

export type GameColors = { home: string, away: string };
export type ThemedGameColors = { light: GameColors, dark: GameColors };
/** The page backgrounds: `body` in bootstrap/base.css (light) and dark-game.css (dark). */
export const GAME_BACKGROUNDS = { light: "#ffffff", dark: "#181a1b" } as const;
/**
 * Pairs closer than this read as one team. Calibrated on every 2004-2026 CFB
 * game's ESPN header colours: below 20, same-hue pairs (maroon/red,
 * navy/royal) still look like one colour at chart line width; it flags 22%
 * of games, where the old ΔE94 <= 49 rule flagged 64%.
 */
export const GAME_COLOR_MIN_DELTA_E = 20;
/** Each colour against its theme's background (WCAG ratio). */
export const GAME_COLOR_MIN_CONTRAST = 2.5;

type TeamColorSource = { color?: string | null, alternateColor?: string | null, alt_color?: string | null } | null | undefined;

/** '#rrggbb' or null. team_info carries the literal strings 'null' / '#null' for a missing colour. */
function validTeamHex(value: unknown): string | null {
    const m = /^#?([a-f\d]{6})$/i.exec(String(value ?? "").trim());
    return m ? `#${m[1].toLowerCase()}` : null;
}

function rgbToHex(rgb: number[]): string {
    return "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function hexToLab(hex: string): number[] {
    const c = hexToRgb(hex)!;
    return rgb2lab([c.r, c.g, c.b]);
}

// inverse of rgb2lab (D65, sRGB), clamped into gamut
function lab2rgb([L, A, B]: number[]): number[] {
    const fy = (L + 16) / 116, fx = A / 500 + fy, fz = fy - B / 200;
    const f = (t: number) => (t ** 3 > 0.008856) ? t ** 3 : (t - 16 / 116) / 7.787;
    const x = 0.95047 * f(fx), y = f(fy), z = 1.08883 * f(fz);
    const lin = [
        x * 3.2406 + y * -1.5372 + z * -0.4986,
        x * -0.9689 + y * 1.8758 + z * 0.0415,
        x * 0.0557 + y * -0.2040 + z * 1.0570,
    ];
    return lin.map((v) => {
        const s = v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
        return Math.max(0, Math.min(1, s)) * 255;
    });
}

/** CIEDE2000 colour difference between two hex colours. */
export function deltaE2000(hexA: string, hexB: string): number {
    const [L1, a1, b1] = hexToLab(hexA), [L2, a2, b2] = hexToLab(hexB);
    const rad = Math.PI / 180;
    const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hue = (ap: number, bp: number) => (ap === 0 && bp === 0) ? 0 : ((Math.atan2(bp, ap) / rad) + 360) % 360;
    const h1 = hue(a1p, b1), h2 = hue(a2p, b2);
    const dL = L2 - L1, dC = C2p - C1p;
    let dh = 0;
    if (C1p * C2p !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : (h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360);
    const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh * rad / 2);
    const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
    let Hm = h1 + h2;
    if (C1p * C2p !== 0) Hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2);
    const T = 1 - 0.17 * Math.cos((Hm - 30) * rad) + 0.24 * Math.cos(2 * Hm * rad) + 0.32 * Math.cos((3 * Hm + 6) * rad) - 0.20 * Math.cos((4 * Hm - 63) * rad);
    const dTheta = 30 * Math.exp(-(((Hm - 275) / 25) ** 2));
    const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
    const Sl = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2);
    const Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrastRatio(hexA: string, hexB: string): number {
    const lum = (hex: string) => {
        const c = hexToRgb(hex)!;
        const [r, g, b] = [c.r, c.g, c.b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * The home and away colours for a game, one pair per theme: one decision, used
 * by every chart.
 *
 * Each team's `primary` / `alt` is the first valid colour across its sources,
 * so pass `[teamInfoRow, espnHeaderTeam]` to let ESPN fill a team_info 'null'.
 * Each theme runs the same scorer against its own background. Candidates, in
 * order: both primaries, away alt, home alt, both alts. The first pair that is
 * ΔE2000 >= GAME_COLOR_MIN_DELTA_E apart with each colour >= GAME_COLOR_MIN_CONTRAST
 * against the background wins, so the primaries are kept whenever they work.
 * Failing that, the same candidates with each unreadable colour's L* moved
 * just far enough from the background to read; failing that, the away
 * colour's L* is walked away from the home colour's until they separate.
 * Deterministic, and never the clashing pair.
 */
export function pickGameColors(
    home: TeamColorSource | TeamColorSource[],
    away: TeamColorSource | TeamColorSource[],
    backgrounds: { light: string, dark: string } = GAME_BACKGROUNDS,
    minDeltaE: number = GAME_COLOR_MIN_DELTA_E,
): ThemedGameColors {
    const slots = (src: TeamColorSource | TeamColorSource[]) => {
        const list = Array.isArray(src) ? src : [src];
        const first = (pick: (s: NonNullable<TeamColorSource>) => unknown[]) =>
            list.flatMap((s) => (s ? pick(s) : [])).map(validTeamHex).find((c) => c !== null) ?? null;
        const alt = first((s) => [s.alternateColor, s.alt_color]);
        return { primary: first((s) => [s.color]) ?? alt ?? STANDARD_THEME_COLOR, alt };
    };
    const h = slots(home), a = slots(away);
    const candidates = [[h.primary, a.primary], [h.primary, a.alt], [h.alt, a.primary], [h.alt, a.alt]]
        .filter((p): p is [string, string] => p[0] !== null && p[1] !== null);
    return {
        light: pickPairOn(candidates, backgrounds.light, minDeltaE),
        dark: pickPairOn(candidates, backgrounds.dark, minDeltaE),
    };
}

function pickPairOn(candidates: [string, string][], background: string, minDeltaE: number): GameColors {
    const readable = (c: string) => contrastRatio(c, background) >= GAME_COLOR_MIN_CONTRAST;
    const apart = (x: string, y: string) => deltaE2000(x, y) >= minDeltaE;
    const withLightness = (c: string, L: number) => { const lab = hexToLab(c); return rgbToHex(lab2rgb([L, lab[1], lab[2]])); };
    // the side with room to read: darker on a light background, lighter on a dark one
    const dir = hexToLab(background)[0] >= 50 ? -1 : 1;
    // nearest L* at which the colour reads on this background
    const readableVariant = (c: string) => {
        if (readable(c)) return c;
        const L0 = hexToLab(c)[0];
        for (let k = 1; k <= 100; k++) {
            const v = withLightness(c, L0 + dir * k);
            if (readable(v)) return v;
        }
        return c;
    };

    for (const [x, y] of candidates) if (readable(x) && readable(y) && apart(x, y)) return { home: x, away: y };
    const variants = candidates.map(([x, y]) => [readableVariant(x), readableVariant(y)]);
    for (const [x, y] of variants) if (apart(x, y)) return { home: x, away: y };

    // walk the away colour's L* away from home's, then back past its start;
    // keep the widest readable separation seen in case nothing clears
    const [x, y] = variants[0];
    const Lx = hexToLab(x)[0], Ly = hexToLab(y)[0];
    const out = Ly >= Lx ? 1 : -1;
    let best: GameColors = { home: x, away: y }, bestDE = deltaE2000(x, y);
    for (const dir of [out, -out]) {
        for (let k = 1; k <= 100; k++) {
            const v = withLightness(y, Ly + dir * k);
            if (!readable(v)) break;
            const d = deltaE2000(x, v);
            if (d >= minDeltaE) return { home: x, away: v };
            if (d > bestDE) { best = { home: x, away: v }; bestDE = d; }
        }
    }
    return best;
}

export function calculateCumulativeSums(arr: number[]): number[] {
    const cumulativeSum = (sum => (value: number) => sum += value)(0);
    return arr.map(cumulativeSum);
}

/** Is THIS team id on a meme list? The one place the list is consulted. */
export function isMemeTeam(id: unknown): boolean {
    if (id === null || id === undefined || id === "") return false
    return MEME_LIST.includes(Number(id))
}

/**
 * A piece of text lowercased when the team it belongs to is on a meme list.
 *
 * `cleanField` reads the id off the ROW, which is right when the row is a team
 * and wrong when it is not: a player's game log row carries HIS team's id, so
 * every opponent in it was lowercased once his team made the list (review on
 * #267). Anything that names a team other than the row's own -- an opponent, a
 * player -- names the id it means here instead.
 */
export function cleanTextForTeam(text: unknown, teamId: unknown): string {
    const s = text === null || text === undefined ? "" : String(text)
    return isMemeTeam(teamId) ? s.toLocaleLowerCase() : s
}

export function cleanField(team: any, field: string): string {
    if (!team) {
        return ""
    }

    if ([team.pos_team_id, team.team_id, team.teamId, team.id].some(isMemeTeam)) {
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
    // opponents MISSING field goals is the lucky outcome, so the lowest opp FG% leads
    if (metric == "luck_opp_fg_pct_def") return true;
    // fewer opponent series converted is the better defense
    if (metric == "series_conv_def") return true;
    return (category == "defensive" && !["havoc_def", "havoc", "play_stuffed_def", "play_stuffed", "third_down_distance_def", "third_down_distance"].includes(metric)) || (category == "offensive" && ["havoc_off", "havoc", "play_stuffed_off", "play_stuffed", "third_down_distance_off", "third_down_distance"].includes(metric))
}

export function generateCategoryForMetric(metric: string): string {
    return (metric.includes("_margin") || metric.startsWith("net_")) ? "Differential" : ((metric.includes("_off") || metric.includes("off_")) ? "Offensive" : "Defensive");
}

export function modifyMetricForCategory(category: string, metric: string) {
    // an NFL-only category (tendencies / fourth-downs / luck) shares no column
    // with the cfb grid: a metric it does not carry sorts by its first column
    // (the leaderboard showed N/A ranks when the default net_adj_epa carried over)
    const own = SDV_TEAM_METRIC_CATEGORIES[category];
    if (own && !["offensive", "defensive", "differential"].includes(category)) {
        return metric in own ? metric : Object.keys(own)[0];
    }
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

/** "1st", "22nd", "94th" -- for a percentile, which `formatRank` deliberately does not suffix. */
export function ordinal(n: number): string {
    const rem100 = Math.abs(n) % 100;
    const rem10 = rem100 % 10;
    const suffix = rem100 >= 11 && rem100 <= 13 ? "th"
        : rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th";
    return `${n}${suffix}`;
}

export function produceTeamLogoLink(team?: { team_id: string | number, school: string, season?: string | number } | null, headerType: string = "h4", showNickname: boolean = false, imgSize: string = "35px", league: League = 'cfb'): string {
    if (!team) {
        return `<${headerType} class="d-inline"><a href="${leaguePath(league, "/teams")}"><img class="img-fluid" width="${imgSize}" src="/assets/img/favicon.svg" alt="unknown team"/></a> Unknown Team</${headerType}>`
    }
    const teamLink = leaguePath(league, (team.season) ? `/year/${team.season}/team/${team.team_id}` : `/team/${team.team_id}`)
    return `<${headerType} class="d-inline"><a href="${teamLink}"><img class="img-fluid team-logo-${team.team_id}" width="${imgSize}" src="https://a.espncdn.com/i/teamlogos/${espnLogoLeague(league)}/500/${team.team_id}.png" alt="ESPN team id ${team.team_id}"/></a>${showNickname ? (" " + cleanField(team, "school")) : ""}</${headerType}>`
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

export function countRegexMatches(str: string, pattern: RegExp): number {
    if (!str) {
        return 0;
    }
    return (str.match(pattern) || []).length
}