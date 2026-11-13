/**
 * The Lineups tab's pure steps (BB-G3): the URL controls (?unit=, ?basis=, ?min=, ?lsort=, ?ldir=, whitelisted), the
 * column sort of the read's rows, each unit's player names and their player pages. Nothing here aggregates: every number
 * is the producer's row (rule B6).
 */
import { DEFAULT_GATE, GATES, RATED, UNIT_SIZES, ZONES, type Gate, type LineupRow, type NcaaNameRow, type NcaaPairRow, type UnitSize } from '../resources/lineups';
import type { SeasonPlayerRow } from '../resources/nbaShots';
import { dotLabels } from '../nba/scatterMetrics';
import type { SortDir } from '../nba/table';
import type { BasketballLeague } from './league';

export const BASES = ['per100', 'totals', 'zones'] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABEL: Record<Basis, string> = { per100: 'Per 100 possessions', totals: 'Totals', zones: 'Shot zones' };
/** The shot-zone columns are college's only (the pros' lineup_seasons has none). */
export const basesFor = (league: BasketballLeague): readonly Basis[] => (league === 'mbb' || league === 'wbb' ? BASES : ['per100', 'totals']);
export const GATE_LABEL: Record<Gate, string> = { '50': '50+ possessions', '100': '100+ possessions', '200': '200+ possessions', ranked: 'Ranked only' };

export const DEFAULT_UNIT: UnitSize = 5;
export const DEFAULT_BASIS: Basis = 'per100';

/** ?unit=: 5, 3 or 2; anything else is the 5-man default. */
export function parseUnit(v: string | null): UnitSize {
    return UNIT_SIZES.find((s) => String(s) === v) ?? DEFAULT_UNIT;
}

/** ?basis=: one of the league's bases; anything else is the per-100 default. */
export function parseBasis(v: string | null, league: BasketballLeague): Basis {
    return basesFor(league).find((b) => b === v) ?? DEFAULT_BASIS;
}

/** ?min=: 50, 100, 200 or ranked; anything else is the league's default gate. */
export function parseGate(v: string | null, league: BasketballLeague): Gate {
    return GATES.find((g) => g === v) ?? DEFAULT_GATE[league];
}

/** The sortable columns of each basis (Min and Poss always). */
const SORT_KEYS: Record<Basis, readonly string[]> = {
    per100: RATED,
    totals: ['opp_poss', 'pts', 'opp_pts', 'plus_minus'],
    zones: ZONES,
};
export const DEFAULT_SORT = 'poss';
export const sortKeysFor = (basis: Basis): readonly string[] => ['minutes', 'poss', ...SORT_KEYS[basis]];

/** ?lsort=: a column of the basis shown; anything else is possessions (the read's own order). */
export function parseLineupSort(v: string | null, basis: Basis): string {
    return v !== null && sortKeysFor(basis).includes(v) ? v : DEFAULT_SORT;
}

/** A sorted copy of the read's rows: missing values last, ties by possessions. */
export function sortUnits(units: LineupRow[], key: string, dir: SortDir): LineupRow[] {
    const val = (u: LineupRow) => (u as Record<string, unknown>)[key] as number | null | undefined;
    return [...units].sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        if (va == null || vb == null) return va == null && vb == null ? b.poss - a.poss : va == null ? 1 : -1;
        return (dir === 'desc' ? vb - va : va - vb) || b.poss - a.poss;
    });
}

export interface LineupsTab {
    unit: UnitSize;
    basis: Basis;
    gate: Gate;
    sort: string;
    dir: SortDir;
    /** null when a read failed (the tab says so) */
    units: LineupRow[] | null;
    /** one per unit */
    labels: UnitLabel[];
}

/** Player id -> name: the pros' from the page's season rows (stats ids), college's from ncaa_player_box (stats.ncaa.org ids). */
export function playerNames(seasonRows: Pick<SeasonPlayerRow, 'person_id' | 'player_name'>[], ncaa: NcaaNameRow[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of seasonRows) if (r.player_name) out.set(String(r.person_id), r.player_name);
    for (const r of ncaa) if (r.clean_name) out.set(String(r.player_id), r.clean_name);
    return out;
}

/**
 * Lineup player id -> his player page's id. A player page exists only for a player in the season's shot_season_players
 * (the page's own 404 check), so only those link. The pros' lineup ids are the page ids; college's stats.ncaa.org ids go
 * through the crosswalk pairs (BB-D37) to the ESPN athlete id, and a player with no pair stays unlinked.
 */
export function playerPages(seasonRows: Pick<SeasonPlayerRow, 'person_id'>[], pairs?: NcaaPairRow[]): Map<string, string> {
    const pages = new Set(seasonRows.map((r) => String(r.person_id)));
    const out = new Map<string, string>();
    if (!pairs) for (const id of pages) out.set(id, id);
    else for (const p of pairs) if (p.espn_athlete_id != null && pages.has(String(p.espn_athlete_id))) out.set(String(p.ncaa_player_id), String(p.espn_athlete_id));
    return out;
}

export interface UnitPlayer {
    /** the surname (first initial, or the first name, added where two of the team's listed players would read alike) */
    label: string;
    name: string;
    /** the player page's id, or null when he has none */
    page: string | null;
}

export interface UnitLabel {
    /** the labels, joined */
    short: string;
    /** the full names */
    full: string;
    players: UnitPlayer[];
}

/** Each unit's players, named and linked where a page exists; an id with no name reads as `#<id>`. */
export function unitLabels(units: Pick<LineupRow, 'player_1' | 'player_2' | 'player_3' | 'player_4' | 'player_5'>[], names: Map<string, string>, pages: Map<string, string> = new Map()): UnitLabel[] {
    const ids = units.map((u) => [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].filter((p) => p != null).map(String));
    const full = (id: string) => names.get(id) ?? `#${id}`;
    const short = dotLabels([...new Set(ids.flat().map(full))]);
    return ids.map((unit) => {
        const players = unit.map((id) => ({ label: short.get(full(id))!, name: full(id), page: names.has(id) ? pages.get(id) ?? null : null }));
        return { short: players.map((p) => p.label).join(' · '), full: players.map((p) => p.name).join(', '), players };
    });
}
