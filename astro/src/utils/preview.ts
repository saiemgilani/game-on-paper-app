// Preview mode: an HMAC-signed, expiring cookie that lets an admin see
// in-development features on the PUBLIC site. The middleware treats a valid
// cookie as "this response must never be cached" (Workers Caching would
// otherwise serve the preview variant to everyone), sets locals.preview, and
// components gate on it via utils/features.ts.
//
// The cookie grants view-only access to unreleased UI, nothing more; it is
// signed with ADMIN_PASS so it cannot be minted client-side, and it expires.

export const PREVIEW_COOKIE = 'gop_preview';
// Thirty days: the cookie expires SILENTLY -- pages just revert to the public
// variant with no signal (the on-page PREVIEW badge disappearing is the only
// tell) -- and it grants view-only access to unreleased UI, so a long life
// costs nothing. The /admin button always shows the live state.
export const PREVIEW_TTL_S = 30 * 24 * 60 * 60;

// Magic link: ?preview_key=<token> on ANY site URL. The middleware verifies it,
// sets the preview cookie, and redirects to the clean URL -- one click for a
// colleague on any browser, no admin login. The token is purpose-separated from
// the cookie (different HMAC message) so one can never be replayed as the other.
export const PREVIEW_LINK_PARAM = 'preview_key';
export const PREVIEW_LINK_TTL_S = 14 * 24 * 60 * 60;

async function hmacHex(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function mintToken(secret: string, purpose: string, ttlS: number, nowS: number): Promise<string> {
    const expiry = nowS + ttlS;
    return `v1.${expiry}.${await hmacHex(secret, `${purpose}:${expiry}`)}`;
}

async function verifyToken(value: string | undefined | null, secret: string | undefined,
                           purpose: string, nowS: number): Promise<boolean> {
    if (!value || !secret) return false;
    const [v, expiryRaw, sig] = value.split('.');
    const expiry = Number(expiryRaw);
    if (v !== 'v1' || !Number.isFinite(expiry) || expiry <= nowS || !sig) return false;
    const expected = await hmacHex(secret, `${purpose}:${expiry}`);
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

export async function mintPreviewCookie(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
    return mintToken(secret, 'gop-preview', PREVIEW_TTL_S, nowS);
}

export async function verifyPreviewCookie(value: string | undefined | null, secret: string | undefined,
                                          nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
    return verifyToken(value, secret, 'gop-preview', nowS);
}

export async function mintPreviewLink(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
    return mintToken(secret, 'gop-preview-link', PREVIEW_LINK_TTL_S, nowS);
}

export async function verifyPreviewLink(value: string | undefined | null, secret: string | undefined,
                                        nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
    return verifyToken(value, secret, 'gop-preview-link', nowS);
}

// The one Set-Cookie shape for the preview cookie, shared by the /admin toggle
// and the magic-link redeem so the attributes can never drift apart.
export async function previewSetCookie(secret: string): Promise<string> {
    return `${PREVIEW_COOKIE}=${await mintPreviewCookie(secret)}; Path=/; Max-Age=${PREVIEW_TTL_S}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(header: string | null, name: string): string | null {
    for (const part of (header ?? '').split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) return rest.join('=');
    }
    return null;
}
