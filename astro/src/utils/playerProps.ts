/**
 * The game page's player props panel (BB-G44, behind 'bball-props'): each player's closing line per stat with the
 * implied over probability (sdv-db's `{nba,wnba,mbb}.player_props`, BB-D33: medians across books, no vig), beside the
 * box score's number. After the final, which side of the line it landed on; live, the count so far against the line.
 * Nothing is modelled: the line and probability are the books', the count is the box score's.
 */
import type { NbaGame, NbaPlayerRow } from '../resources/nbaGame';
import type { PropRow, PropStat } from '../resources/playerProps';

/** Column order and header text; a stat no row carries (college has no threes or P+R+A lines) is left out. */
export const PROP_STATS: { stat: PropStat; label: string; title: string }[] = [
    { stat: 'points', label: 'PTS', title: 'Points' },
    { stat: 'rebounds', label: 'REB', title: 'Rebounds' },
    { stat: 'assists', label: 'AST', title: 'Assists' },
    { stat: 'threes', label: '3PM', title: 'Three-pointers made' },
    { stat: 'pra', label: 'PRA', title: 'Points + rebounds + assists' },
];

export type PropResult = 'over' | 'under' | 'push';
export interface PropCell {
    line: number
    /** the books' no-vig over probability; null when a side had no price */
    overProb: number | null
    /** the box score's count (so far, when live); null when the player has no box row or did not play */
    actual: number | null
    /** final: where it landed; live: 'over' once the line is cleared (it cannot come back), else null */
    result: PropResult | null
}
export interface PropPlayer { athleteId: number; name: string; cells: Partial<Record<PropStat, PropCell>> }
export interface PropsView { final: boolean; stats: PropStat[]; away: PropPlayer[]; home: PropPlayer[] }

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The box score's count for a stat; threes from the "made-attempted" pair, P+R+A only when all three are there. */
export function actualStat(p: NbaPlayerRow, stat: PropStat): number | null {
    if (p.did_not_play) return null;
    if (stat === 'threes') return num(/^(\d+)-\d+$/.exec(p.fg3 ?? '')?.[1]);
    if (stat === 'pra') return p.points == null || p.rebounds == null || p.assists == null ? null : p.points + p.rebounds + p.assists;
    return p[stat];
}

export function propResult(actual: number | null, line: number, final: boolean): PropResult | null {
    if (actual == null) return null;
    if (actual > line) return 'over';
    if (!final) return null;
    return actual < line ? 'under' : 'push';
}

/**
 * The panel's rows, or null when no line matches a player on either side (an unmapped game: no panel). A row the books'
 * name could not be matched to an ESPN athlete (athlete_id null) has no side and no count, so it is left out. Live, a
 * player with no box row yet keeps the lines with no count.
 */
export function propsView(rows: PropRow[], game: NbaGame): PropsView | null {
    const final = game.status.completed;
    const sideOf = (r: PropRow): 'home' | 'away' | null => {
        for (const s of ['home', 'away'] as const) {
            if (num(r.team_id) === num(game[s].team.id) || game[s].players.some((p) => p.athlete_id === num(r.athlete_id))) return s;
        }
        return null;
    };
    const players = { home: new Map<number, PropPlayer>(), away: new Map<number, PropPlayer>() };
    const seen = new Set<PropStat>();
    for (const r of rows) {
        const id = num(r.athlete_id), line = num(r.line), s = sideOf(r);
        const def = PROP_STATS.find((d) => d.stat === r.stat);
        if (id == null || line == null || !s || !def) continue;
        const box = game[s].players.find((p) => p.athlete_id === id);
        // a final's line for a player who never checked in (out, or a DNP row) is void at the books: left out
        if (final && (!box || box.did_not_play)) continue;
        const player = players[s].get(id) ?? { athleteId: id, name: box?.name ?? r.player_name, cells: {} };
        const actual = box ? actualStat(box, def.stat) : null;
        player.cells[def.stat] = { line, overProb: num(r.over_prob), actual, result: propResult(actual, line, final) };
        players[s].set(id, player);
        seen.add(def.stat);
    }
    if (!seen.size) return null;
    // the books' biggest lines first: points, then the next stat for a player with no points line
    const order = (m: Map<number, PropPlayer>) => [...m.values()].sort((a, b) => {
        for (const { stat } of PROP_STATS) { const d = (b.cells[stat]?.line ?? -1) - (a.cells[stat]?.line ?? -1); if (d) return d; }
        return a.name.localeCompare(b.name);
    });
    return { final, stats: PROP_STATS.map((d) => d.stat).filter((s) => seen.has(s)), away: order(players.away), home: order(players.home) };
}
