/**
 * Admin tool: the selected processing source against ESPN, on the aggregates
 * the processor already computed.
 *
 * Nothing is recomputed from the plays here -- every number is read straight
 * out of the advanced box score both payloads carry, so a difference in this
 * table is a difference in the SOURCE, not in this file's arithmetic. The play
 * count and the first play the two feeds disagree on say whether they even
 * describe the same game; a play-by-play diff view is deliberately not here.
 *
 * Shared number helpers live in `utils/misc.ts`; only the compare-specific
 * logic is in this file.
 */
import type { ProcessedGame } from '../resources/python';
import { finiteNumber, getNumberWithOrdinal, toPercent } from './misc';

export interface CompareRow {
    label: string;
    /** decimals for roundNumber(value, power10, fixed) */
    fixed: number;
    /** rendered as a percentage */
    percent?: boolean;
    selected: number | null;
    espn: number | null;
    /** selected - espn, null when either side is missing the metric */
    delta: number | null;
}

/** How the two play lists were lined up. See `playKeys`. */
export type PlayAlignment = 'id' | 'composite';

export const ALIGNMENT_LABEL: Record<PlayAlignment, string> = {
    id: 'aligned by play id',
    composite: 'aligned by period/clock/possession',
};

export interface SourceComparison {
    /** one block per team, in the payload's own column order */
    teams: { id: string; rows: CompareRow[] }[];
    playsSelected: number;
    playsEspn: number;
    alignment: PlayAlignment;
    /** the first play the two payloads disagree on, labelled for the alignment in use */
    firstDifference: string | null;
    /** plays with no counterpart on the other side, under that alignment */
    unmatchedSelected: number;
    unmatchedEspn: number;
}

const row = (label: string, fixed: number, selected: number | null, espn: number | null, percent = false): CompareRow => ({
    label, fixed, percent, selected, espn,
    delta: selected === null || espn === null ? null : selected - espn,
});

/** The team's row in each box-score section, matched on `pos_team`. */
function teamRows(game: ProcessedGame | null | undefined, teamId: string) {
    const box = game?.advBoxScore;
    const find = (rows: any[] | undefined) => (rows ?? []).find((r) => String(r?.pos_team ?? '') === teamId);
    return {
        team: find(box?.team as any[]),
        situational: find(box?.situational as any[]),
        turnover: find(box?.turnover as any[]),
        drives: find(box?.drives as any[]),
    };
}

/**
 * Line the two play lists up.
 *
 * Play ids are source-local: Shield, CBS, Yahoo, Fox and NCAA each mint their
 * own, so zipping two feeds on `id` reports every play as different and the
 * panel says nothing. Ids are only a key when BOTH payloads came from ESPN --
 * which includes a `?source=` request that failed over (`provenance.source`).
 *
 * Otherwise the key is composite, and built only from fields the source
 * contract guarantees every adapter emits at `required`/`value` level
 * (sportsdataverse/football/sources/contract.py `PLAY_FIELDS`):
 * `period.number`, `clock.displayValue`, `start.team.id`, `start.down` and
 * `start.distance`. A play missing any of those falls back to its ordinal
 * position within its period, which still lines up as long as both feeds carry
 * the same plays in the same order.
 */
function playKeys(plays: any[], alignment: PlayAlignment): { key: string; label: string }[] {
    const seenInPeriod = new Map<string, number>();
    return plays.map((p) => {
        if (alignment === 'id') {
            const id = String(p?.id ?? '');
            return { key: id, label: `play id ${id}` };
        }
        const period = finiteNumber(p?.period ?? p?.start?.period);
        const clock = p?.clock?.displayValue ?? null;
        const posTeam = p?.pos_team ?? p?.start?.pos_team?.id ?? null;
        const down = finiteNumber(p?.start?.down ?? p?.down);
        const distance = finiteNumber(p?.start?.distance ?? p?.distance);
        const periodKey = period === null ? '?' : String(period);
        const ordinal = (seenInPeriod.get(periodKey) ?? 0) + 1;
        seenInPeriod.set(periodKey, ordinal);
        if (period === null || !clock || posTeam == null) {
            return { key: `p${periodKey}#${ordinal}`, label: `Q${periodKey} play ${ordinal}` };
        }
        const downDistance = down === null || distance === null
            ? '' : `, ${getNumberWithOrdinal(down)} & ${distance}`;
        return {
            key: [period, clock, String(posTeam), down ?? '', distance ?? ''].join('|'),
            label: `Q${period} ${clock}${downDistance}, team ${posTeam}`,
        };
    });
}

/** How many of `a`'s keys have no counterpart left in `b` (multiset difference). */
function unmatched(a: { key: string }[], b: { key: string }[]): number {
    const counts = new Map<string, number>();
    for (const { key } of b) counts.set(key, (counts.get(key) ?? 0) + 1);
    let n = 0;
    for (const { key } of a) {
        const left = counts.get(key) ?? 0;
        if (left > 0) counts.set(key, left - 1); else n++;
    }
    return n;
}

export function compareSources(
    selected: ProcessedGame,
    espn: ProcessedGame | null,
    /** the feed that actually produced `selected` (provenance.source), not the one requested */
    servedSource: string = 'espn',
): SourceComparison {
    // Column order comes from the payload being displayed, so the table lines
    // up with every other team table on the page (away, home).
    const teamIds = [selected.teamInfo?.away?.id, selected.teamInfo?.home?.id]
        .filter((id) => id != null).map(String);

    const teams = teamIds.map((id) => {
        const a = teamRows(selected, id);
        const b = teamRows(espn, id);
        return {
            id,
            rows: [
                row('Plays', 0, finiteNumber(a.team?.EPA_plays), finiteNumber(b.team?.EPA_plays)),
                row('EPA/Play', 2, finiteNumber(a.team?.EPA_per_play), finiteNumber(b.team?.EPA_per_play)),
                row('Success Rate', 1, toPercent(a.situational?.EPA_success_rate), toPercent(b.situational?.EPA_success_rate), true),
                row('Explosive Play Rate', 1, toPercent(a.team?.EPA_explosive_rate), toPercent(b.team?.EPA_explosive_rate), true),
                row('Turnovers', 0, finiteNumber(a.turnover?.turnovers), finiteNumber(b.turnover?.turnovers)),
                row('Drives', 0, finiteNumber(a.drives?.drives), finiteNumber(b.drives?.drives)),
            ],
        };
    });

    const alignment: PlayAlignment = servedSource === 'espn' ? 'id' : 'composite';
    const selectedKeys = playKeys(selected.plays ?? [], alignment);
    const espnKeys = playKeys(espn?.plays ?? [], alignment);

    let firstDifference: string | null = null;
    for (let i = 0; i < Math.max(selectedKeys.length, espnKeys.length); i++) {
        const a = selectedKeys[i], b = espnKeys[i];
        if (a?.key !== b?.key) { firstDifference = (a ?? b)!.label; break; }
    }

    return {
        teams,
        playsSelected: selectedKeys.length,
        playsEspn: espnKeys.length,
        alignment,
        firstDifference,
        unmatchedSelected: unmatched(selectedKeys, espnKeys),
        unmatchedEspn: unmatched(espnKeys, selectedKeys),
    };
}
