/**
 * The game page Impact box's pure steps (BB-G1): each side's players by minutes and its top units, with names. Nothing
 * here aggregates: every minute, possession, +/- and rating is the producer's (sdv-db game_player_impact /
 * game_lineups_used, rule B6).
 */
import type { ImpactBoxReads, ImpactRow, LineupRow } from '../resources/impactBox';

export interface ImpactSide {
    /** most minutes first; `pageId` is his player page's id (null: no page link: a college player with no crosswalk pair, or no page this season) */
    players: (ImpactRow & { name: string; pageId: string | null })[];
    /** the producer's order (most-used first, every unit), each with its five names */
    units: (LineupRow & { names: string[] })[];
}

const byMinutes = (a: ImpactRow, b: ImpactRow) => (b.minutes ?? 0) - (a.minutes ?? 0) || String(a.player_id).localeCompare(String(b.player_id));

/** One ESPN side's rows. A player the box does not name keeps their id (never dropped: the +/- would stop adding up). */
export function impactSide(reads: ImpactBoxReads, side: 'home' | 'away'): ImpactSide {
    const teamId = reads.teams?.[side];
    const nameOf = new Map(reads.names.map((n) => [n.player_id, n.name]));
    const name = (id: number | string) => nameOf.get(String(id)) ?? `#${id}`;
    // the pros' stats ids are the page's; college maps stats.ncaa.org ids through the crosswalk; either way only a player
    // the season's shot list names has a page (no shots all season: no page, no link)
    const pageId = (id: number | string) => {
        const page = reads.pageIds ? reads.pageIds.get(String(id)) ?? null : String(id);
        return page !== null && reads.pages.has(page) ? page : null;
    };
    const players = reads.players.filter((p) => Number(p.team_id) === teamId).sort(byMinutes).map((p) => ({ ...p, name: name(p.player_id), pageId: pageId(p.player_id) }));
    const units = reads.lineups[side].map((u) => ({ ...u, names: [u.player_1, u.player_2, u.player_3, u.player_4, u.player_5].map(name) }));
    return { players, units };
}

/** "Angelo Brizzi" as "A. Brizzi": the unit column's short form. */
export const shortName = (full: string) => {
    const [first, ...rest] = full.trim().split(/\s+/);
    return rest.length && !full.startsWith('#') ? `${first[0]}. ${rest.join(' ')}` : full;
};
