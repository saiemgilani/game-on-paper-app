// Period and regulation labels for every basketball league, as functions of the game's regulation (2 halves or
// 4 quarters) and kind. Labels and counts only: no stat is computed here. Islands import this file, so it stays pure.
import type { PeriodKind } from './config';

const ORD = ['1st', '2nd', '3rd', '4th'];
const otLabel = (p: number, regulation: number) => (p - regulation === 1 ? 'OT' : `${p - regulation}OT`);

/** 'Q3', 'H2', 'OT', '2OT'. */
export function periodShort(p: number, regulation = 4, kind: PeriodKind = 'quarter'): string {
    return p <= regulation ? `${kind === 'half' ? 'H' : 'Q'}${p}` : otLabel(p, regulation);
}

/** '3rd Quarter', '2nd Half', 'Overtime', '2nd Overtime'. */
export function periodLong(p: number, regulation = 4, kind: PeriodKind = 'quarter'): string {
    if (p <= regulation) return `${ORD[p - 1]} ${kind === 'half' ? 'Half' : 'Quarter'}`;
    const n = p - regulation;
    return n === 1 ? 'Overtime' : `${ORD[n - 1] ?? `${n}th`} Overtime`;
}

/** A linescore column heading for 0-based column `i`: '1'..regulation, then 'OT', '2OT'. */
export function linescoreLabel(i: number, regulation = 4): string {
    return i < regulation ? String(i + 1) : otLabel(i + 1, regulation);
}

/** ESPN STATUS_END_PERIOD copy: 'End of 1st' (quarters, as the NBA board has always said), 'End of 1st Half', 'End of OT'. */
export function endOfPeriodText(p: number, regulation = 4, kind: PeriodKind = 'quarter'): string {
    if (p > regulation) return `End of ${otLabel(p, regulation)}`;
    return kind === 'half' ? `End of ${ORD[p - 1]} Half` : `End of ${ORD[p - 1]}`;
}

/** 'Final', 'Final/OT', 'Final/2OT'. */
export function finalText(p: number, regulation = 4, kind: PeriodKind = 'quarter'): string {
    return p > regulation ? `Final/${periodShort(p, regulation, kind)}` : 'Final';
}

/** WinProbabilityChart: does a period start get a marker. Football (allPeriodMarkers false) marks regulation and one OT. */
export function wpMarkerGate(per: number, allPeriodMarkers: boolean, regulation = 4): boolean {
    return allPeriodMarkers || per <= regulation + 1;
}

/** WinProbabilityChart: the marker's title; football keeps one 'OT' marker, basketball numbers every overtime. */
export function wpMarkerTitle(per: number, allPeriodMarkers: boolean, regulation = 4, kind: PeriodKind = 'quarter'): string {
    if (per <= regulation) return `${kind === 'half' ? 'H' : 'Q'}${per}`;
    return allPeriodMarkers && per > regulation + 1 ? `${per - regulation}OT` : 'OT';
}

/** The period props an island gets: none for four quarters, so every NBA and football island's props stay byte-identical. */
export function islandPeriodProps(regulation: number, kind: PeriodKind): { regulationPeriods?: number; periodKind?: PeriodKind } {
    return regulation === 4 && kind === 'quarter' ? {} : { regulationPeriods: regulation, periodKind: kind };
}
