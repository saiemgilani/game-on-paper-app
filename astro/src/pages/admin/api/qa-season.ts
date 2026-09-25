// The published half of the QA tab: per-game verdicts for a whole season, from
// the release builds, for every league the site renders. The middleware gates
// /admin/api/*, so this is admin-only like the rest of the admin API.
import type { APIRoute } from 'astro';
import { retrieveQaSeason } from '../../../resources/sdv';
import { QA_LEAGUES } from '../../../utils/adminQa';
import { CURRENT_YEAR } from '../../../utils/constants';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    const season = Number(url.searchParams.get('season')) || CURRENT_YEAR;
    const byLeague = await Promise.all(QA_LEAGUES.map((lg) => retrieveQaSeason(season, lg)));
    return new Response(JSON.stringify({
        season,
        // one league answering is enough to render; only a total failure is the
        // "the query failed" claim
        ok: byLeague.some((s) => s.ok),
        rows: QA_LEAGUES.flatMap((lg, i) => byLeague[i].rows.map((r) => ({ ...r, league: lg }))),
    }), { headers: { 'Content-Type': 'application/json' } });
};
