import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isEmail, normalizeEmail, PRO_ADDONS, PRO_TIERS, type ProAddon, type ProTier } from '../../../utils/pro';
import { deleteEntitlement, writeEntitlement } from '../../../resources/pro';
import { auditAdmin } from '../../../utils/telemetry';

export const prerender = false;

// Hand-entered Game on Paper Pro entitlements (KV pro:ent:<email>), until a
// Stripe webhook is worth building. Behind /admin auth via the middleware.
//   GET  ?email=a@b.c                          -> the stored row, expired or not
//   POST form {email, tier, expires, team?, action=save|remove} -> 303 back to /admin
// `expires` is a date (YYYY-MM-DD); access runs to the end of that day, UTC.
export const GET: APIRoute = async ({ url }) => {
    const email = normalizeEmail(url.searchParams.get('email'));
    if (!isEmail(email)) return Response.json({ ok: false, error: 'email required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const row = await (env as any).SESSION.get(`pro:ent:${email}`, 'json');
    return Response.json({ ok: true, email, entitlement: row }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: APIRoute = async ({ request, locals }) => {
    let form: FormData | null = null;
    try { form = await request.formData(); } catch { /* falls to the 400 */ }
    const field = (k: string) => String(form?.get(k) ?? '').trim();
    const email = normalizeEmail(field('email'));
    const back = (status: string) => new Response(null, {
        status: 303, headers: { Location: `/admin?pro=${encodeURIComponent(status)}`, 'Cache-Control': 'no-store' },
    });
    if (!isEmail(email)) return back('error: not an email');
    if (field('action') === 'remove') {
        await deleteEntitlement(email);
        auditAdmin(locals, 'pro-entitlement', `remove ${email}`, true);
        return back(`removed ${email}`);
    }
    const tier = field('tier') as ProTier;
    const day = field('expires');
    if (!(PRO_TIERS as readonly string[]).includes(tier) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))) {
        return back('error: tier and an expiry date are required');
    }
    const team = field('team').slice(0, 100);
    const addons = (form?.getAll('addons') ?? []).map(String).filter((a): a is ProAddon => (PRO_ADDONS as readonly string[]).includes(a));
    await writeEntitlement(email, { tier, expires: `${day}T23:59:59Z`, ...(team ? { team } : {}), ...(addons.length ? { addons } : {}) });
    auditAdmin(locals, 'pro-entitlement', `${email} ${tier}${addons.length ? `+${addons.join('+')}` : ''} to ${day}${team ? ` (${team})` : ''}`, true);
    return back(`saved ${email}: ${tier} to ${day}`);
};
