/**
 * Basketball player compare (BB-G13, behind 'bball-compare'): the football compare page's cards (#359, utils/compare.ts
 * for the `?ids=` list and its links) filled from what the basketball player page already reads: the Impact panel's rows
 * (BB-G6), the Value panel's (BB-G27) and the season's shooting line (shot_season_players). Every card lists the same
 * rows in the same order, so a row lines up across cards; a player with no producer row gets dashes, not a gap.
 *
 * Nothing here ranks or aggregates (rule B6): a cell's rank and percentile are the producer's `<m>_rank` / `<m>_pct`,
 * shooting's included (shot_season_players' FG%, eFG%, 3P% and FT%, Q46): the site computes none of those percentages.
 */
import type { PlayerImpactRow } from '../resources/playerImpact';
import type { PlayerWarRow } from '../resources/playerWar';
import type { SeasonPlayerRow } from '../resources/nbaShots';
import type { PlayerSeason } from '../nba/data/players';
import { fmtDec, fmtInt, fmtPct } from '../nba/format';
import { impactPanel } from './playerImpact';
import { warPanel } from './playerWar';
import { signed1 } from './shotQuality';

/** One row of a card: its text, and the producer's rank and percentile when it ships them. */
export interface CompareRow { key: string; label: string; hover?: string; text: string; rank: number | null; pct: number | null }

const DASH = '—';
const orDash = (v: number | null, f: (v: number) => string) => (v == null ? DASH : f(v));

/**
 * The Impact rows: each measure's net number, then its offense and defense when it has them. `rows` null (the read
 * failed) or empty gives the same rows with dashes: impactPanel over an empty row is every measure with no value.
 */
export function impactRows(rows: PlayerImpactRow[] | null, college: boolean, relabelWar: boolean): CompareRow[] {
    const panel = impactPanel(rows?.length ? rows : [{}], college, relabelWar)!;
    return panel.measures.flatMap((m) => ([['', m.net], [' off', m.off], [' def', m.def]] as const).flatMap(([side, c]) => (c ? [{
        key: c.col, label: `${m.label}${side}`, hover: m.hover, text: orDash(c.value, signed1), rank: c.rank, pct: c.pct,
    }] : [])));
}

/** The Value rows: WAR, never without its 90% interval (the next row), VORP and the rating behind them. */
export function valueRows(rows: PlayerWarRow[] | null): CompareRow[] {
    const p = warPanel(rows?.length ? rows : [{} as PlayerWarRow])!;
    const interval = p.war.value == null ? DASH : p.war.lo != null && p.war.hi != null ? `${fmtDec(p.war.lo, 1)} to ${fmtDec(p.war.hi, 1)}` : 'no interval yet';
    return [
        { key: 'war', label: 'WAR', hover: 'Wins above replacement, in wins', text: orDash(p.war.value, (v) => fmtDec(v, 1)), rank: p.war.rank, pct: p.war.pct },
        { key: 'war_interval', label: 'WAR 90% interval', text: interval, rank: null, pct: null },
        { key: 'vorp', label: 'VORP', hover: 'Value over replacement player', text: orDash(p.vorp.value, (v) => fmtDec(v, 1)), rank: p.vorp.rank, pct: p.vorp.pct },
        { key: 'rating', label: 'Rating', hover: 'Points per 100 possessions above a league-average player', text: orDash(p.rating, signed1), rank: null, pct: null },
    ];
}

/**
 * The shooting rows: his season makes and attempts (every team he shot for), the season's FG%, eFG%, 3P% and FT% as
 * shot_season_players ships them with the producer's rank and percentile (null under its attempt minimum: the value with
 * no rank and no shading), and the box numbers on the player page's header. `row` is one of his rows that season (the
 * percentages and ranks are the same on each).
 */
export function shootingRows(player: PlayerSeason | null, row: SeasonPlayerRow | null): CompareRow[] {
    const s = player?.stats ?? null;
    const plain = (key: string, label: string, text: string): CompareRow => ({ key, label, text, rank: null, pct: null });
    const ranked = (m: 'fg_pct' | 'efg_pct' | 'fg3_pct' | 'ft_pct', label: string): CompareRow => ({
        key: m, label, text: orDash(row?.[m] ?? null, (v) => fmtPct(v)), rank: row?.[`${m}_rank`] ?? null, pct: row?.[`${m}_pct`] ?? null,
    });
    return [
        plain('fg', 'FG', player ? `${fmtInt(player.makes)}/${fmtInt(player.attempts)}` : DASH),
        ranked('fg_pct', 'FG%'),
        ranked('efg_pct', 'eFG%'),
        ranked('fg3_pct', '3P%'),
        plain('fg3', '3P', player ? `${fmtInt(player.fg3m)}/${fmtInt(player.fg3a)}` : DASH),
        ranked('ft_pct', 'FT%'),
        plain('gp', 'GP', s ? fmtInt(s.gp) : DASH),
        plain('min', 'MIN', s ? fmtDec(s.min) : DASH),
        plain('usg_pct', 'USG%', s ? fmtPct(s.usg_pct) : DASH),
        plain('ts_pct', 'TS%', s ? fmtPct(s.ts_pct) : DASH),
    ];
}
