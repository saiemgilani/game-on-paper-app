// Admin login session: a signed, expiring cookie minted by /admin/api/login so
// the admin panel gets a real login page instead of the browser's basic-auth
// popup. Same HMAC construction as the preview cookie, different purpose
// string. Basic auth still works everywhere (the purge workflow curls with
// -u); the cookie is just the browser-friendly path.

export const ADMIN_COOKIE = 'gop_admin';
export const ADMIN_SESSION_TTL_S = 12 * 60 * 60;

async function hmacHex(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintAdminCookie(secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
    const expiry = nowS + ADMIN_SESSION_TTL_S;
    return `v1.${expiry}.${await hmacHex(secret, `gop-admin:${expiry}`)}`;
}

export async function verifyAdminCookie(value: string | undefined | null, secret: string | undefined,
                                        nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
    if (!value || !secret) return false;
    const [v, expiryRaw, sig] = value.split('.');
    const expiry = Number(expiryRaw);
    if (v !== 'v1' || !Number.isFinite(expiry) || expiry <= nowS || !sig) return false;
    const expected = await hmacHex(secret, `gop-admin:${expiry}`);
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
