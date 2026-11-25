import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { env } from 'cloudflare:workers';
import { isFeatureEnabled } from '../../../utils/features';
import {
    discordPayload, FEEDBACK_IMAGE_TYPES, FEEDBACK_LIMITS, imageFilename, parseFeedbackFields, rateKey, sniffImage,
    webhookUrl,
} from '../../../utils/feedback';
import { auditAdmin } from '../../../utils/telemetry';

export const prerender = false;

// POST /admin/api/feedback ('feedback-inbox'): the floating button's report, as a new post in
// the #gop-inbox Discord forum (utils/feedback.ts). Behind /admin via the middleware like every
// /admin/api route (admin cookie or basic auth), and checked again here.
//
// The webhook URL lives only in the DISCORD_INBOX_WEBHOOK_URL secret: it is never logged, never
// echoed, never sent to the browser, and it is the only URL this route fetches (nothing in the
// request picks a host). Plain fetch on purpose: wrappedFetch/timedFetch log or record the URL.
//
// CSRF: multipart/form-data is a form type, which Astro's checkOrigin (on by default) refuses
// cross-origin, and the admin cookie is SameSite=Lax.
const NO_STORE = { 'Cache-Control': 'no-store' };

export const POST: APIRoute = async (context) => {
    const { locals, request } = context;
    const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
    if (locals.adminAuthed !== true) return reply(401, { ok: false, error: 'auth required' });
    if (!isFeatureEnabled('feedback-inbox', locals)) return reply(404, { ok: false, error: 'not found' });
    const hook = webhookUrl(getSecret('DISCORD_INBOX_WEBHOOK_URL'));
    if (!hook) return reply(503, { ok: false, error: "Feedback isn't configured: DISCORD_INBOX_WEBHOOK_URL is not set." });

    const bad = (error: string, detail: string, status = 400) => {
        auditAdmin(locals, 'feedback', `${detail} (rejected: ${error})`, false);
        return reply(status, { ok: false, error });
    };
    if (!/^multipart\/form-data\b/i.test(request.headers.get('content-type') ?? '')) {
        return bad('content-type must be multipart/form-data', 'non-multipart body', 415);
    }
    if (Number(request.headers.get('content-length') ?? 0) > FEEDBACK_LIMITS.bodyBytes) {
        return bad('the report is too large', 'oversized body', 413);
    }
    let form: FormData;
    try { form = await request.formData(); } catch { return bad('unreadable form', 'unreadable form'); }

    const fields = parseFeedbackFields((k) => form.get(k));
    if (typeof fields === 'string') return bad(fields, 'invalid fields');
    const detail = `${fields.sender} ${fields.type}: ${fields.title.slice(0, 80)}`;

    let image: { type: string; buf: ArrayBuffer } | null = null;
    const file = form.get('image');
    if (file instanceof File && file.size > 0) {
        if (file.size > FEEDBACK_LIMITS.imageBytes) return bad('the image must be at most 4 MB', detail, 413);
        const buf = await file.arrayBuffer();
        const sniffed = sniffImage(new Uint8Array(buf));
        if (!FEEDBACK_IMAGE_TYPES.includes(file.type) || sniffed !== file.type) {
            return bad('the image must be a JPEG, PNG, WebP or GIF', detail, 415);
        }
        image = { type: sniffed, buf };
    }

    // ponytail: a fixed-window counter in KV, which is eventually consistent across colos, so a
    // burst from two places can pass a few extra. Durable Objects if that ever matters.
    const key = rateKey(fields.sender, Math.floor(Date.now() / 1000));
    const used = Number(await env.ESPN_API_CACHE.get(key)) || 0;
    if (used >= FEEDBACK_LIMITS.perWindow) {
        return bad(`at most ${FEEDBACK_LIMITS.perWindow} reports per ${FEEDBACK_LIMITS.windowS / 60} minutes`, detail, 429);
    }
    await env.ESPN_API_CACHE.put(key, String(used + 1), { expirationTtl: FEEDBACK_LIMITS.windowS * 2 });

    const payload = discordPayload({
        ...fields,
        actor: locals.adminActor ?? 'admin-cookie',
        userAgent: request.headers.get('user-agent') ?? '',
        image,
    });
    const body = new FormData();
    body.append('payload_json', JSON.stringify(payload));
    if (image) body.append('files[0]', new Blob([image.buf], { type: image.type }), imageFilename(image.type));

    let status = 0;
    try {
        const res = await fetch(`${hook}?wait=true`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
        status = res.status;
    } catch (e: any) {
        // the name only: a fetch error's message can carry the URL
        console.error(`feedback: Discord webhook unreachable (${e?.name ?? 'error'})`);
    }
    if (status < 200 || status >= 300) {
        if (status) console.error(`feedback: Discord webhook answered ${status}`);
        auditAdmin(locals, 'feedback', `${detail} (discord ${status || 'unreachable'})`, false);
        return reply(502, { ok: false, error: `Discord didn't take the report (${status || 'unreachable'}). Try again in a minute.` });
    }
    auditAdmin(locals, 'feedback', detail, true);
    return reply(200, { ok: true });
};
