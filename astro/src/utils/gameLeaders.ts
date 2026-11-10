/**
 * BB-G35, behind 'bball-game-leaders': the game page's Leaders panel, all arithmetic. Three parts:
 *
 * - `leaderRows`: each side's leader in each box category, from the player box the page already has. The scoreboard
 *   cards' `gameLeaders()` (nba/scoreboard.ts) reads ESPN's own `leaders` blocks, which carry PTS/REB/AST only and are
 *   not in the game payload, so this reads the box and keeps that card's "value name" reading.
 * - `overUnder`: the players (8+ minutes) furthest over and under their season scoring average.
 * - `assistWeb`: who assisted whom (the play-by-play's second athlete on a made field goal) and each side's points by
 *   zone, assisted or not.
 */
import type { NbaPlay, NbaPlayerRow, NbaSide } from '../resources/nbaGame';

/** A leader cell: the value and every player who reached it (a tie lists them all). */
export interface Leader { value: number; players: NbaPlayerRow[] }
export interface LeaderCategory { key: string; label: string; title: string; digits?: number; pct?: boolean }

/** TS% needs this many true-shooting attempts (FGA + 0.44 FTA) to lead. */
export const TS_MIN_ATTEMPTS = 10;
/** The over/under list's floor, and how many players each side lists. */
export const MIN_MINUTES = 8;
export const OVER_UNDER_N = 3;

export const CATEGORIES: LeaderCategory[] = [
    { key: 'pts', label: 'PTS', title: 'Points' },
    { key: 'reb', label: 'REB', title: 'Total rebounds' },
    { key: 'ast', label: 'AST', title: 'Assists' },
    { key: 'stl', label: 'STL', title: 'Steals' },
    { key: 'blk', label: 'BLK', title: 'Blocks' },
    { key: 'fgm', label: 'FGM', title: 'Field goals made' },
    { key: 'fg3m', label: '3PM', title: 'Three-point field goals made' },
    { key: 'fta', label: 'FTA', title: 'Free throws attempted' },
    { key: 'pm', label: '+/-', title: 'Score margin with the player on the court' },
    { key: 'tov', label: 'TOV', title: 'Turnovers (the most)' },
    { key: 'ts', label: 'TS%', title: `Points per two true-shooting attempts (FGA + 0.44 FTA), with ${TS_MIN_ATTEMPTS} or more attempts`, pct: true },
];

/** "7-15" -> [7, 15]; a dash (not recorded) is null. */
export function madeAttempted(s: string): [number, number] | null {
    const m = /^(\d+)-(\d+)$/.exec(s);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

const tsa = (p: NbaPlayerRow): number | null => {
    const fg = madeAttempted(p.fg), ft = madeAttempted(p.ft);
    return fg && ft ? fg[1] + 0.44 * ft[1] : null;
};

/** The category's value for one player; null when the box does not have it (college has no plus-minus). */
export function statOf(key: string, p: NbaPlayerRow): number | null {
    switch (key) {
        case 'pts': return p.points;
        case 'reb': return p.rebounds;
        case 'ast': return p.assists;
        case 'stl': return p.steals;
        case 'blk': return p.blocks;
        case 'tov': return p.turnovers;
        case 'fgm': return madeAttempted(p.fg)?.[0] ?? null;
        case 'fg3m': return madeAttempted(p.fg3)?.[0] ?? null;
        case 'fta': return madeAttempted(p.ft)?.[1] ?? null;
        case 'pm': { const v = p.plus_minus == null || p.plus_minus === '' ? NaN : Number(p.plus_minus); return Number.isFinite(v) ? v : null; }
        case 'ts': { const a = tsa(p); return a != null && a >= TS_MIN_ATTEMPTS && p.points != null ? p.points / (2 * a) : null; }
        default: return null;
    }
}

/** One side's leader in a category: the max over players who played; none when nobody has it, or a count's max is 0. */
export function leaderOf(side: NbaSide, key: string): Leader | null {
    const played = side.players.filter((p) => !p.did_not_play);
    const vals = played.map((p) => ({ p, v: statOf(key, p) })).filter((x): x is { p: NbaPlayerRow; v: number } => x.v != null);
    if (vals.length === 0) return null;
    const top = Math.max(...vals.map((x) => x.v));
    // plus-minus and TS% can lead at 0 or below; a count of 0 is nobody leading
    if (top <= 0 && key !== 'pm' && key !== 'ts') return null;
    return { value: top, players: vals.filter((x) => x.v === top).map((x) => x.p) };
}

/** The category rows with at least one side's leader (college's plus-minus row drops out). */
export function leaderRows(home: NbaSide, away: NbaSide): { cat: LeaderCategory; home: Leader | null; away: Leader | null }[] {
    return CATEGORIES.map((cat) => ({ cat, home: leaderOf(home, cat.key), away: leaderOf(away, cat.key) })).filter((r) => r.home || r.away);
}

/** A player's season per-game averages (the Data API's player_season_stats, ESPN-keyed). */
export interface SeasonAverage { athleteId: number; gp: number; pts: number | null; reb: number | null; ast: number | null }
export interface OverUnderRow { player: NbaPlayerRow; avg: SeasonAverage; delta: number }

/**
 * The side's players with 8+ minutes and a season average, ranked by points against that average: the `n` furthest over
 * and the `n` furthest under. A player with no average (no row, or a single game: this one) is left out.
 */
export function overUnder(side: NbaSide, averages: readonly SeasonAverage[], n = OVER_UNDER_N): { over: OverUnderRow[]; under: OverUnderRow[] } {
    const byId = new Map(averages.map((a) => [a.athleteId, a]));
    const rows = side.players
        .filter((p) => !p.did_not_play && (p.minutes ?? 0) >= MIN_MINUTES && p.points != null)
        .flatMap((p) => { const a = byId.get(p.athlete_id); return a && a.gp > 1 && a.pts != null ? [{ player: p, avg: a, delta: p.points! - a.pts }] : []; });
    const tie = (a: OverUnderRow, b: OverUnderRow) => a.player.athlete_id - b.player.athlete_id;
    return {
        over: rows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta || tie(a, b)).slice(0, n),
        under: rows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta || tie(a, b)).slice(0, n),
    };
}

export type Zone = 'rim' | 'two' | 'three' | 'ft';
export const ZONES: { key: Zone; label: string; title: string }[] = [
    { key: 'rim', label: 'At the rim', title: 'Layups, dunks, tips and putbacks' },
    { key: 'two', label: 'Other 2s', title: 'Every other two: jumpers, hooks, floaters' },
    { key: 'three', label: '3-pointers', title: 'Three-point field goals' },
    { key: 'ft', label: 'Free throws', title: 'Free throws (never assisted)' },
];
const RIM = /lay ?up|dunk|tip|alley|putback|put back|finger ?roll/i;

/** A made shot's zone by its type (both feeds' type texts; coordinates are not always located in college). */
export function zoneOf(p: NbaPlay): Zone {
    if (p.scoreValue === 1) return 'ft';
    if (p.scoreValue === 3) return 'three';
    return RIM.test(p.typeText ?? p.text) ? 'rim' : 'two';
}

export interface AssistPair { passer: number; scorer: number; ast: number; pts: number }
export interface AssistWeb {
    /** false when no made field goal in the game carries a second athlete (the feed links no assists): no pairs and no split */
    linked: boolean;
    pairs: AssistPair[];
    /** the side's made field goals that carry an assister, against its box assists */
    assisted: number;
    boxAssists: number | null;
    zones: Record<Zone, { assisted: number; unassisted: number }>;
}

/** One side's assist web from the play-by-play: made shots by its team id, an assist being a second athlete who is not the shooter. */
export function assistWeb(plays: readonly NbaPlay[], side: NbaSide): AssistWeb {
    const teamId = Number(side.team.id);
    // a block or a steal also fills the second athlete: only a made field goal's says the feed links assists
    const linked = plays.some((p) => p.scoringPlay && p.scoreValue >= 2 && p.athleteId2 != null);
    const zones = Object.fromEntries(ZONES.map((z) => [z.key, { assisted: 0, unassisted: 0 }])) as AssistWeb['zones'];
    const pairs = new Map<string, AssistPair>();
    let assisted = 0;
    for (const p of plays) {
        if (p.teamId !== teamId || !p.scoringPlay || p.scoreValue < 1 || p.scoreValue > 3) continue;
        const zone = zoneOf(p);
        const by = zone !== 'ft' && linked && p.athleteId2 != null && p.athleteId2 !== p.athleteId ? p.athleteId2 : null;
        zones[zone][by != null ? 'assisted' : 'unassisted'] += p.scoreValue;
        if (by == null || p.athleteId == null) continue;
        assisted++;
        const k = `${by}:${p.athleteId}`;
        const pair = pairs.get(k) ?? { passer: by, scorer: p.athleteId, ast: 0, pts: 0 };
        pair.ast++;
        pair.pts += p.scoreValue;
        pairs.set(k, pair);
    }
    return {
        linked,
        pairs: [...pairs.values()].sort((a, b) => b.ast - a.ast || b.pts - a.pts || a.passer - b.passer || a.scorer - b.scorer),
        assisted,
        boxAssists: side.box?.assists ?? null,
        zones,
    };
}
