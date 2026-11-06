// Game on Paper Pro: storage. Entitlements, login tokens, saved boards and saved
// filters live in the existing SESSION KV under a `pro:` prefix; the reports gop-pro
// renders live in the private `gop-pro` R2 bucket (binding PRO_BUCKET) and are only
// ever read here, server side, after the entitlement check (gop-pro docs/contract.md).
// The site writes only two small object families to the bucket, both outside `pro/`:
// the download counter and spent-magic-link markers.
//
//   pro:ent:<email>      {tier, expires, team?}       written from /admin
//   pro:tok:<hex>        <email>, 15-minute TTL       one magic link (spent by its R2 marker)
//   pro:board:<email>    ["<entrantKey>", ...]        "Save to my board"
//   pro:filters:<email>  {pos?, metric?, min?}        what the portal digest matches
//   R2 quota/dl/<sha256(email)>.json  {day, n, month, pdf}   claimDownload's counter
//   R2 auth/tok/<sha256(token)>.json  {n: sha256(nonce), at}  a spent magic link (swept daily)
//
// Outside a deployed Worker (astro dev, vitest) a missing R2 object falls back to the
// synthetic fixtures under test/fixtures/pro/, so nothing local depends on the real
// bucket or on any real PFF figure.

import { env } from 'cloudflare:workers';
import { CURRENT_YEAR } from '../utils/constants';
import {
    activeEntitlement, digestEntrants, digestText, parseBoardFilters, PRO_ANALYST_PDFS_PER_MONTH,
    PRO_AUTH_RETRY_S, PRO_FILES_PER_DAY, PRO_TOKEN_TTL_S, type BoardEntrant, type BoardFilters, type ProEntitlement,
    type ProViewer,
} from '../utils/pro';

/** The season every Pro route reads: the site's current CFB season. */
export const PRO_SEASON = CURRENT_YEAR;

const kv = (): KVNamespace => (env as any).SESSION;
const bucket = (): R2Bucket | undefined => (env as any).PRO_BUCKET;

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

/** One sign-in email per address per minute (KV's shortest TTL), so knowing a subscriber's
 * address is not enough to flood their inbox. true = may send now (and starts the cooldown). */
export async function claimLoginSend(email: string): Promise<boolean> {
    const key = `pro:cool:${email}`;
    if (await kv().get(key)) return false;
    await kv().put(key, '1', { expirationTtl: 60 });
    return true;
}

/**
 * The address a token was minted for, spending it; null when unknown, expired, or spent.
 *
 * One use, strictly: spending a token is a create-only R2 write of its marker
 * (`auth/tok/<sha256(token)>.json`, `etagDoesNotMatch: '*'`). R2 commits that atomically
 * and strongly consistently, so two POSTs anywhere in the world can't both spend it (a KV
 * get-then-delete could: KV has no compare-and-set and a delete takes up to 60 s to reach
 * other PoPs). The KV entry is left to its 15-minute TTL, so nothing works past that.
 *
 * Retry-safe: `nonce` is the `gop_pro_auth` cookie the GET gave this browser. The marker
 * keeps its hash, so the SAME browser may spend the token again within PRO_AUTH_RETRY_S
 * of the first spend (a POST whose response was lost: closed tab, dropped connection).
 * Any other browser, or the same one after the window, gets null. A GET never calls this.
 */
export async function redeemLoginToken(token: string | null | undefined, nonce: string | null | undefined,
                                       now = Date.now()): Promise<string | null> {
    if (!token || !/^[0-9a-f]{64}$/.test(token) || !nonce || !/^[0-9a-f]{64}$/.test(nonce)) return null;
    const email = await kv().get(`pro:tok:${token}`);
    if (!email) return null;
    const b = bucket();
    if (!b) return LOCAL ? email : null;  // no bucket outside a Worker: no one-time check locally
    const key = `auth/tok/${await sha256Hex(token)}.json`;
    const n = await sha256Hex(nonce);
    if (await b.put(key, JSON.stringify({ n, at: now }), { onlyIf: { etagDoesNotMatch: '*' } })) return email;
    // already spent: only the browser that spent it, and only inside the window
    const prior = (await (await b.get(key))?.json().catch(() => null)) as { n?: string; at?: number } | null;
    return prior?.n === n && typeof prior.at === 'number' && now - prior.at <= PRO_AUTH_RETRY_S * 1000 ? email : null;
}

/** Delete spent-magic-link markers older than a day (their tokens died after 15 minutes). */
export async function sweepLoginMarkers(now = Date.now()): Promise<number> {
    const b = bucket();
    if (!b) return 0;
    let swept = 0;
    let cursor: string | undefined;
    do {
        const page = await b.list({ prefix: 'auth/tok/', cursor });
        const old = page.objects.filter((o) => now - o.uploaded.getTime() > 86_400_000).map((o) => o.key);
        if (old.length) { await b.delete(old); swept += old.length; }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return swept;
}

/**
 * Count one file download against the viewer's quotas; false = over quota (nothing counted).
 * Daily cap for everyone, plus Analyst's 10 PDFs a month. The counter is one R2 object per
 * viewer (`quota/dl/<sha256(email)>.json`, outside `pro/`, so isProKey never serves it and
 * gop-pro's publish never touches it), advanced with R2's conditional put: R2 commits
 * `etagMatches` / `etagDoesNotMatch: '*'` atomically, so two parallel downloads can't both
 * take the last slot. KV can't do that (no compare-and-set, and a read can be up to 60 s
 * stale at another PoP). Losing the race retries; persistent contention fails closed.
 */
export async function claimDownload(viewer: ProViewer, key: string, now = new Date()): Promise<boolean> {
    const b = bucket();
    if (!b) return LOCAL;  // no bucket outside a Worker: no quota locally, none granted in production
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const metered = viewer.tier === 'analyst' && key.endsWith('.pdf');
    const objKey = `quota/dl/${await sha256Hex(viewer.email)}.json`;
    for (let attempt = 0; attempt < 5; attempt++) {
        const cur = await b.get(objKey);
        let q: { day?: string; n?: number; month?: string; pdf?: number } = {};
        if (cur) {
            // an unreadable counter must not read as zero (that would reset the day and the month);
            // refuse, and replace it with a full one, so it clears itself at the next rollover
            try { q = await cur.json(); } catch (err) {
                console.error(`[pro quota] unreadable counter: ${err}`);
                await b.put(objKey, JSON.stringify({ day, n: PRO_FILES_PER_DAY, month, pdf: PRO_ANALYST_PDFS_PER_MONTH }),
                    { onlyIf: { etagMatches: cur.etag } });
                return false;
            }
        }
        const nDay = q.day === day ? Number(q.n) || 0 : 0;
        const nMonth = q.month === month ? Number(q.pdf) || 0 : 0;
        if (nDay >= PRO_FILES_PER_DAY || (metered && nMonth >= PRO_ANALYST_PDFS_PER_MONTH)) return false;
        const next = JSON.stringify({ day, n: nDay + 1, month, pdf: nMonth + (metered ? 1 : 0) });
        const put = await b.put(objKey, next, { onlyIf: cur ? { etagMatches: cur.etag } : { etagDoesNotMatch: '*' } });
        if (put) return true;
    }
    return false;
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

/**
 * An R2 key a viewer may download through /pro/file: a PDF or CSV under pro/, no traversal, no
 * oddities. Never JSON: a profile's JSON carries PFF grades and counts, which no file may hand out
 * (contract.md); pages read the JSON server side through proObject instead.
 */
export function isProKey(key: string): boolean {
    return /^pro\/[A-Za-z0-9_\-/]+\.(pdf|csv)$/.test(key) && !key.includes('//') && !key.includes('..');
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

/** scarcity: the cycle's live table (P4 jobs opening per starter-caliber entrant); check: the board's
 * own backtest once the next season exists. Both from gop-pro portal.py, both optional. */
export type PortalBoard = {
    rendered: string; window?: string; entrants: BoardEntrant[]
    scarcity?: { unit: string; jobs: number | null; supply: number | null; scarcity: number | null }[]
    check?: { unit: string; n: number; rmse: number; rmse_same: number; cover80: number; variant: string }[]
};

/** The newest portal board: this cycle's once its window opens, else the last cycle's
 * (a cycle is keyed by its fall season: 2025-26 is pro/2025/portal). */
export async function latestBoard(season = PRO_SEASON): Promise<{ season: number; board: PortalBoard } | null> {
    for (const s of [season, season - 1]) {
        const board = await proObject<PortalBoard>(`pro/${s}/portal/board.json`);
        if (board) return { season: s, board };
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
