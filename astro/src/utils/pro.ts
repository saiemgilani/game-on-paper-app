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
import { cleanTextForTeam, formatPercent, roundNumber } from './misc';

export const PRO_COOKIE = 'gop_pro';
export const PRO_COOKIE_TTL_S = 30 * 24 * 60 * 60;
/** A magic link is good for 15 minutes and one use (resources/pro.ts redeemLoginToken). */
export const PRO_TOKEN_TTL_S = 15 * 60;
/** After a token is spent, the browser that spent it may finish again for this long: a
 * sign-in whose response never arrived. Any other browser is refused at once. */
export const PRO_AUTH_RETRY_S = 5 * 60;
/** The per-browser nonce cookie /pro/auth's GET sets, which ties a spent token to its browser. */
// __Host-: the browser takes it only Secure, host-only and Path=/, so a sibling *.gameonpaper.com
// host can't plant a nonce of its own choosing for this one to reuse
export const PRO_AUTH_NONCE_COOKIE = '__Host-gop_pro_auth';
export const PRO_TIERS = ['analyst', 'pro', 'program', 'agency'] as const;
export type ProTier = typeof PRO_TIERS[number];

/** Bought on top of a tier (spec §3): the Portal Board add-on, Coach Dossiers. */
export const PRO_ADDONS = ['portal', 'dossier'] as const;
export type ProAddon = typeof PRO_ADDONS[number];

/** `pro:ent:<lowercased email>` in the SESSION KV. `team` is a Program license's school. */
export interface ProEntitlement { tier: ProTier; expires: string; team?: string; addons?: ProAddon[] }

/**
 * What a /pro path needs beyond a live entitlement (gop-pro spec v2 §3): the Portal Board
 * and its files and saved boards are the add-on; Scout Pack files are Pro / Program;
 * Coach Dossiers are bought separately. Everything else (profiles, search, methodology)
 * is open to any tier. null = no extra requirement.
 */
export function proRequirement(path: string): { tiers?: ProTier[]; addon?: ProAddon } | null {
    if (/^\/pro\/(portal|board)(\/|$)/.test(path) || /^\/pro\/file\/pro\/\d{4}\/portal\//.test(path)) return { addon: 'portal' };
    if (/^\/pro\/file\/pro\/\d{4}\/teams\//.test(path)) return { tiers: ['pro', 'program'] };
    if (/^\/pro\/file\/pro\/coaches\//.test(path)) return { addon: 'dossier' };
    // Plans split by side of the deal (pricing): Pro and Program are the program side, Analyst and
    // Agency the player side. Roster and position valuation are program-side; the talent market is
    // for both sides above Analyst.
    if (/^\/pro\/(rosters|positions)(\/|$)/.test(path)
        || /^\/pro\/file\/pro\/\d{4}\/(rosters|positions)\//.test(path)) return { tiers: ['pro', 'program'] };
    if (/^\/pro\/market(\/|$)/.test(path) || /^\/pro\/file\/pro\/\d{4}\/market\//.test(path)) return { tiers: ['pro', 'program', 'agency'] };
    // a role report (page or file) opens by its reader: the agent and player reports to every tier,
    // the program-side ones (team, collective, AD) to Pro and Program. Anything else under roles/ (an
    // unknown kind, an empty segment, a bare /roles/team) is closed; only the index itself is open.
    const role = /^\/pro\/(?:file\/pro\/)?roles\/(.+)$/.exec(path);
    const kind = role?.[1].split(/[/.]/)[0];
    if (role && !(isRoleKind(kind) && ROLE_KINDS[kind].everyTier)) return { tiers: ['pro', 'program'] };
    return null;
}

/**
 * gop-pro roles.py: one report family per reader, keyed `pro/roles/<kind>/<key>.json`.
 * `everyTier`: open to Analyst too, because its readers (agents, families) are Analyst's buyers (spec §3).
 */
export const ROLE_KINDS = {
    team: { title: 'Program History', reader: 'coaches and general managers', everyTier: false },
    collective: { title: 'Budget and Allocation', reader: 'NIL collectives', everyTier: false },
    ad: { title: 'Program Benchmark', reader: 'athletic directors', everyTier: false },
    agent: { title: 'Market History', reader: 'agents and player representatives', everyTier: true },
    player: { title: 'Career and Market', reader: 'players and families', everyTier: true },
} as const;
export type RoleKind = keyof typeof ROLE_KINDS;

export function isRoleKind(k: unknown): k is RoleKind {
    return typeof k === 'string' && Object.hasOwn(ROLE_KINDS, k);
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

// ---- valuation (contract schema 2 `value`, and the rosters/positions/market reports) ----

/** Model dollars as the PDFs print them: $1.23M, $456K; a model estimate, never a deal. */
export function formatUsd(v: unknown): string {
    if (!isNum(v)) return '—';
    return Math.abs(v) >= 1e6 ? `$${roundNumber(v / 1e6, 2, 2)}M` : `$${roundNumber(v / 1e3, 0, 0)}K`;
}

/** A 0-1 probability as a whole percent. */
export function formatOdds(v: unknown): string {
    return isNum(v) ? `${Math.round(v * 100)}%` : '—';
}

export const VALUE_UNITS: Record<string, string> = {
    QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', OL: 'Offensive line',
    IDL: 'Interior defensive line', EDGE: 'Edge rushers', LB: 'Linebackers', CB: 'Cornerbacks', S: 'Safeties',
};

/** One player row in a valuation report (reports.py player_row). */
export interface ValuePlayer {
    espn_id: number; name: string; team: string; unit: string; class: string | null; source: string
    stars: number | null; age: number | null; pct: number | null; proj: number | null; proj_lo: number | null
    proj_hi: number | null; prod_usd: number | null; proj_usd: number | null; started: boolean; departing: boolean
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
    /** gop-pro valuation as of the cycle's season (contract: portal board `value`); null when unmatched */
    value?: BoardValue | null
}

export interface BoardValue {
    unit: string; route: string; age: number | null; pct: number | null; prod_usd: number | null
    proj: number | null; proj_lo: number | null; proj_hi: number | null; proj_usd: number | null
    variant: string; at_destination: boolean; scarcity: number | null
    /** what he did the next season, once it exists: the board's own backtest */
    realized: { team: string; pct: number | null; prod_usd: number | null; started: boolean } | null
}

export interface BoardFilters {
    /** one position, or all when absent */
    pos?: string
    /** a PRO_METRIC_LABELS key: sorts by its band, and `min` applies to it */
    metric?: string
    /** minimum band midpoint (0-100) on `metric` */
    min?: number
}

export const BOARD_SORTS = ['name', 'position', 'from', 'entered', 'stars', 'band', 'pff', 'prod', 'next', 'projusd'] as const;
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
            case 'prod': return e.value?.prod_usd ?? null;
            case 'next': return e.value?.proj ?? null;
            case 'projusd': return e.value?.proj_usd ?? null;
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

// ---- compare and export (the Analyst tier: "compare, export of derived metrics") ----

export const PRO_COMPARE_MAX = 4;

/** `?ids=1,2,3`: up to four distinct ESPN ids, in the order given; anything else is dropped. */
export function parseCompareIds(raw: unknown): string[] {
    const ids = String(raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,10}$/.test(s));
    return [...new Set(ids)].slice(0, PRO_COMPARE_MAX);
}

/** The slice of a profile (contract schema 2) that compare and export read. */
export interface CompareProfile {
    season: number
    player: { espn_id: number; name: string | null; team: string | null; team_id: number | null; position: string | null }
    metrics: { key: string; label: string; value: number | null; n: number | null; n_label: string
        band_lo: number | null; band_mid: number | null; band_hi: number | null; delta_eb: number | null }[]
    value?: { unit: string; age: number | null; production_usd_pace: number | null; projected_usd: number | null
        projected_usd_lo: number | null; projected_usd_hi: number | null; p_start_next: number | null
        projection: { pct: number | null; lo: number | null; hi: number | null } } | null
}

/** Every metric any of the players has, in first-seen order, with each player's row or null. */
export function compareMetricRows(docs: CompareProfile[]): { key: string; label: string; cells: (CompareProfile['metrics'][number] | null)[] }[] {
    const order = new Map<string, string>();
    for (const d of docs) for (const m of d.metrics ?? []) if (!order.has(m.key)) order.set(m.key, m.label);
    return [...order].map(([key, label]) => ({ key, label, cells: docs.map((d) => d.metrics?.find((m) => m.key === key) ?? null) }));
}

const csvCell = (v: unknown): string => {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    // a text cell a spreadsheet would run as a formula (= + - @, or a leading tab or CR, OWASP's
    // list) gets a leading quote; numbers keep their sign
    const s = typeof v === 'string' && /^(\s*[=+\-@]|[\t\r])/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One CSV row per player: identity, each efficiency metric with its sample, 80% percentile
 * band and change, and the valuation. Derived figures only: no PFF grade or count leaves in
 * a file (contract.md, as on the portal board's CSV), so `pff` and `volume` are never read.
 */
export function compareCsv(docs: CompareProfile[]): string {
    const metrics = compareMetricRows(docs).map((r) => r.key);
    const head = ['espn_id', 'name', 'team', 'position', 'season',
        ...metrics.flatMap((k) => [k, `${k}_n`, `${k}_band_lo`, `${k}_band_mid`, `${k}_band_hi`, `${k}_change`]),
        'unit', 'production_usd_pace', 'projected_usd', 'projected_usd_lo', 'projected_usd_hi',
        'projection_pct', 'projection_lo', 'projection_hi', 'p_start_next', 'age'];
    const rows = docs.map((d) => {
        const by = new Map((d.metrics ?? []).map((m) => [m.key, m]));
        const v = d.value ?? null;
        return [d.player.espn_id, cleanTextForTeam(d.player.name, d.player.team_id), cleanTextForTeam(d.player.team, d.player.team_id), d.player.position, d.season,
            ...metrics.flatMap((k): (string | number | null)[] => {
                const m = by.get(k);
                return m ? [m.value, m.n, m.band_lo, m.band_mid, m.band_hi, m.delta_eb] : ['', '', '', '', '', ''];
            }),
            v?.unit, v?.production_usd_pace, v?.projected_usd, v?.projected_usd_lo, v?.projected_usd_hi,
            v?.projection?.pct, v?.projection?.lo, v?.projection?.hi, v?.p_start_next, v?.age];
    });
    return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
