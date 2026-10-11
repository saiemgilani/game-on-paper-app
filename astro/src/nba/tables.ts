// src/nba/tables.ts
// The roster-level pages' rows, rebuilt from shot_season_players rows instead of a season's
// shots: blazing-the-nets lib/pageData.ts playerRows/rosterRows/teamLines and
// lib/data/teams.ts teamsFromShots, with rim and mid-range FG% read from the derived
// ra_*/mid_* counts (sdv-db computes them with the same zone_sql the hex tables use).
import { playerSeasonsFromRows } from './adapters';
import { lineOf, type ShootingLine } from './data/aggregate';
import type { PlayerSeason } from './data/players';
import { teamById, teamName, type Team } from './data/teams';
import { fmtDec, fmtInt, fmtPct } from './format';
import { sortRows, type SortDir } from './table';
import type { SeasonPlayerRow } from '../resources/nbaShots';

export type Mode = 'pergame' | 'totals';

/** A table row for a player (blazing's PlayerRow). */
export interface PlayerRow {
    person_id: number;
    name: string;
    team: string;
    attempts: number;
    fgPct: number | null;
    efgPct: number | null;
    fg3Pct: number | null;
    gp: number | null;
    min: number | null;
    /** The row is one team's shots but gp/min are his season totals across teams. */
    acrossTeams: boolean;
}

export function playerRows(players: PlayerSeason[]): PlayerRow[] {
    return players.map((p) => {
        const line = lineOf(p);
        return {
            person_id: p.person_id, name: p.player_name, team: p.team_tricode, attempts: p.attempts,
            fgPct: line.fgPct, efgPct: line.efgPct, fg3Pct: line.fg3Pct,
            gp: p.stats?.gp ?? null, min: p.stats?.min ?? null, acrossTeams: p.statsScope === 'all-teams',
        };
    });
}

/** The roster table's row (blazing's RosterRow). */
export interface RosterRow {
    person_id: number;
    name: string;
    headshot: string | null;
    acrossTeams: boolean;
    gp: number | null;
    minPg: number | null;
    minTotal: number | null;
    fga: number;
    fgaPg: number | null;
    fgPct: number | null;
    efgPct: number | null;
    fg3Pct: number | null;
    tsPct: number | null;
    rimPct: number | null;
    midPct: number | null;
    fg3Rate: number | null;
    usgPct: number | null;
    pie: number | null;
}

const pct = (makes: number, attempts: number) => (attempts ? makes / attempts : null);

/** One team's roster rows, most attempts first; stats are null without a season-stats row. */
export function rosterRows(rows: SeasonPlayerRow[], teamId: number): RosterRow[] {
    const byPerson = new Map(rows.filter((r) => r.team_id === teamId).map((r) => [r.person_id, r]));
    return playerSeasonsFromRows(rows, teamId).map((p) => {
        const r = byPerson.get(p.person_id)!;
        const line = lineOf(p);
        const st = p.stats;
        return {
            person_id: p.person_id, name: p.player_name, headshot: r.headshot_href ?? null, acrossTeams: p.statsScope === 'all-teams',
            gp: st?.gp ?? null, minPg: st?.min ?? null, minTotal: st?.min_total ?? null,
            fga: p.attempts, fgaPg: st?.fga_pg ?? null,
            fgPct: line.fgPct, efgPct: line.efgPct, fg3Pct: line.fg3Pct, tsPct: st?.ts_pct ?? null,
            rimPct: pct(r.ra_makes, r.ra_attempts), midPct: pct(r.mid_makes, r.mid_attempts),
            fg3Rate: p.attempts ? p.fg3a / p.attempts : null,
            usgPct: st?.usg_pct ?? null, pie: st?.pie ?? null,
        };
    });
}

/** The season's teams as the rows name them, with that season's tricode and name, sorted by tricode (blazing's teamsFromShots). */
export function teamsFromSeasonRows(rows: SeasonPlayerRow[], season: number): Team[] {
    const seen = new Map<number, string>();
    for (const r of rows) if (!seen.has(r.team_id)) seen.set(r.team_id, r.team_tricode);
    return [...seen]
        .map(([team_id, tricode]) => {
            const known = teamById(team_id);
            return known ? { ...known, tricode, name: teamName(team_id, season) ?? known.name } : { team_id, tricode, name: tricode, color: '#888888', espn_id: 0 };
        })
        .sort((a, b) => a.tricode.localeCompare(b.tricode));
}

/** Each team's shooting line for the season, keyed by team_id (every row on the team, traded players' included). */
export function teamLinesFromRows(rows: SeasonPlayerRow[]): Map<number, ShootingLine> {
    const sums = new Map<number, { attempts: number; makes: number; fg3a: number; fg3m: number }>();
    for (const r of rows) {
        const s = sums.get(r.team_id) ?? { attempts: 0, makes: 0, fg3a: 0, fg3m: 0 };
        s.attempts += r.attempts; s.makes += r.makes; s.fg3a += r.fg3a; s.fg3m += r.fg3m;
        sums.set(r.team_id, s);
    }
    return new Map([...sums].map(([id, s]) => [id, lineOf(s)]));
}

// --- the two tables' columns and the query whitelists -------------------------------
export type PlayerSortKey = 'attempts' | 'fgPct' | 'efgPct' | 'fg3Pct' | 'gp' | 'min';
export type RosterSortKey = 'gp' | 'min' | 'fga' | 'fgPct' | 'efgPct' | 'fg3Pct' | 'tsPct' | 'rimPct' | 'midPct' | 'fg3Rate' | 'usgPct' | 'pie';

const asPct = (v: number | null) => fmtPct(v);
const intOrDec = (v: number | null) => (v === null ? 'n/a' : Number.isInteger(v) ? fmtInt(v) : fmtDec(v));

/** `wide` columns are hidden below the sm breakpoint (blazing's PlayerTable), so a phone shows name, FGA and the percentages. */
export const PLAYER_COLUMNS: readonly { key: PlayerSortKey; label: string; value: (r: PlayerRow) => number | null; fmt: (v: number | null) => string; wide?: boolean }[] = [
    { key: 'attempts', label: 'FGA', value: (r) => r.attempts, fmt: fmtInt },
    { key: 'fgPct', label: 'FG%', value: (r) => r.fgPct, fmt: asPct },
    { key: 'efgPct', label: 'eFG%', value: (r) => r.efgPct, fmt: asPct },
    { key: 'fg3Pct', label: '3P%', value: (r) => r.fg3Pct, fmt: asPct },
    { key: 'gp', label: 'GP', value: (r) => r.gp, fmt: fmtInt, wide: true },
    { key: 'min', label: 'MIN', value: (r) => r.min, fmt: fmtDec, wide: true },
];

export const ROSTER_COLUMNS: readonly { key: RosterSortKey; group: 'Volume' | 'Shooting' | 'Usage'; label: (mode: Mode) => string; value: (r: RosterRow, mode: Mode) => number | null; fmt: (v: number | null) => string }[] = [
    { key: 'gp', group: 'Volume', label: () => 'GP', value: (r) => r.gp, fmt: fmtInt },
    { key: 'min', group: 'Volume', label: (m) => (m === 'pergame' ? 'MIN/g' : 'MIN'), value: (r, m) => (m === 'pergame' ? r.minPg : r.minTotal), fmt: (v) => (v === null ? 'n/a' : v > 99 ? fmtInt(v) : fmtDec(v)) },
    { key: 'fga', group: 'Volume', label: (m) => (m === 'pergame' ? 'FGA/g' : 'FGA'), value: (r, m) => (m === 'pergame' ? r.fgaPg : r.fga), fmt: intOrDec },
    { key: 'fgPct', group: 'Shooting', label: () => 'FG%', value: (r) => r.fgPct, fmt: asPct },
    { key: 'efgPct', group: 'Shooting', label: () => 'eFG%', value: (r) => r.efgPct, fmt: asPct },
    { key: 'fg3Pct', group: 'Shooting', label: () => '3P%', value: (r) => r.fg3Pct, fmt: asPct },
    { key: 'tsPct', group: 'Shooting', label: () => 'TS%', value: (r) => r.tsPct, fmt: asPct },
    { key: 'rimPct', group: 'Shooting', label: () => 'Rim FG%', value: (r) => r.rimPct, fmt: asPct },
    { key: 'midPct', group: 'Shooting', label: () => 'Mid FG%', value: (r) => r.midPct, fmt: asPct },
    { key: 'fg3Rate', group: 'Shooting', label: () => '3P rate', value: (r) => r.fg3Rate, fmt: asPct },
    { key: 'usgPct', group: 'Usage', label: () => 'USG%', value: (r) => r.usgPct, fmt: asPct },
    { key: 'pie', group: 'Usage', label: () => 'PIE', value: (r) => r.pie, fmt: asPct },
];
export const ROSTER_GROUPS = ['Volume', 'Shooting', 'Usage'] as const;

/** A `?sort=` value on the list, else the fallback: a crafted query can only name a real column. */
export function parseSort<K extends string>(keys: readonly K[], sort: string | null, fallback: K): K {
    return sort !== null && (keys as readonly string[]).includes(sort) ? (sort as K) : fallback;
}
export function parseDir(dir: string | null): SortDir {
    return dir === 'asc' ? 'asc' : 'desc';
}
export function parseMode(mode: string | null): Mode {
    return mode === 'pergame' ? 'pergame' : 'totals';
}

export function sortPlayerRows(rows: PlayerRow[], key: PlayerSortKey, dir: SortDir): PlayerRow[] {
    const column = PLAYER_COLUMNS.find((c) => c.key === key) ?? PLAYER_COLUMNS[0];
    return sortRows(rows, dir, (r) => column.value(r));
}
export function sortRosterRows(rows: RosterRow[], key: RosterSortKey, dir: SortDir, mode: Mode): RosterRow[] {
    const column = ROSTER_COLUMNS.find((c) => c.key === key) ?? ROSTER_COLUMNS[2];
    return sortRows(rows, dir, (r) => column.value(r, mode));
}
