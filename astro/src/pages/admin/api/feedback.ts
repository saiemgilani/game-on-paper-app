import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { env } from 'cloudflare:workers';
import { isFeatureEnabled } from '../../../utils/features';
import {
    discordPayload, FEEDBACK_IMAGE_TYPES, FEEDBACK_LIMITS, imageFilename, pageRoute, parseFeedbackFields, rateKey, sniffImage,
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
// cross-origin, and the admin cookie is SameSite=Lax. The Origin check below holds on its own
// too: a browser resends cached basic-auth credentials cross-site whatever SameSite says.
const NO_STORE = { 'Cache-Control': 'no-store' };

export const POST: APIRoute = async (context) => {
    const { locals, request } = context;
    const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
    if (locals.adminAuthed !== true) return reply(401, { ok: false, error: 'auth required' });
    // every refusal past the session check is audited: a refused attempt is still an admin action
    const bad = (error: string, detail: string, status = 400) => {
        auditAdmin(locals, 'feedback', `${detail} (rejected: ${error})`, false);
        return reply(status, { ok: false, error });
    };
    // a browser always sends Origin on a cross-origin POST; a scripted caller (curl -u) sends none
    const origin = new URL(request.url).origin;
    const sentOrigin = request.headers.get('origin');
    if (sentOrigin !== null && sentOrigin !== origin) return bad('cross-origin request', 'cross-origin', 403);
    if (!isFeatureEnabled('feedback-inbox', locals)) return bad('not found', 'flag off', 404);
    const hook = webhookUrl(getSecret('DISCORD_INBOX_WEBHOOK_URL'));
    if (!hook) return bad("Feedback isn't configured: DISCORD_INBOX_WEBHOOK_URL is not set.", 'webhook unset', 503);

    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data\b/i.test(contentType)) {
        return bad('content-type must be multipart/form-data', 'non-multipart body', 415);
    }
    // the real byte count, not the declared one: a missing or understated content-length must not
    // get a larger body buffered and parsed
    let raw: Uint8Array<ArrayBuffer> | null;
    try {
        raw = request.body ? await readCapped(request.body, FEEDBACK_LIMITS.bodyBytes) : new Uint8Array(0);
    } catch {
        // the upload broke off mid-stream
        return bad('the report did not arrive in full: try again', 'unreadable body');
    }
    if (raw === null) return bad('the report is too large', 'oversized body', 413);
    let form: FormData;
    try { form = await new Response(raw, { headers: { 'content-type': contentType } }).formData(); } catch { return bad('unreadable form', 'unreadable form'); }

    const fields = parseFeedbackFields((k) => form.get(k));
    if (typeof fields === 'string') return bad(fields, 'invalid fields');
    // only a page on this site goes into the post: a forged report can't plant another site's link as its context
    if (pageRoute(fields.page)?.href.startsWith(origin + '/') !== true) fields.page = '';
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

    // ponytail: a fixed-window counter in KV, read then written and eventually consistent across
    // colos, so concurrent posts or a burst across a window edge can pass a few extra. Durable
    // Objects if that ever matters. Fail-open: a KV outage must not stop a report.
    const key = rateKey(fields.sender, Math.floor(Date.now() / 1000));
    try {
        const used = Number(await env.ESPN_API_CACHE.get(key)) || 0;
        if (used >= FEEDBACK_LIMITS.perWindow) {
            return bad(`at most ${FEEDBACK_LIMITS.perWindow} reports per ${FEEDBACK_LIMITS.windowS / 60} minutes`, detail, 429);
        }
        await env.ESPN_API_CACHE.put(key, String(used + 1), { expirationTtl: FEEDBACK_LIMITS.windowS * 2 });
    } catch (e: any) {
        console.error(`feedback: rate counter unavailable (${e?.name ?? 'error'}), sending anyway`);
    }

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
        // no response at all (a timeout) may still have posted: say so, rather than invite a blind resend
        return reply(502, { ok: false, error: status
            ? `Discord didn't take the report (${status}). Try again in a minute.`
            : "Discord didn't answer. Check #gop-inbox before sending again: the report may have posted." });
    }
    auditAdmin(locals, 'feedback', detail, true);
    return reply(200, { ok: true });
};

/** The whole body, or null as soon as it passes `max` bytes (the rest is never read). */
async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) { await reader.cancel().catch(() => {}); return null; }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
}
