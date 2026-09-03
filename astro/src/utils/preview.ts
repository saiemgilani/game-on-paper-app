// Preview mode: an HMAC-signed, expiring cookie that lets an admin see
// in-development features on the PUBLIC site. The middleware treats a valid
// cookie as "this response must never be cached" (Workers Caching would
// otherwise serve the preview variant to everyone), sets locals.preview, and
// components gate on it via utils/features.ts.
//
// The cookie grants view-only access to unreleased UI, nothing more; it is
// signed with ADMIN_PASS so it cannot be minted client-side, and it expires.

export const PREVIEW_COOKIE = 'gop_preview';
export const PREVIEW_TTL_S = 12 * 60 * 60;

async function hmacHex(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintPreviewCookie(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
    const expiry = nowS + PREVIEW_TTL_S;
    return `v1.${expiry}.${await hmacHex(secret, `gop-preview:${expiry}`)}`;
}

export async function verifyPreviewCookie(value: string | undefined | null, secret: string | undefined,
                                          nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
    if (!value || !secret) return false;
    const [v, expiryRaw, sig] = value.split('.');
    const expiry = Number(expiryRaw);
    if (v !== 'v1' || !Number.isFinite(expiry) || expiry < nowS || !sig) return false;
    const expected = await hmacHex(secret, `gop-preview:${expiry}`);
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

export function readCookie(header: string | null, name: string): string | null {
    for (const part of (header ?? '').split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k === name) return rest.join('=');
    }
    return null;
}
