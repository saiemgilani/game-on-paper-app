/**
 * The Shot profile's pure steps (BB-G51): zone table rows as the panel's lines, and where the points come from.
 * Every rate, rank and percentile is the producer's (sdv-db's player_shot_zones / team_shot_zones, rule B6), except for a
 * pro who played for more than one team: his teams' counts are added up and the rates recomputed from them, unranked
 * (the producer ranks each team row, not the season). The scoring split: the zone makes are worth 2 or 3, and a player's
 * free throws are his season FTM from the season stats (a read). A team's free throws are still its season points less
 * the zone points.
 */
import { ZONE_KEYS, type SeasonFt, type ShotZoneRow, type TeamZoneReads, type ZoneKey } from '../resources/shotZones';
import { numberOrNull } from './misc';

export const ZONE_LABELS: Record<ZoneKey, string> = { rim: 'Rim', mid: 'Mid-range', corner_3: 'Corner 3', above_break_3: 'Above-the-break 3' };

export interface RateCell { value: number | null; rank: number | null; pct: number | null }
export interface ZoneLine { key: ZoneKey; label: string; fga: number; fgm: number; fgPct: RateCell; freq: RateCell; astPct: RateCell }
export interface ZoneSide { fga: number; fgm: number; unlocated: number; zones: ZoneLine[]; ranked: boolean }

export type PartKey = 'rim' | 'mid' | 'three' | 'ft';
export interface Composition { pts: number; parts: { key: PartKey; label: string; pts: number; share: number }[] }
/** A side and its scoring split; `why` says why the split is missing when it is. */
export interface SideView { title: string; side: ZoneSide; comp: Composition | null; why: string | null }

const n0 = (v: unknown) => numberOrNull(v) ?? 0;
const cell = (row: ShotZoneRow, m: string): RateCell => ({ value: numberOrNull(row[m]), rank: numberOrNull(row[`${m}_rank`]), pct: numberOrNull(row[`${m}_pct`]) });
const bare = (value: number | null): RateCell => ({ value, rank: null, pct: null });
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * One side of the panel: a single row as the producer ships it (`prefix` 'opp_' for a team's allowed side), or several
 * team rows of one player added up and recomputed, unranked. Null when there is no row.
 */
export function zoneSide(rows: readonly ShotZoneRow[], prefix = ''): ZoneSide | null {
    if (rows.length === 0) return null;
    const p = prefix;
    const sum = (c: string) => rows.reduce((a, r) => a + n0(r[`${p}${c}`]), 0);
    const fga = sum('fga');
    const unlocated = sum('unlocated_fga');
    const one = rows.length === 1 ? rows[0] : null;
    const zones = ZONE_KEYS.map((z): ZoneLine => {
        const zfga = sum(`${z}_fga`);
        const zfgm = sum(`${z}_fgm`);
        // `{z}_ast_pct_n` is the makes whose assist is known (every make for the pros, the pbp-linked ones in college)
        return {
            key: z, label: ZONE_LABELS[z], fga: zfga, fgm: zfgm,
            fgPct: one ? cell(one, `${p}${z}_fg_pct`) : bare(ratio(zfgm, zfga)),
            freq: one ? cell(one, `${p}${z}_freq`) : bare(ratio(zfga, fga - unlocated)),
            astPct: one ? cell(one, `${p}${z}_ast_pct`) : bare(ratio(sum(`${z}_ast`), sum(`${z}_ast_pct_n`))),
        };
    });
    const ranked = zones.some((l) => l.fgPct.rank != null || l.freq.rank != null || l.astPct.rank != null);
    return { fga, fgm: sum('fgm'), unlocated, zones, ranked };
}

const PARTS: [PartKey, string][] = [['rim', 'Rim'], ['mid', 'Mid-range'], ['three', '3PT'], ['ft', 'FT']];

/** The zone makes' points (2 × rim and mid, 3 × the threes); null when a make has no location (its value is unknown). */
function fgPoints(side: ZoneSide): Record<Exclude<PartKey, 'ft'>, number> | null {
    const m = Object.fromEntries(side.zones.map((l) => [l.key, l.fgm])) as Record<ZoneKey, number>;
    if (m.rim + m.mid + m.corner_3 + m.above_break_3 !== side.fgm) return null;
    return { rim: 2 * m.rim, mid: 2 * m.mid, three: 3 * (m.corner_3 + m.above_break_3) };
}

/**
 * Where the points come from: the zone makes' points and `ft` free-throw points; the total is their sum. Null when the
 * split cannot be trusted: no free throws given, fewer than none, a make with no location, or no points at all.
 */
export function composition(side: ZoneSide, ft: number | null): Composition | null {
    const fg = fgPoints(side);
    if (ft == null || ft < 0 || !fg) return null;
    const by: Record<PartKey, number> = { ...fg, ft };
    const pts = by.rim + by.mid + by.three + by.ft;
    if (!(pts > 0)) return null;
    return { pts, parts: PARTS.map(([key, label]) => ({ key, label, pts: by[key], share: by[key] / pts })) };
}

/**
 * College: his row among his team's. The table keys players by the stats.ncaa.org id and the page by ESPN's, so `ncaaId`
 * (his season's id from ncaa_player_crosswalk, BB-D37) picks it. No matched pair (`ncaaId` null) is no row, and so is a
 * pair with no zone row: never a name match.
 */
export function collegePlayerRows(rows: readonly ShotZoneRow[], ncaaId: string | null): ShotZoneRow[] {
    return ncaaId === null ? [] : rows.filter((r) => String(r.player_id) === ncaaId);
}

/**
 * The player panel: his side (null without a row) and the split, free throws his season FTM. The season stats' FGM must
 * be the zone table's: a different count is a different scope (games missing, a career line), so its FTM is not his.
 */
export function playerView(rows: readonly ShotZoneRow[], ft: SeasonFt | null): SideView | null {
    const side = zoneSide(rows);
    if (!side) return null;
    if (!ft) return { title: '', side, comp: null, why: 'The season stats carry no free throws.' };
    if (ft.fgm !== side.fgm) {
        return { title: '', side, comp: null, why: `The zone table counts ${side.fgm} makes to the season stats’ ${ft.fgm}, so the points cannot be split.` };
    }
    const comp = composition(side, ft.ftm);
    return { title: '', side, comp, why: comp ? null : 'The points cannot be split: a make has no location.' };
}

/**
 * The team panel: offense and allowed, each split against the season rates' points when the two count the same games;
 * free throws are those points less the zone points. ponytail: a remainder; read the teams' FTM once all four leagues carry it.
 */
export function teamViews(reads: TeamZoneReads): SideView[] {
    const row = reads.zones;
    if (!row) return [];
    const all = reads.rates.find((r) => r.split === 'all') ?? null;
    const games = numberOrNull(all?.games);
    const same = all != null && games === numberOrNull(row.games);
    const why = !all ? 'The season’s box points are not built yet.' : same ? null
        : `The shot charts cover ${numberOrNull(row.games) ?? 0} of the ${games ?? 0} games, so the points cannot be split.`;
    const view = (title: string, prefix: string, pts: number | null): SideView | null => {
        const side = zoneSide([row], prefix);
        if (!side || side.fga === 0) return null;
        const fg = fgPoints(side);
        const comp = same && fg && pts != null ? composition(side, pts - fg.rim - fg.mid - fg.three) : null;
        return { title, side, comp, why: why ?? (comp ? null : 'The points cannot be split: a make has no location.') };
    };
    return [view('Offense', '', numberOrNull(all?.pts)), view('Allowed', 'opp_', numberOrNull(all?.opp_pts))].filter((v): v is SideView => v != null);
}
