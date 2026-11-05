/**
 * The Lineups tab's pure steps (BB-G3): the two URL controls (?unit=, ?basis=, whitelisted) and each unit's player
 * names. Nothing here aggregates: every number is the producer's row (rule B6).
 */
import { UNIT_SIZES, type LineupRow, type NcaaNameRow, type UnitSize } from '../resources/lineups';
import type { SeasonPlayerRow } from '../resources/nbaShots';
import { dotLabels } from '../nba/scatterMetrics';

export const BASES = ['per100', 'totals'] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABEL: Record<Basis, string> = { per100: 'Per 100 possessions', totals: 'Totals' };

export const DEFAULT_UNIT: UnitSize = 5;
export const DEFAULT_BASIS: Basis = 'per100';

/** ?unit=: 5, 3 or 2; anything else is the 5-man default. */
export function parseUnit(v: string | null): UnitSize {
    return UNIT_SIZES.find((s) => String(s) === v) ?? DEFAULT_UNIT;
}

/** ?basis=: per100 or totals; anything else is the per-100 default. */
export function parseBasis(v: string | null): Basis {
    return BASES.find((b) => b === v) ?? DEFAULT_BASIS;
}

export interface LineupsTab {
    unit: UnitSize;
    basis: Basis;
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

export interface UnitLabel {
    /** surnames, joined (first initial added where two of the team's listed players share one) */
    short: string;
    /** the full names */
    full: string;
}

/** Each unit's players, named; an id with no name reads as `#<id>`. */
export function unitLabels(units: Pick<LineupRow, 'player_1' | 'player_2' | 'player_3' | 'player_4' | 'player_5'>[], names: Map<string, string>): UnitLabel[] {
    const ids = units.map((u) => [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].filter((p) => p != null).map(String));
    const full = (id: string) => names.get(id) ?? `#${id}`;
    const short = dotLabels([...new Set(ids.flat().map(full))]);
    return ids.map((unit) => ({ short: unit.map((id) => short.get(full(id))!).join(' · '), full: unit.map(full).join(', ') }));
}
