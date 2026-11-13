/**
 * BB-G52: the team page's season shot chart filtered by who is on the floor. The rows are sdv-db's `shot_lineups` (one per
 * field-goal attempt with the ten players on the floor), read once per team, season and side; the ON/OFF filter runs here,
 * on the server, and only the chart's squares and zones reach the browser. Pure, so the tests drive it on real rows.
 */
import type { Court } from '../basketball/config';
import type { BasketballLeague } from '../utils/league';
import type { HexShotChartData } from './charts/hexShotChart';
import { buildDashboard, type LeagueContext } from './dashboard';
import { shootingLine, type ShootingLine } from './data/aggregate';
import type { PlaceholderLocation } from './data/placeholder';
import type { ShotLite } from './data/shots';

/** First season `shot_lineups` holds: the pros' possessions from 1996-97; college has a shot-chart clock only from 2026-27. */
export const LINEUP_SHOTS_FIRST_SEASON: Record<BasketballLeague, number> = { nba: 1997, wnba: 1997, mbb: 2027, wbb: 2027 };

export const MAX_LINEUP_FILTERS = 5;

/** offense: the team's own shots (its five are `off_player_*`); defense: its opponents' shots (its five are `def_player_*`). */
export type LineupSide = 'offense' | 'defense';
/** Whose five a filter reads: the team's, or (defense only) the shooting opponent's, the row's `off_player_*`. */
export type LineupUnit = 'team' | 'opponent';

type Five = 'off_player_1' | 'off_player_2' | 'off_player_3' | 'off_player_4' | 'off_player_5' | 'def_player_1' | 'def_player_2' | 'def_player_3' | 'def_player_4' | 'def_player_5';
/** A `shot_lineups` row as the read selects it; player ids are bigint for the pros, stats.ncaa.org text for college. */
export type LineupShotRow = { game_id: string; x_legacy: number; y_legacy: number; shot_value: number; made: boolean } & Record<Five, number | string | null>;

export interface LineupFilter { id: string; on: boolean }
export interface LineupOption { id: string; name: string; shots: number }

export interface LineupShots {
    side: LineupSide;
    filters: LineupFilter[];
    /** the team's players on the floor for any of the side's shots, most shots first */
    options: LineupOption[];
    /** defense only (empty on offense): filters over the shooting opponents' five, and the opponents' players, most shots first */
    oppFilters: LineupFilter[];
    oppOptions: LineupOption[];
    /** the matching shots' line; `hex` null when none match */
    line: ShootingLine;
    hex: HexShotChartData | null;
    /** the side's shots in the season, and how many a filter could not place (a filtered five not all known) */
    total: number;
    unknown: number;
    unlocated?: { count: number; total: number };
}

/** The view the team page renders: the chart, a season the table does not cover, or a failed read. */
export type LineupShotsView = { status: 'ok'; data: LineupShots } | { status: 'unavailable'; side: LineupSide } | { status: 'error'; side: LineupSide };

export const parseSide = (v: string | null): LineupSide => (v === 'defense' ? 'defense' : 'offense');

/**
 * The team's five on a row (or with unit 'opponent', the other side's), as text ids (one id type across leagues and the
 * URL); null where a slot is unknown. On defense the opponent's five is the shooting five, `off_player_*`.
 */
export function teamFive(row: LineupShotRow, side: LineupSide, unit: LineupUnit = 'team'): (string | null)[] {
    const p = (side === 'offense') === (unit === 'team') ? 'off_player_' : 'def_player_';
    return [1, 2, 3, 4, 5].map((i) => {
        const v = row[`${p}${i}` as Five];
        return v === null || v === undefined || v === '' ? null : String(v);
    });
}

/**
 * `?p=<id>&s=on|off`, repeated in pairs (the form's five rows): up to five players the options name, each once (its first
 * row wins), an unknown id or an empty row dropped. A missing or unknown `s` is ON.
 */
export function parseFilters(players: string[], states: string[], known: ReadonlySet<string>): LineupFilter[] {
    const out: LineupFilter[] = [];
    players.forEach((raw, i) => {
        const id = raw.trim();
        if (!known.has(id) || out.length >= MAX_LINEUP_FILTERS || out.some((f) => f.id === id)) return;
        out.push({ id, on: states[i] !== 'off' });
    });
    return out;
}

/** Does the shot pass every filter? With none, every shot does; with any, only shots whose five are all known. */
export function matches(five: (string | null)[], filters: readonly LineupFilter[]): boolean {
    if (!filters.length) return true;
    if (five.includes(null)) return false;
    return filters.every((f) => five.includes(f.id) === f.on);
}

/** The unit's players on the floor for the side's shots, most shots first, then by name; a nameless id reads as `#id`. */
export function lineupOptions(rows: readonly LineupShotRow[], side: LineupSide, names: ReadonlyMap<string, string>, unit: LineupUnit = 'team'): LineupOption[] {
    const counts = new Map<string, number>();
    for (const r of rows) for (const id of teamFive(r, side, unit)) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts]
        .map(([id, shots]) => ({ id, name: names.get(id) ?? `#${id}`, shots }))
        .sort((a, b) => b.shots - a.shots || a.name.localeCompare(b.name));
}

/** A row as the charts' shot: shot_distance is rounded feet from the hoop, as the shots tables carry it. */
export const toShotLite = (r: LineupShotRow): ShotLite => ({
    game_id: String(r.game_id), x_legacy: Number(r.x_legacy), y_legacy: Number(r.y_legacy),
    shot_distance: Math.round(Math.hypot(Number(r.x_legacy), Number(r.y_legacy)) / 10),
    shot_value: Number(r.shot_value), shot_result: r.made ? 'Made' : 'Missed',
});

/** The filtered chart against the league: the team page's own square and zone builder over the matching shots. */
export function lineupShots(
    rows: readonly LineupShotRow[], side: LineupSide, filters: LineupFilter[], options: LineupOption[],
    league: LeagueContext, court: Court, placeholder: PlaceholderLocation | null,
    opp: { filters: LineupFilter[]; options: LineupOption[] } = { filters: [], options: [] },
): LineupShots {
    const shots: ShotLite[] = [];
    let unknown = 0;
    for (const r of rows) {
        const five = teamFive(r, side);
        const oppFive = opp.filters.length ? teamFive(r, side, 'opponent') : [];
        if ((filters.length && five.includes(null)) || oppFive.includes(null)) unknown += 1;
        else if (matches(five, filters) && matches(oppFive, opp.filters)) shots.push(toShotLite(r));
    }
    const d = shots.length ? buildDashboard(shots, league, court, placeholder) : null;
    return {
        side, filters, options, oppFilters: opp.filters, oppOptions: opp.options, line: shootingLine(shots), hex: d?.hex ?? null, total: rows.length, unknown,
        ...(d?.unlocated ? { unlocated: d.unlocated } : {}),
    };
}
