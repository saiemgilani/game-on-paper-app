import type { APIRoute } from 'astro';
import { compareCsv, parseCompareIds, type CompareProfile } from '../../utils/pro';
import { claimDownload, PRO_SEASON, proObject } from '../../resources/pro';

export const prerender = false;

// /pro/export?ids=1,2,3: the derived metrics of up to four profiles as one CSV (the
// Analyst tier's "export of derived metrics"). Any tier; each file counts against the
// daily download cap like a PDF does, but not against Analyst's 10 PDFs a month.
export const GET: APIRoute = async ({ url, locals }) => {
    const headers = { 'Cache-Control': 'no-store' };
    if (!locals.pro) return new Response('Forbidden', { status: 403, headers });
    const ids = parseCompareIds(url.searchParams.get('ids'));
    const docs = (await Promise.all(ids.map((id) => proObject<CompareProfile>(`pro/${PRO_SEASON}/players/${id}.json`))))
        .filter((d): d is CompareProfile => d !== null);
    if (docs.length === 0) return new Response('No profile for those ids', { status: 404, headers });
    if (!(await claimDownload(locals.pro, 'pro/export.csv'))) {
        return new Response('Download limit reached for today. See /pricing.', { status: 429, headers });
    }
    const name = docs.length === 1 ? `${docs[0].player.espn_id}` : 'compare';
    return new Response(compareCsv(docs), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gop-pro-${PRO_SEASON}-${name}.csv"` },
    });
};
