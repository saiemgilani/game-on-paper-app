/**
 * Page-side step of the player compare page (`/players/compare`, `/nfl/players/compare`).
 * Two reads per player, every player at once, each settled on its own so one bad read
 * becomes one "unavailable" card rather than a blank page. An id the API has no player
 * for is dropped from the comparison. Cached like a player page: everything is in the URL.
 */
import type { AstroGlobal } from 'astro';
import type { League } from '../utils/league';
import { isFeatureEnabled } from '../utils/features';
import { parseCompareIds } from '../utils/compare';
import type { SeasonRow } from '../utils/players';
import { retrievePlayer, retrievePlayerSeasons, type SDVPlayer } from '../resources/sdv';
import { PLAYER_CACHE, setCache, uncacheable } from './player';

export type CompareEntry = { id: string; player: SDVPlayer; rows: SeasonRow[] } | { id: string; unavailable: true };

export type ComparePrep = { notFound: true } | { entries: CompareEntry[]; season: number | null };

export async function prepareCompare(Astro: AstroGlobal, league: League): Promise<ComparePrep> {
    Astro.locals.league = league;
    const seasonParam = Astro.url.searchParams.get('season');
    if (!isFeatureEnabled('player-compare', Astro.locals) || (seasonParam !== null && !/^\d{4}$/.test(seasonParam))) {
        uncacheable(Astro);
        return { notFound: true };
    }
    const season = seasonParam === null ? null : parseInt(seasonParam);
    const ids = parseCompareIds(Astro.url.searchParams.get('ids'));
    const reads = await Promise.all(ids.map((id) => Promise.allSettled([
        retrievePlayer(id, league), retrievePlayerSeasons(id, league),
    ])));
    let degraded = false;
    const entries: CompareEntry[] = [];
    reads.forEach(([player, rows], i) => {
        const id = ids[i];
        if (player.status === 'rejected' || rows.status === 'rejected') {
            console.error(`player compare: a read for ${id} failed: ${player.status === 'rejected' ? player.reason : (rows as PromiseRejectedResult).reason}`);
            degraded = true;
            entries.push({ id, unavailable: true });
        } else if (player.value) {
            entries.push({ id, player: player.value, rows: rows.value as SeasonRow[] });
        }
    });
    if (degraded) uncacheable(Astro);
    else setCache(Astro, PLAYER_CACHE);
    return { entries, season };
}
