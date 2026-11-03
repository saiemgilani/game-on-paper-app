// Game on Paper Pro: storage. Entitlements, login tokens, saved boards and saved
// filters live in the existing SESSION KV under a `pro:` prefix; the reports gop-pro
// renders live in the private `gop-pro` R2 bucket (binding PRO_BUCKET) and are only
// ever read here, server side, after the entitlement check (gop-pro docs/contract.md).
//
//   pro:ent:<email>      {tier, expires, team?}       written from /admin
//   pro:tok:<hex>        <email>, 15-minute TTL       one magic link, deleted on use
//   pro:board:<email>    ["<entrantKey>", ...]        "Save to my board"
//   pro:filters:<email>  {pos?, metric?, min?}        what the portal digest matches
//
// Outside a deployed Worker (astro dev, vitest) a missing R2 object falls back to the
// synthetic fixtures under test/fixtures/pro/, so nothing local depends on the real
// bucket or on any real PFF figure.

import { env } from 'cloudflare:workers';
import { CURRENT_YEAR } from '../utils/constants';
import {
    activeEntitlement, digestEntrants, digestText, parseBoardFilters, PRO_TOKEN_TTL_S,
    type BoardEntrant, type BoardFilters, type ProEntitlement,
} from '../utils/pro';

/** The season every Pro route reads: the site's current CFB season. */
export const PRO_SEASON = CURRENT_YEAR;

const kv = (): KVNamespace => (env as any).SESSION;

export async function readEntitlement(email: string, now = Date.now()): Promise<ProEntitlement | null> {
    if (!email) return null;
    return activeEntitlement(await kv().get(`pro:ent:${email}`, 'json'), now);
}

export async function writeEntitlement(email: string, ent: ProEntitlement): Promise<void> {
    await kv().put(`pro:ent:${email}`, JSON.stringify(ent));
}

export async function deleteEntitlement(email: string): Promise<void> {
    await kv().delete(`pro:ent:${email}`);
}

/** A fresh magic-link token for `email`, live for PRO_TOKEN_TTL_S. */
export async function createLoginToken(email: string): Promise<string> {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await kv().put(`pro:tok:${token}`, email, { expirationTtl: PRO_TOKEN_TTL_S });
    return token;
}

/**
 * The address a token was minted for, consuming it; null when unknown or expired.
 * ponytail: get-then-delete is not atomic across KV edges, so two clicks landing in
 * the same second at different PoPs could both log in -- the same address either
 * way. A Durable Object makes it strict if that ever matters.
 */
export async function redeemLoginToken(token: string | null | undefined): Promise<string | null> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const key = `pro:tok:${token}`;
    const email = await kv().get(key);
    if (!email) return null;
    await kv().delete(key);
    return email;
}

export async function readBoard(email: string): Promise<string[]> {
    const raw = await kv().get(`pro:board:${email}`, 'json');
    return Array.isArray(raw) ? raw.map(String) : [];
}

export async function writeBoard(email: string, keys: string[]): Promise<void> {
    await kv().put(`pro:board:${email}`, JSON.stringify([...new Set(keys)].slice(0, 500)));
}

export async function readFilters(email: string): Promise<BoardFilters | null> {
    const raw = await kv().get(`pro:filters:${email}`, 'json');
    return raw ? parseBoardFilters(raw as Record<string, unknown>) : null;
}

export async function writeFilters(email: string, f: BoardFilters | null): Promise<void> {
    if (f) await kv().put(`pro:filters:${email}`, JSON.stringify(f));
    else await kv().delete(`pro:filters:${email}`);
}

/**
 * Send one plain-text email through Resend's HTTP API when RESEND_API_KEY is set;
 * otherwise, locally, log it (the magic link appears in the dev terminal). A deployed
 * Worker without the key logs only that it could not send: a login link in the
 * Worker logs would be a credential anyone with log access could use. Never throws.
 */
export async function sendEmail(msg: { to: string; subject: string; text: string; replyTo?: string }): Promise<boolean> {
    const key = (env as any).RESEND_API_KEY as string | undefined;
    if (!key) {
        if (LOCAL) {
            console.info(`[pro email, not sent: RESEND_API_KEY unset] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
            return true;
        }
        console.error(`[pro email] RESEND_API_KEY unset: "${msg.subject}" not sent`);
        return false;
    }
    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: (env as any).PRO_EMAIL_FROM || 'Game on Paper <pro@gameonpaper.com>',
                to: [msg.to], subject: msg.subject, text: msg.text,
                ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) console.error(`[pro email] Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
        return r.ok;
    } catch (err) {
        console.error(`[pro email] ${err}`);
        return false;
    }
}

const LOCAL = import.meta.env.DEV || import.meta.env.MODE === 'test';

// The synthetic stand-in for the bucket: test/fixtures/pro/<key without "pro/">.
async function fixtureText(key: string): Promise<string | null> {
    const files = import.meta.glob('../../test/fixtures/pro/**/*.{json,csv}', { query: '?raw', import: 'default' });
    const load = files[`../../test/fixtures/pro/${key.replace(/^pro\//, '')}`];
    return load ? ((await load()) as string) : null;
}

/** An R2 key a caller may ask for: under pro/, no traversal, no oddities. */
export function isProKey(key: string): boolean {
    return /^pro\/[A-Za-z0-9_\-/]+\.(json|pdf|csv)$/.test(key) && !key.includes('//') && !key.includes('..');
}

/** A JSON artifact from the bucket, parsed; null when missing or unreadable. */
export async function proObject<T = unknown>(key: string): Promise<T | null> {
    try {
        const obj = await (env as any).PRO_BUCKET?.get(key);
        if (obj) return (await obj.json()) as T;
        if (LOCAL) {
            const text = await fixtureText(key);
            return text === null ? null : (JSON.parse(text) as T);
        }
    } catch (err) {
        console.error(`[pro] read ${key}: ${err}`);
    }
    return null;
}

const CONTENT_TYPES: Record<string, string> = { pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', json: 'application/json' };

/** A file to stream to an entitled viewer (the route checks entitlement first). */
export async function proFile(key: string): Promise<{ body: BodyInit; contentType: string } | null> {
    const contentType = CONTENT_TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream';
    const obj = await (env as any).PRO_BUCKET?.get(key);
    if (obj) return { body: obj.body, contentType };
    if (LOCAL) {
        const text = await fixtureText(key);
        if (text !== null) return { body: text, contentType };
    }
    return null;
}

/**
 * The 7 a.m. portal digest (plan 3.3): every entitled user with saved filters gets
 * the entrants who entered in [since, until) that match them -- yesterday, from the
 * cron, so no entrant is mailed twice. Called from worker.ts only when
 * PRO_DIGEST_ENABLED is "1"; `send` is injectable so a dry run sends nothing.
 * ponytail: lists every pro:filters: key each morning -- fine into the low
 * thousands of users; a per-filter index if it ever is not.
 */
export async function runProDigest(since: string, until: string, origin = 'https://gameonpaper.com',
                                   send: typeof sendEmail = sendEmail): Promise<number> {
    const board = await proObject<{ entrants?: BoardEntrant[] }>(`pro/${PRO_SEASON}/portal/board.json`);
    const rows = board?.entrants ?? [];
    let sent = 0;
    let cursor: string | undefined;
    do {
        const page: any = await kv().list({ prefix: 'pro:filters:', cursor });
        for (const { name } of page.keys as { name: string }[]) {
            const email = name.slice('pro:filters:'.length);
            if (!(await readEntitlement(email))) continue;
            const f = await readFilters(email);
            if (!f) continue;
            const text = digestText(digestEntrants(rows, since, until, f), f, origin);
            if (text && await send({ to: email, subject: 'Portal digest: new entrants on your board filters', text })) sent++;
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return sent;
}
