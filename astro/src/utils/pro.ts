// Game on Paper Pro: the pure half -- the signed `gop_pro` cookie, the entitlement
// shape, the contract's formatting rules, the portal board's filters and the digest
// text. Storage (KV, R2, email) is resources/pro.ts. The data contract is gop-pro's
// docs/contract.md (schema 1); every rule below that says "match the PDF" is
// templates/profile.typ there.
//
// The cookie proves only that its holder could read mail at an address. What that
// address may see is the KV entitlement, re-read on every request (middleware.ts),
// so revoking access is deleting one key -- no cookie has to be chased down.

import { hmacHex } from './preview';
import { timingSafeEqual } from './adminSession';
import { formatPercent, roundNumber } from './misc';

export const PRO_COOKIE = 'gop_pro';
export const PRO_COOKIE_TTL_S = 30 * 24 * 60 * 60;
/** A magic link is good for 15 minutes and one use (resources/pro.ts redeemLoginToken). */
export const PRO_TOKEN_TTL_S = 15 * 60;
export const PRO_TIERS = ['analyst', 'pro', 'program', 'agency'] as const;
export type ProTier = typeof PRO_TIERS[number];

/** Bought on top of a tier (spec §3): the Portal Board add-on, Coach Dossiers. */
export const PRO_ADDONS = ['portal', 'dossier'] as const;
export type ProAddon = typeof PRO_ADDONS[number];

/** `pro:ent:<lowercased email>` in the SESSION KV. `team` is a Program license's school. */
export interface ProEntitlement { tier: ProTier; expires: string; team?: string; addons?: ProAddon[] }

/**
 * What a /pro path needs beyond a live entitlement (gop-pro spec v2 §3): the Portal Board
 * and its files and saved boards are the add-on; Scout Pack files are Pro seat / Program;
 * Coach Dossiers are bought separately. Everything else (profiles, search, methodology)
 * is open to any tier. null = no extra requirement.
 */
export function proRequirement(path: string): { tiers?: ProTier[]; addon?: ProAddon } | null {
    if (/^\/pro\/(portal|board)(\/|$)/.test(path) || /^\/pro\/file\/pro\/\d{4}\/portal\//.test(path)) return { addon: 'portal' };
    if (/^\/pro\/file\/pro\/\d{4}\/teams\//.test(path)) return { tiers: ['pro', 'program'] };
    if (/^\/pro\/file\/pro\/coaches\//.test(path)) return { addon: 'dossier' };
    return null;
}

export function proAllows(viewer: ProEntitlement, path: string): boolean {
    const need = proRequirement(path);
    if (!need) return true;
    if (need.tiers && !need.tiers.includes(viewer.tier)) return false;
    return !need.addon || (viewer.addons ?? []).includes(need.addon);
}

/** Downloads per viewer: Analyst gets 10 PDFs a month (spec §3); everyone is capped per day
 * so a subscription can't be used to mirror the whole bucket (PFF-derived data). */
export const PRO_ANALYST_PDFS_PER_MONTH = 10;
export const PRO_FILES_PER_DAY = 150;
/** What the middleware puts on `locals.pro` for an entitled viewer. */
export interface ProViewer extends ProEntitlement { email: string }

export function normalizeEmail(raw: unknown): string {
    return String(raw ?? '').trim().toLowerCase();
}

export function isEmail(email: string): boolean {
    return email.length <= 254 && /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(email);
}

/** The entitlement if it is well formed and unexpired at `now`, else null. */
export function activeEntitlement(raw: unknown, now = Date.now()): ProEntitlement | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as ProEntitlement;
    if (!(PRO_TIERS as readonly string[]).includes(e.tier)) return null;
    const exp = Date.parse(e.expires);
    if (!Number.isFinite(exp) || exp <= now) return null;
    // unknown add-on names are dropped, never trusted
    const addons = (Array.isArray(e.addons) ? e.addons : []).filter((a) => (PRO_ADDONS as readonly string[]).includes(a));
    return { ...e, addons };
}

// base64url, so an address's dots and plus signs cannot collide with the
// cookie's own `.` separators or the cookie syntax
function b64url(s: string): string {
    const bin = String.fromCharCode(...new TextEncoder().encode(s));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): string | null {
    try {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
        return null;
    }
}

/** `v1.<expiry>.<b64url email>.<hmac>`: the preview cookie's construction plus the address. */
export async function mintProCookie(email: string, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<string> {
    const expiry = nowS + PRO_COOKIE_TTL_S;
    return `v1.${expiry}.${b64url(email)}.${await hmacHex(secret, `gop-pro:${expiry}:${email}`)}`;
}

/** The address a valid, unexpired cookie was minted for, else null. */
export async function verifyProCookie(value: string | null | undefined, secret: string | undefined,
                                      nowS = Math.floor(Date.now() / 1000)): Promise<string | null> {
    if (!value || !secret) return null;
    const [v, expiryRaw, emailRaw, sig] = value.split('.');
    const expiry = Number(expiryRaw);
    if (v !== 'v1' || !Number.isFinite(expiry) || expiry <= nowS || !emailRaw || !sig) return null;
    const email = unb64url(emailRaw);
    if (!email) return null;
    const expected = await hmacHex(secret, `gop-pro:${expiry}:${email}`);
    return (await timingSafeEqual(sig, expected)) ? email : null;
}

/** A Pro path that renders for anyone the 'pro' flag lets in, entitled or not. */
export function isOpenProPath(path: string): boolean {
    return ['/pro/login', '/pro/auth', '/pro/logout', '/pro/methodology'].includes(path.replace(/\/$/, ''));
}

export function isProPath(path: string): boolean {
    return path === '/pro' || path.startsWith('/pro/');
}

// ---- formatting (contract.md "Formatting rules", matching the PDF) ----

/** gop-pro export.py METRIC_INFO: the banded metrics, in display order. */
export const PRO_METRIC_LABELS: Record<string, string> = {
    pass_EPAplay: 'EPA per dropback play',
    pass_success: 'Pass success rate',
    pass_comppct: 'Completion %',
    rush_EPAplay: 'EPA per rush',
    rush_success: 'Rush success rate',
    rec_EPAplay: 'EPA per target',
    rec_success: 'Success rate per target',
    rec_catchpct: 'Catch rate',
};

const signed = (s: string) => (s.startsWith('-') ? s : `+${s}`);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Keys ending `EPAplay` are signed 2-dp numbers; every other metric is a 0-1 rate as a 1-dp percent. */
export function formatProMetric(key: string, v: unknown): string {
    if (!isNum(v)) return '—';
    return key.endsWith('EPAplay') ? signed(roundNumber(v, 2, 2)) : formatPercent(v);
}

/** A change vs last season: `+0.16` for EPA, `+6.3 pts` for a rate, an em dash when not comparable. */
export function formatProDelta(key: string, v: unknown): string {
    if (!isNum(v)) return '—';
    return key.endsWith('EPAplay') ? signed(roundNumber(v, 2, 2)) : `${signed(roundNumber(v * 100, 1, 1))} pts`;
}

/** PFF figures print to 1 dp; a key ending `rate` is already a percent. */
export function formatPffValue(key: string, v: unknown): string {
    if (!isNum(v)) return '—';
    return key.endsWith('rate') ? `${roundNumber(v, 1, 1)}%` : roundNumber(v, 1, 1);
}

// ---- the portal board (pro/<season>/portal/board.json) ----

export interface BoardEntrant {
    espn_id: number | null
    name: string
    position: string
    from_team: string
    /** YYYY-MM-DD */
    entered: string
    stars: number | null
    status: string
    /** band midpoint percentile per metric key */
    band_mid: Record<string, number>
    pff_grade: number | null
    pff_grade_pct: number | null
    has_profile: boolean
}

export interface BoardFilters {
    /** one position, or all when absent */
    pos?: string
    /** a PRO_METRIC_LABELS key: sorts by its band, and `min` applies to it */
    metric?: string
    /** minimum band midpoint (0-100) on `metric` */
    min?: number
}

export const BOARD_SORTS = ['name', 'position', 'from', 'entered', 'stars', 'band', 'pff'] as const;
export type BoardSort = typeof BOARD_SORTS[number];

/** A row's identity for "my board": the ESPN id, or name + school for an unmatched entrant. */
export function entrantKey(e: BoardEntrant): string {
    return e.espn_id != null ? String(e.espn_id) : `${e.name}|${e.from_team}`;
}

/** Filters from a query string (or a saved object); anything malformed is dropped, never guessed. */
export function parseBoardFilters(q: URLSearchParams | Record<string, unknown> | null | undefined): BoardFilters {
    const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : (q as Record<string, unknown> | null)?.[k]);
    const out: BoardFilters = {};
    const pos = String(get('pos') ?? '').trim().toUpperCase();
    if (/^[A-Z]{1,4}$/.test(pos)) out.pos = pos;
    const metric = String(get('metric') ?? '');
    if (metric in PRO_METRIC_LABELS) out.metric = metric;
    const min = Number(get('min'));
    if (out.metric && get('min') !== '' && get('min') != null && Number.isFinite(min) && min >= 0 && min <= 100) out.min = min;
    return out;
}

export function filterBoard(rows: BoardEntrant[], f: BoardFilters): BoardEntrant[] {
    return rows.filter((e) => (!f.pos || e.position === f.pos)
        && (f.min === undefined || !f.metric || (e.band_mid?.[f.metric] ?? -1) >= f.min));
}

/**
 * Sorted copy. Names, positions and schools run A-Z; everything else runs
 * best/newest first. A missing value sorts last either way. `band` needs a metric:
 * without one it falls back to `entered`.
 */
export function sortBoard(rows: BoardEntrant[], sort: BoardSort | undefined, metric?: string): BoardEntrant[] {
    const s: BoardSort = sort === 'band' && !metric ? 'entered' : (sort ?? (metric ? 'band' : 'entered'));
    const val = (e: BoardEntrant): string | number | null => {
        switch (s) {
            case 'name': return e.name;
            case 'position': return e.position;
            case 'from': return e.from_team;
            case 'entered': return e.entered;
            case 'stars': return e.stars;
            case 'band': return e.band_mid?.[metric!] ?? null;
            case 'pff': return e.pff_grade;
        }
    };
    const asc = s === 'name' || s === 'position' || s === 'from';
    return rows.toSorted((a, b) => {
        const va = val(a), vb = val(b);
        if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
        if (vb === null || vb === undefined) return -1;
        const c = va < vb ? -1 : va > vb ? 1 : 0;
        return asc ? c : -c;
    });
}

/** "QB, EPA per dropback play band 50+" -- the filters in words, for the board and the digest. */
export function describeFilters(f: BoardFilters): string {
    const parts = [f.pos ?? 'All positions'];
    if (f.metric) parts.push(`${PRO_METRIC_LABELS[f.metric]} band${f.min !== undefined ? ` ${roundNumber(f.min, 0, 0)}+` : ''}`);
    return parts.join(', ');
}

// ---- the portal digest (plan 3.3) ----

/** Entrants who entered in [since, until) (YYYY-MM-DD) and match the saved filters. */
export function digestEntrants(rows: BoardEntrant[], since: string, until: string, f: BoardFilters): BoardEntrant[] {
    return sortBoard(filterBoard(rows.filter((e) => e.entered >= since && e.entered < until), f), undefined, f.metric);
}

/** The digest email's plain text, or null when nothing matched (no empty emails). */
export function digestText(rows: BoardEntrant[], f: BoardFilters, origin: string): string | null {
    if (rows.length === 0) return null;
    const lines = rows.map((e) => {
        const bits = [e.position, e.from_team, `entered ${e.entered}`];
        if (f.metric && e.band_mid?.[f.metric] !== undefined) bits.push(`band ${roundNumber(e.band_mid[f.metric], 0, 0)}`);
        if (e.pff_grade !== null && e.pff_grade !== undefined) bits.push(`PFF grade ${roundNumber(e.pff_grade, 1, 1)}`);
        const link = e.has_profile && e.espn_id != null ? `\n  ${origin}/pro/players/${e.espn_id}` : '';
        return `- ${e.name}: ${bits.join(', ')}${link}`;
    });
    const n = rows.length;
    return [
        `${n} new portal ${n === 1 ? 'entrant matches' : 'entrants match'} your filters (${describeFilters(f)}).`,
        '',
        ...lines,
        '',
        `Full board: ${origin}/pro/portal`,
        `Bands are 80% intervals among qualifiers. Not a valuation. Method: ${origin}/pro/methodology`,
        'To stop these emails, clear your saved filters on the board.',
    ].join('\n');
}
