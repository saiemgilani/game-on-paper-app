// The live data-quality signal behind /admin/qa, read from the platform
// telemetry store. Same key and same hop as the rest of the admin API
// (pages/admin/api/[name].ts), but called server-side from the page: the page
// renders the tables, so a round trip through our own worker would buy
// nothing. `GET /gop/admin/qa` is the query; python/gop_routes.py is the SQL.
import { getSecret } from 'astro:env/server';

export interface QaGameRow {
    game_id: string
    matchup: string | null
    status: string | null
    away_score: number | null
    home_score: number | null
    last_poll: string
    age_s: number
    qa_ok: boolean | null
    qa_errors: number | null
    qa_warnings: number | null
    qa_source: string | null
    qa_fallback: boolean | null
    qa_rules: string[] | null
}

export interface QaRuleRow { rule: string, day: string, n: number, games: number }

export interface QaAdmin {
    games: QaGameRow[]
    rules: QaRuleRow[]
    totals: { checks?: number, clean?: number, games?: number, fallbacks?: number }
    days: number
    /** false when the query could not be answered, so the page says so
     *  instead of rendering an empty table as "nothing is wrong". */
    ok: boolean
}

const EMPTY: QaAdmin = { games: [], rules: [], totals: {}, days: 0, ok: false };

export async function retrieveQaAdmin(days = 7): Promise<QaAdmin> {
    const py = getSecret('PYTHON_HTTP_URL') || 'http://python:5000';
    try {
        const r = await fetch(`${py}/gop/admin/qa?days=${encodeURIComponent(String(days))}`, {
            headers: { 'X-GOP-Key': getSecret('GOP_INGEST_KEY') ?? '' },
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return { ...EMPTY, days };
        const body = await r.json() as Partial<QaAdmin>;
        return { games: body.games ?? [], rules: body.rules ?? [], totals: body.totals ?? {},
                 days: body.days ?? days, ok: true };
    } catch {
        return { ...EMPTY, days };
    }
}
