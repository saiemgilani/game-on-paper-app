/**
 * The basketball leaderboards' pure steps (BB-G8, behind 'bball-leaderboards-v2'): the URL controls, the column registry
 * and the one function that turns a row into the number a cell shows. Nothing here aggregates, converts or ranks (rule
 * B6): every value, `_rank` and `_pct` is the producer's column.
 *
 * Spec §4.3 lists three bugs a basis toggle must not have. Each is closed by construction here, and tested:
 * - an unknown basis never falls through: parseControls whitelists it against the bases the board ships and says so
 *   (`fallback`) when it picks the default instead;
 * - the sort uses the number shown: sortRows orders by shown(), the function the template prints;
 * - a percentile is the shown column's own: a cell reads `<col>_pct` of the column its basis resolved to, never another
 *   basis's, so a basis the producer ranks no percentile for shows none.
 * The producer ships one column per basis, so GOP never converts: a basis with no column for a metric is a dash.
 */
import type { BasketballLeague } from './league';
import { numberOrNull } from './misc';

export const BOARDS = ['impact', 'teams', 'lineups', 'value', 'poe'] as const;
export type Board = (typeof BOARDS)[number];
export const BOARD_LABEL: Record<Board, string> = { impact: 'Players: Impact', teams: 'Teams', lineups: 'Lineups', value: 'Players: WAR and VORP', poe: 'Players: Points over expected' };
/** BB-G27's boards, behind 'bball-war-boards': WAR / VORP (sdv-db player_war) and points over expected (shot_quality_season). */
export const WAR_BOARDS: readonly Board[] = ['value', 'poe'];
/** The boards a request offers: BB-G8's three, plus BB-G27's two with 'bball-war-boards' on. */
export const boardsFor = (war: boolean): Board[] => BOARDS.filter((b) => war || !WAR_BOARDS.includes(b));

export const BASES = ['pergame', 'per75', 'per100', 'totals'] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABEL: Record<Basis, string> = { pergame: 'Per game', per75: 'Per 75 possessions', per100: 'Per 100 possessions', totals: 'Totals' };

export const VIEWS = ['values', 'percentiles'] as const;
export type View = (typeof VIEWS)[number];

export const TEAM_GROUPS = ['ratings', 'factors', 'strength', 'flow'] as const;
export type TeamGroup = (typeof TEAM_GROUPS)[number];
export const TEAM_GROUP_LABEL: Record<TeamGroup, string> = { ratings: 'Ratings', factors: 'Four factors', strength: 'Team strength', flow: 'Game flow' };

export const UNIT_SIZES = [5, 3, 2] as const;
export type UnitSize = (typeof UNIT_SIZES)[number];

export type Fmt = 'int' | 'dec1' | 'dec2' | 'signed1' | 'signed2' | 'pct' | 'rate3' | 'secs' | 'ppts';

/** One column. `src` is the producer column: one name for a rate (every basis shows it), or one per basis for a count. */
export interface Col {
    key: string;
    label: string | Partial<Record<Basis, string>>;
    hover: string;
    /** the two-row header's group; consecutive columns with the same group share a cell */
    group?: string;
    src: string | Partial<Record<Basis, string>>;
    fmt: Fmt;
    /** lower is better (DRtg, turnovers): the values sort is ascending, so the best comes first either way */
    lowerBetter?: true;
    /** neither end is better (pace): never shaded */
    noShade?: true;
}

/** A board (or the teams board's column group): its columns, its default sort and the producer rank that marks a qualifier. */
export interface BoardSpec {
    cols: readonly Col[];
    defaultSort: string;
    defaultBasis: Basis;
    /** the producer `_rank` column whose presence marks a qualifier; null: the board's own gate (`gate`, else impact's) */
    qualifiedBy: string | null;
    /** BB-G27: the board's own gate when it is not impact's offensive possessions: a sample column and its per-league floor */
    gate?: { col: string; min: Record<BasketballLeague, number> };
}

const C = (key: string, label: Col['label'], hover: string, src: Col['src'], fmt: Fmt, extra: Partial<Col> = {}): Col => ({ key, label, hover, src, fmt, ...extra });

const IMPACT_PRO: readonly Col[] = [
    C('gp', 'GP', 'Games played', 'gp', 'int', { group: 'Sample' }),
    C('min', 'MIN', 'Minutes', 'min', 'int', { group: 'Sample' }),
    C('off_poss', 'O-Poss', 'Offensive possessions on the floor', 'off_poss', 'int', { group: 'Sample' }),
    C('def_poss', 'D-Poss', 'Defensive possessions on the floor', 'def_poss', 'int', { group: 'Sample' }),
    C('o_rapm', 'O', 'Offensive RAPM: regularized adjusted plus-minus on team scoring, per 100 possessions', 'o_rapm', 'signed1', { group: 'RAPM' }),
    C('d_rapm', 'D', 'Defensive RAPM, per 100 possessions (positive is better)', 'd_rapm', 'signed1', { group: 'RAPM' }),
    C('rapm', 'Net', 'RAPM, per 100 possessions', 'rapm', 'signed1', { group: 'RAPM' }),
    C('adj_rapm', 'Adj.', 'RAPM shrunk toward a box-score prior, per 100 possessions (net only)', 'adj_rapm', 'signed1', { group: 'RAPM' }),
    C('ospm', 'O', 'Offensive statistical plus-minus, per 100 possessions', 'ospm', 'signed1', { group: 'SPM' }),
    C('dspm', 'D', 'Defensive statistical plus-minus, per 100 possessions', 'dspm', 'signed1', { group: 'SPM' }),
    C('spm', 'Net', 'Statistical plus-minus: box-score features fit to the season’s RAPM, per 100 possessions', 'spm', 'signed1', { group: 'SPM' }),
    C('obpm', 'O', 'Offensive box plus-minus, per 100 possessions', 'obpm', 'signed1', { group: 'BPM' }),
    C('dbpm', 'D', 'Defensive box plus-minus, per 100 possessions', 'dbpm', 'signed1', { group: 'BPM' }),
    C('bpm', 'Net', 'Box plus-minus, per 100 possessions', 'bpm', 'signed1', { group: 'BPM' }),
    C('boban', 'BOBAN', 'Bayesian Online Box-Augmented Net: a filtered estimate of current skill, per 100 possessions', 'boban_filtered_skill', 'signed1'),
    C('war', 'WAR', 'Wins above replacement, season total', 'war', 'dec1'),
];
const IMPACT_COLLEGE: readonly Col[] = [
    C('off_poss', 'O-Poss', 'Offensive possessions on the floor', 'off_poss', 'int', { group: 'Sample' }),
    C('def_poss', 'D-Poss', 'Defensive possessions on the floor', 'def_poss', 'int', { group: 'Sample' }),
    C('o_rapm', 'O', 'Offensive RAPM, per 100 possessions', 'orapm', 'signed1', { group: 'RAPM' }),
    C('d_rapm', 'D', 'Defensive RAPM, per 100 possessions (positive is better)', 'drapm', 'signed1', { group: 'RAPM' }),
    C('rapm', 'Net', 'RAPM, per 100 possessions', 'rapm_net', 'signed1', { group: 'RAPM' }),
];

/**
 * BB-G27: WAR and VORP from sdv-db's player_war (BB-D26). WAR is never shown without its 90% interval: Low and High sit
 * next to it. The pros add each source's WAR (the headline is their mean); college is box BPM alone.
 */
const VALUE: readonly Col[] = [
    C('min', 'MIN', 'Minutes', 'min', 'int', { group: 'Sample' }),
    C('poss', 'Poss', 'On-court possessions (offensive plus defensive, over 2)', 'poss', 'int', { group: 'Sample' }),
    C('rating', 'Rating', 'Points per 100 possessions above a league-average player, anchored to his team', 'rating', 'signed1', { group: 'Value' }),
    C('vorp', 'VORP', 'Value over replacement player (Basketball-Reference’s scale): a season one point per 100 above replacement is 1', 'vorp', 'dec1', { group: 'Value' }),
    C('war', 'WAR', 'Wins above replacement, season total', 'war', 'dec1', { group: 'Value' }),
    C('war_lo', 'Low', 'The low end of WAR’s 90% interval (a bootstrap over each team’s games)', 'war_lo', 'dec1', { group: 'WAR 90% interval', noShade: true }),
    C('war_hi', 'High', 'The high end of WAR’s 90% interval', 'war_hi', 'dec1', { group: 'WAR 90% interval', noShade: true }),
];
const VALUE_PRO: readonly Col[] = [
    ...VALUE,
    C('war_bpm', 'BPM', 'WAR from box plus-minus alone', 'war_bpm', 'dec1', { group: 'WAR by source', noShade: true }),
    C('war_rapm', 'RAPM', 'WAR from RAPM alone', 'war_rapm', 'dec1', { group: 'WAR by source', noShade: true }),
    C('war_boban', 'BOBAN', 'WAR from BOBAN alone', 'war_boban', 'dec1', { group: 'WAR by source', noShade: true }),
];
/** BB-G27: points over expected from sdv-db's shot_quality_season (BB-D9), one row per player and team. Field goals only. */
const POE: readonly Col[] = [
    C('games', 'GP', 'Games with a field-goal attempt', 'games', 'int', { group: 'Sample' }),
    C('attempts', 'FGA', 'Field-goal attempts', 'attempts', 'int', { group: 'Sample' }),
    C('pts', 'PTS', 'Points from field goals', 'pts', 'int', { group: 'Points' }),
    C('xpts', 'xPTS', 'Expected points: each shot’s make chance times its value, summed', 'xpts', 'dec1', { group: 'Points' }),
    C('poe', 'POE', 'Points over expected: PTS minus xPTS', 'poe', 'signed1', { group: 'Points' }),
    C('poe_se', '±', 'One standard error of POE, from the make chances alone', 'poe_se', 'dec1', { group: 'Points', noShade: true }),
    C('xpps', 'xPTS/FGA', 'Expected points per shot: shot quality', 'xpps', 'dec2', { group: 'Per shot' }),
    C('poe_per_shot', 'POE/FGA', 'Points over expected per shot', 'poe_per_shot', 'signed2', { group: 'Per shot' }),
    C('fg_pct_oe', 'FG% OE', 'Field-goal percentage over expected: shot making', 'fg_pct_oe', 'ppts', { group: 'Per shot' }),
];
/** BB-G27's POE gate: about 4 FGA a game over a season (WAR's is impact's possessions gate, IMPACT_QUALIFIED_POSS). */
export const POE_QUALIFIED_FGA: Record<BasketballLeague, number> = { nba: 300, wnba: 150, mbb: 125, wbb: 125 };

const RATINGS: readonly Col[] = [
    C('games', 'GP', 'Games rated', 'games', 'int', { group: 'Sample' }),
    C('poss', 'Poss', 'Offensive possessions', 'poss', 'int', { group: 'Sample' }),
    C('off', { pergame: 'Pts', per75: 'Pts', per100: 'ORtg', totals: 'Pts' }, 'Points scored: per game, per 75 possessions, per 100 (ORtg) or the season total', { pergame: 'pts_pg', per75: 'pts_per75', per100: 'off_rtg', totals: 'pts' }, 'dec1', { group: 'Scoring' }),
    C('def', { pergame: 'Opp Pts', per75: 'Opp Pts', per100: 'DRtg', totals: 'Opp Pts' }, 'Points allowed: per game, per 75 possessions, per 100 (DRtg) or the season total', { pergame: 'opp_pts_pg', per75: 'opp_pts_per75', per100: 'def_rtg', totals: 'opp_pts' }, 'dec1', { group: 'Scoring', lowerBetter: true }),
    C('net', { pergame: '+/-', per75: '+/-', per100: 'Net', totals: '+/-' }, 'Point margin: per game, per 75 possessions, per 100 (Net) or the season total', { pergame: 'plus_minus_pg', per75: 'plus_minus_per75', per100: 'net_rtg', totals: 'plus_minus' }, 'signed1', { group: 'Scoring' }),
    C('pace', 'Pace', 'Possessions per 48 minutes (40 in the WNBA and college)', 'pace', 'dec1', { noShade: true }),
];
const pctCol = (key: string, label: string, hover: string, group: string, lowerBetter = false) =>
    C(key, label, hover, key, key.endsWith('ft_rate') ? 'rate3' : 'pct', { group, ...(lowerBetter ? { lowerBetter: true as const } : {}) });
const FACTORS: readonly Col[] = [
    C('games', 'GP', 'Games rated', 'games', 'int', { group: 'Sample' }),
    pctCol('efg_pct', 'eFG%', 'Effective field-goal percentage', 'Offense'),
    pctCol('tov_pct', 'TOV%', 'Turnovers per possession', 'Offense', true),
    pctCol('orb_pct', 'ORB%', 'Offensive rebounds over chances', 'Offense'),
    pctCol('ft_rate', 'FTr', 'Free-throw attempts per field-goal attempt', 'Offense'),
    pctCol('opp_efg_pct', 'eFG%', 'Opponents’ effective field-goal percentage', 'Defense', true),
    pctCol('opp_tov_pct', 'TOV%', 'Opponents’ turnovers per possession', 'Defense'),
    pctCol('opp_orb_pct', 'ORB%', 'Opponents’ offensive rebounds over chances', 'Defense', true),
    pctCol('opp_ft_rate', 'FTr', 'Opponents’ free-throw attempts per field-goal attempt', 'Defense', true),
];
const STRENGTH: readonly Col[] = [
    C('games', 'GP', 'Games', 'games', 'int', { group: 'Sample' }),
    C('wins', 'W', 'Wins', 'wins', 'int', { group: 'Sample' }),
    C('adj_off', 'Adj. O', 'Opponent-adjusted points per 100 possessions', 'adj_off_rtg', 'dec1', { group: 'Adjusted' }),
    C('adj_def', 'Adj. D', 'Opponent-adjusted points allowed per 100 possessions', 'adj_def_rtg', 'dec1', { group: 'Adjusted', lowerBetter: true }),
    C('adj_net', 'Adj. Net', 'Opponent-adjusted net rating', 'adj_net_rtg', 'signed2', { group: 'Adjusted' }),
    C('sos', 'SOS', 'Strength of schedule: the opponents’ mean adjusted net, one weight per game', 'sos', 'signed2'),
    C('sov', 'SOV', 'Strength of victory: the same mean over the wins only', 'sov', 'signed2'),
];
const FLOW: readonly Col[] = [
    C('games', 'GP', 'Games', 'games', 'int', { group: 'Sample' }),
    C('avg_margin', 'Margin', 'Average score margin over game time', 'avg_margin', 'signed1', { group: 'Control' }),
    C('avg_wp', 'WP', 'Average win probability over game time', 'avg_wp', 'pct', { group: 'Control' }),
    C('lead_pct', 'Lead %', 'Share of game time leading', 'lead_pct', 'pct', { group: 'Control' }),
    C('runs', '10-0 runs', '10-0 runs: per game or the season total', { pergame: 'runs_10_pg', totals: 'runs_10' }, 'dec2', { group: 'Runs' }),
    C('opp_runs', 'Opp 10-0', 'Opponents’ 10-0 runs: per game or the season total', { pergame: 'opp_runs_10_pg', totals: 'opp_runs_10' }, 'dec2', { group: 'Runs', lowerBetter: true }),
    C('drought', 'Drought', 'Average longest scoring drought, in seconds', 'avg_longest_drought_sec', 'secs', { group: 'Runs', lowerBetter: true }),
    C('stop_pct', 'Stop %', 'Stops over defensive possessions', 'stop_pct', 'pct', { group: 'Stops' }),
    C('kills', 'Kills', 'Three stops in a row: per game, per 75 or 100 defensive possessions, or the season total', { pergame: 'kills_pg', per75: 'kills_per75', per100: 'kills_per_100', totals: 'kills' }, 'dec2', { group: 'Stops' }),
    C('double_kills', 'Dbl kills', 'Six stops in a row: per game or the season total', { pergame: 'double_kills_pg', totals: 'double_kills' }, 'dec2', { group: 'Stops' }),
];
const LINEUPS: readonly Col[] = [
    C('minutes', 'MIN', 'Minutes together', 'minutes', 'int', { group: 'Sample' }),
    C('poss', 'Poss', 'Offensive possessions the unit started', 'poss', 'int', { group: 'Sample' }),
    // a lineup has no per-game basis: a unit plays a few minutes of many games
    C('off', { per75: 'Pts', per100: 'ORtg', totals: 'Pts' }, 'Points scored: per 75 possessions, per 100 (ORtg) or the total', { per75: 'pts_per75', per100: 'off_rtg', totals: 'pts' }, 'dec1', { group: 'Scoring' }),
    C('def', { per75: 'Opp Pts', per100: 'DRtg', totals: 'Opp Pts' }, 'Points allowed: per 75 possessions, per 100 (DRtg) or the total', { per75: 'opp_pts_per75', per100: 'def_rtg', totals: 'opp_pts' }, 'dec1', { group: 'Scoring', lowerBetter: true }),
    C('net', { per75: '+/-', per100: 'Net', totals: '+/-' }, 'Point margin: per 75 possessions, per 100 (Net) or the total (+/-)', { per75: 'plus_minus_per75', per100: 'net_rtg', totals: 'plus_minus' }, 'signed1', { group: 'Scoring' }),
    pctCol('efg_pct', 'eFG%', 'Effective field-goal percentage', 'Offense'),
    pctCol('tov_pct', 'TOV%', 'Turnovers per possession', 'Offense', true),
    pctCol('orb_pct', 'ORB%', 'Offensive rebounds over chances', 'Offense'),
    pctCol('ft_rate', 'FTr', 'Free-throw attempts per field-goal attempt', 'Offense'),
    pctCol('opp_efg_pct', 'eFG%', 'Opponents’ effective field-goal percentage', 'Defense', true),
    pctCol('opp_tov_pct', 'TOV%', 'Opponents’ turnovers per possession', 'Defense'),
    pctCol('opp_orb_pct', 'ORB%', 'Opponents’ offensive rebounds over chances', 'Defense', true),
    pctCol('opp_ft_rate', 'FTr', 'Opponents’ free-throw attempts per field-goal attempt', 'Defense', true),
];

const TEAM_SPECS: Record<TeamGroup, BoardSpec> = {
    ratings: { cols: RATINGS, defaultSort: 'net', defaultBasis: 'per100', qualifiedBy: 'net_rtg_rank' },
    factors: { cols: FACTORS, defaultSort: 'efg_pct', defaultBasis: 'per100', qualifiedBy: 'efg_pct_rank' },
    strength: { cols: STRENGTH, defaultSort: 'adj_net', defaultBasis: 'per100', qualifiedBy: 'adj_net_rtg_rank' },
    flow: { cols: FLOW, defaultSort: 'avg_margin', defaultBasis: 'pergame', qualifiedBy: 'avg_margin_rank' },
};

/**
 * The board's spec: the league picks the impact columns, the group the teams columns. The impact board keeps
 * player_impact's WAR with 'bball-war-boards' on too (review answer Q41 B): the WAR board shows player_war's beside it.
 */
export function boardSpec(board: Board, league: BasketballLeague, group: TeamGroup): BoardSpec {
    if (board === 'teams') return TEAM_SPECS[group];
    if (board === 'lineups') return { cols: LINEUPS, defaultSort: 'net', defaultBasis: 'per100', qualifiedBy: 'net_rtg_rank' };
    const pro = league === 'nba' || league === 'wnba';
    // season totals beside per-100 rates: one basis, and a qualifier is the board's own gate
    if (board === 'value') return { cols: pro ? VALUE_PRO : VALUE, defaultSort: 'war', defaultBasis: 'totals', qualifiedBy: null, gate: { col: 'poss', min: IMPACT_QUALIFIED_POSS } };
    if (board === 'poe') return { cols: POE, defaultSort: 'poe', defaultBasis: 'totals', qualifiedBy: null, gate: { col: 'attempts', min: POE_QUALIFIED_FGA } };
    // every impact measure is already per 100 possessions and WAR a season total: one basis, and a qualifier is the board's own gate
    return { cols: pro ? IMPACT_PRO : IMPACT_COLLEGE, defaultSort: 'rapm', defaultBasis: 'per100', qualifiedBy: null };
}

/** The producer column a column shows on a basis; null: the producer ships none for that basis (the cell is a dash). */
export function srcFor(col: Col, basis: Basis): string | null {
    return typeof col.src === 'string' ? col.src : col.src[basis] ?? null;
}
export function labelFor(col: Col, basis: Basis): string {
    return typeof col.label === 'string' ? col.label : col.label[basis] ?? Object.values(col.label)[0]!;
}

/**
 * The bases a board ships: its default, plus every basis some count column has a producer column for, in BASES order.
 * Given the season's rows, a basis is offered only when one of its columns has a value: a season the producer has not
 * backfilled (per game and per 75 landed in 2026) hides the basis instead of showing a board of dashes.
 */
export function offeredBases(spec: BoardSpec, rows?: readonly Record<string, unknown>[]): Basis[] {
    return BASES.filter((b) => b === spec.defaultBasis || spec.cols.some((c) => {
        const s = typeof c.src === 'string' ? null : c.src[b];
        return s != null && (rows == null || rows.some((r) => numberOrNull(r[s]) != null));
    }));
}
/** Percentiles are offered when some column of the board carries a producer `_pct` (the caller checks the rows). */
export function hasPercentiles(rows: readonly Record<string, unknown>[], spec: BoardSpec, basis: Basis): boolean {
    return spec.cols.some((c) => {
        const s = srcFor(c, basis);
        return s != null && rows.some((r) => numberOrNull(r[`${s}_pct`]) != null);
    });
}

/** One cell as shown: the producer's value, rank and percentile, all of the ONE column the basis resolved to. */
export interface Cell { src: string | null; value: number | null; rank: number | null; pct: number | null }
export function cellOf(row: Record<string, unknown>, col: Col, basis: Basis): Cell {
    const src = srcFor(col, basis);
    if (src == null) return { src, value: null, rank: null, pct: null };
    return { src, value: numberOrNull(row[src]), rank: numberOrNull(row[`${src}_rank`]), pct: numberOrNull(row[`${src}_pct`]) };
}

/** The number a cell prints: the value, or in the Percentiles view the same column's percentile. */
export function shown(row: Record<string, unknown>, col: Col, basis: Basis, view: View): number | null {
    const c = cellOf(row, col, basis);
    return view === 'percentiles' ? c.pct : c.value;
}

/**
 * The rows by the shown number of the sort column: best first (a percentile, or a value whose higher is better, falls;
 * a lower-is-better value rises), nulls last, then the producer's row order. No rank is computed: this only orders.
 */
export function sortRows<T extends Record<string, unknown>>(rows: readonly T[], col: Col, basis: Basis, view: View): T[] {
    const asc = view === 'values' && col.lowerBetter === true;
    return rows
        .map((r, i) => ({ r, i, v: shown(r, col, basis, view) }))
        .sort((a, b) => (a.v == null ? (b.v == null ? a.i - b.i : 1) : b.v == null ? -1 : (asc ? a.v - b.v : b.v - a.v) || a.i - b.i))
        .map((x) => x.r);
}

/** The controls a request asked for, resolved against what the board ships. `notes` says what was asked for and not shown. */
export interface Controls {
    board: Board;
    group: TeamGroup;
    unit: UnitSize;
    basis: Basis;
    view: View;
    qualified: boolean;
    sort: string;
    /** the bases the basis select offers (offeredBases over the season's rows) */
    bases: Basis[];
    /** a requested basis that is not shown: one the board or this season has no column for, or 'unknown' (not a basis at all) */
    basisFallback: Basis | 'unknown' | null;
    /** the Percentiles view was asked for on a board with none */
    viewFallback: boolean;
}

const pick = <T extends string | number>(list: readonly T[], v: string | null, dflt: T): T => list.find((x) => String(x) === v) ?? dflt;

/**
 * The URL's controls: every one whitelisted. An unknown basis is never passed on: it resolves to the board's default and
 * `basisFallback` names what was asked (a typo or a basis this board has no columns for), so nothing falls through silently.
 * `pctAvailable` is hasPercentiles over the board's rows; without it the view is Values and `viewFallback` says so.
 * `rows` (the season's, once read) narrows the bases to those with values; without it every basis the board ships is offered.
 */
export function parseControls(sp: URLSearchParams, league: BasketballLeague, pctAvailable: (spec: BoardSpec, basis: Basis) => boolean, war = false, rows?: readonly Record<string, unknown>[]): Controls {
    const board = pick(boardsFor(war), sp.get('board'), 'impact');
    const group = pick(TEAM_GROUPS, sp.get('group'), 'ratings');
    const unit = pick(UNIT_SIZES, sp.get('unit'), 5);
    const spec = boardSpec(board, league, group);
    const asked = sp.get('basis');
    const bases = offeredBases(spec, rows);
    const basis = bases.find((b) => b === asked) ?? spec.defaultBasis;
    const basisFallback = asked == null || asked === basis ? null : (BASES as readonly string[]).includes(asked) ? (asked as Basis) : 'unknown';
    const wantPct = sp.get('view') === 'percentiles';
    const view: View = wantPct && pctAvailable(spec, basis) ? 'percentiles' : 'values';
    const sort = spec.cols.find((c) => c.key === sp.get('sort'))?.key ?? spec.defaultSort;
    return { board, group, unit, bases, basis, view, qualified: sp.get('qualified') !== 'all', sort, basisFallback, viewFallback: wantPct && view === 'values' };
}

/**
 * The impact board's qualifier: the producer ranks no player yet, so the board gates on offensive possessions. A quarter
 * of a team's season possessions, roughly (NBA ~8,300, WNBA ~3,500, college ~2,400).
 * ponytail: a fixed gate per league; the producer's `_rank`/`_pct` among qualifiers replace it once player_impact ships them.
 */
export const IMPACT_QUALIFIED_POSS: Record<BasketballLeague, number> = { nba: 2000, wnba: 800, mbb: 600, wbb: 600 };

export function isQualified(row: Record<string, unknown>, spec: BoardSpec, league: BasketballLeague): boolean {
    if (spec.qualifiedBy) return numberOrNull(row[spec.qualifiedBy]) != null;
    if (spec.gate) return (numberOrNull(row[spec.gate.col]) ?? 0) >= spec.gate.min[league];
    return (numberOrNull(row.off_poss) ?? 0) >= IMPACT_QUALIFIED_POSS[league];
}

/** "KEYSHAWN.HALL" (ncaa_rapm's names) -> "Keyshawn Hall". ponytail: plain title case; "MCDONALD" reads "Mcdonald". */
export function ncaaName(raw: string): string {
    return raw.split(/[.\s]+/).filter(Boolean).map((w) => w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())).join(' ');
}
