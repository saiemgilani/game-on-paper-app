/**
 * The Shot profile's pure steps (BB-G51): zone table rows as the panel's lines, and where the points come from.
 * Every rate, rank and percentile is the producer's (sdv-db's player_shot_zones / team_shot_zones, rule B6), except for a
 * pro who played for more than one team: his teams' counts are added up and the rates recomputed from them, unranked
 * (the producer ranks each team row, not the season). The scoring split divides the box points: the zone makes are worth
 * 2 or 3, and free throws are what is left.
 */
import type { PlayerStats } from '../nba/data/players';
import { ZONE_KEYS, type ShotZoneRow, type TeamZoneReads, type ZoneKey } from '../resources/shotZones';
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

/**
 * Where the points come from: 2 × the rim and mid makes, 3 × the three makes, and the rest of `pts` as free throws. Null
 * when the split cannot be trusted: no points, a make with no location (its value is unknown), or FG points above `pts`.
 */
export function composition(side: ZoneSide, pts: number | null): Composition | null {
    if (pts == null || !(pts > 0)) return null;
    const m = Object.fromEntries(side.zones.map((l) => [l.key, l.fgm])) as Record<ZoneKey, number>;
    if (m.rim + m.mid + m.corner_3 + m.above_break_3 !== side.fgm) return null;
    const by: Record<PartKey, number> = { rim: 2 * m.rim, mid: 2 * m.mid, three: 3 * (m.corner_3 + m.above_break_3), ft: 0 };
    by.ft = pts - by.rim - by.mid - by.three;
    if (by.ft < 0) return null;
    return { pts, parts: PARTS.map(([key, label]) => ({ key, label, pts: by[key], share: by[key] / pts })) };
}

/** Lower case, accents and punctuation off, suffixes dropped, "Last, First" turned round: the key a college name match uses. */
export function nameKey(name: string): string {
    const turned = name.includes(',') ? name.split(',').map((s) => s.trim()).reverse().join(' ') : name;
    return turned.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, '').split(/\s+/)
        .filter((t) => t && !['jr', 'sr', 'ii', 'iii', 'iv', 'v'].includes(t)).join(' ');
}

/**
 * College: his row among his team's, by name, since the table keys players by the stats.ncaa.org id and the page by ESPN's.
 * Only a unique match counts; none or two is no row.
 * ponytail: a name match inside one team-season; key on BB-D37's NCAA↔ESPN player crosswalk once it ships.
 */
export function collegePlayerRows(rows: readonly ShotZoneRow[], name: string): ShotZoneRow[] {
    const key = nameKey(name);
    const hit = rows.filter((r) => r.player_name != null && nameKey(String(r.player_name)) === key);
    return hit.length === 1 ? hit : [];
}

/** The player's box points this season and the FGA they go with: points per game × games, as the season stats carry them. */
export function boxPoints(stats: PlayerStats | null): { pts: number; fga: number } | null {
    if (!stats || stats.pts_pg == null || stats.fga == null || !stats.gp) return null;
    return { pts: Math.round(stats.pts_pg * stats.gp), fga: stats.fga };
}

/**
 * The share of the box's FGA the zone table may miss before the split is dropped: its free throws are what is left over,
 * so every missing make lands there. ponytail: 1% (~2 points a missing FGA); exact once the box ships FTM to this page.
 */
export const FGA_TOLERANCE = 0.01;

/** The player panel: the player's side (null without a row) and the split against his box points. */
export function playerView(rows: readonly ShotZoneRow[], stats: PlayerStats | null): SideView | null {
    const side = zoneSide(rows);
    if (!side) return null;
    const box = boxPoints(stats);
    if (!box) return { title: '', side, comp: null, why: 'The season stats carry no points.' };
    if (Math.abs(box.fga - side.fga) > Math.max(1, FGA_TOLERANCE * box.fga)) {
        return { title: '', side, comp: null, why: `The zone table counts ${side.fga} FGA to the box score’s ${box.fga}, so the points cannot be split.` };
    }
    const comp = composition(side, box.pts);
    return { title: '', side, comp, why: comp ? null : 'The points cannot be split: a make has no location.' };
}

/** The team panel: offense and allowed, each split against the season rates' points when the two count the same games. */
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
        const comp = same ? composition(side, pts) : null;
        return { title, side, comp, why: why ?? (comp ? null : 'The points cannot be split: a make has no location.') };
    };
    return [view('Offense', '', numberOrNull(all?.pts)), view('Allowed', 'opp_', numberOrNull(all?.opp_pts))].filter((v): v is SideView => v != null);
}
