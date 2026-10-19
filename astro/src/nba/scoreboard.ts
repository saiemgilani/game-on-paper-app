// Pure helpers for /nba/scoreboard: ordering, status copy, the ?date= contract and day stepping.
// No I/O here; routes/nba/scoreboard.ts does the fetching.
import { DateTime } from 'luxon';
import type { ESPNCompetitor, ESPNScheduleEvent, ESPNStatus } from '../resources/espn';
import { FIRST_SEASON } from './seasonRange';
import type { DarkLogoStrategy, PeriodKind, ScoreboardGroups } from '../basketball/config';
import { espnLogoLeague, type League } from '../utils/league';
import { endOfPeriodText, finalText, periodShort } from '../basketball/periods';

const LIVE = ['STATUS_IN_PROGRESS', 'STATUS_END_PERIOD', 'STATUS_HALFTIME'];

function rank(e: ESPNScheduleEvent): number {
    const t = e.status?.type;
    const n = t?.name ?? '';
    // state 'in' catches a mid-game delay or suspension; a pre-game delay is state 'pre' and stays scheduled.
    if (t?.state === 'in' || LIVE.includes(n)) return 0;
    if (n === 'STATUS_SCHEDULED' || (n === 'STATUS_DELAYED' && t?.state === 'pre')) return 1;
    if (n === 'STATUS_POSTPONED' || n === 'STATUS_CANCELED') return 3;
    return 2;
}

/** In-progress games first, then scheduled by tip time, then everything else by tip time. */
export function sortScoreboard(events: ESPNScheduleEvent[]): ESPNScheduleEvent[] {
    return [...events].sort((a, b) => rank(a) - rank(b) || String(a.date).localeCompare(String(b.date)));
}

/** The one line under the teams: tip time is rendered elsewhere, so 'scheduled' carries no text. */
export function statusLine(status: ESPNStatus, regulation = 4, kind: PeriodKind = 'quarter'): { kind: 'scheduled' | 'live' | 'final' | 'other'; text: string } {
    const name = status?.type?.name ?? '';
    const detail = status?.type?.detail ?? '';
    const period = Number(status?.period ?? 0);
    const hasPeriod = period >= 1; // !(>= 1) also catches NaN
    if (name === 'STATUS_SCHEDULED') return { kind: 'scheduled', text: '' };
    if (name === 'STATUS_FINAL') return { kind: 'final', text: finalText(period, regulation, kind) };
    if (name === 'STATUS_HALFTIME') return { kind: 'live', text: 'Halftime' };
    if (name === 'STATUS_END_PERIOD') return { kind: 'live', text: !hasPeriod ? detail : endOfPeriodText(period, regulation, kind) };
    if (LIVE.includes(name)) {
        if (!hasPeriod) return { kind: 'live', text: detail };
        const clock = String(status.displayClock ?? '').trim();
        return { kind: 'live', text: [periodShort(period, regulation, kind), clock].filter(Boolean).join(' ') };
    }
    return { kind: 'other', text: detail };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The ?date= contract: ISO day, real, within [firstDay, today + 14 days]. firstDay defaults to the NBA's 1997-10-01. */
export function parseDateParam(raw: string | null, today: string, firstDay = `${FIRST_SEASON - 1}-10-01`): { ok: true; date: string } | { ok: false; reason: 'format' | 'calendar' | 'range' } {
    if (raw == null || raw === '') return { ok: true, date: today };
    if (!ISO.test(raw)) return { ok: false, reason: 'format' };
    const d = DateTime.fromISO(raw, { zone: 'utc' });
    if (!d.isValid) return { ok: false, reason: 'calendar' };
    const floor = DateTime.fromISO(firstDay, { zone: 'utc' });
    const ceil = DateTime.fromISO(today, { zone: 'utc' }).plus({ days: 14 });
    if (d < floor || d > ceil) return { ok: false, reason: 'range' };
    return { ok: true, date: raw };
}

/** Previous and next calendar day plus the heading. Dates are days, so UTC arithmetic is exact. */
export function dayNav(day: string): { prev: string; next: string; label: string } {
    const d = DateTime.fromISO(day, { zone: 'utc' });
    return { prev: d.minus({ days: 1 }).toISODate()!, next: d.plus({ days: 1 }).toISODate()!, label: d.setLocale('en-US').toFormat('cccc, LLLL d') };
}

/** '2026-01-14' -> 'Jan 14', the same English formatter as the heading. */
export function shortDay(day: string): string {
    return DateTime.fromISO(day, { zone: 'utc' }).setLocale('en-US').toFormat('LLL d');
}

/** '2026-10-11' -> '20261011', the cdn scoreboard's &date= form. */
export function toEspnDate(iso: string): string {
    return iso.replaceAll('-', '');
}

/** ESPN's lower-case spellings of the 30 teams, each verified to serve nba/500-dark/<abbr>.png. */
export const NBA_DARK_LOGO_ABBRS: ReadonlySet<string> = new Set(
    'atl bos bkn cha chi cle dal den det gs hou ind lac lal mem mia mil min no ny okc orl phi phx por sac sa tor utah wsh'.split(' '));

/** Dark-mode logo rules, only for numeric team ids (and, for 'abbr', allowlisted abbreviations); nothing raw reaches the style block. */
export function darkLogoCss(
    teams: Iterable<{ id?: unknown; abbreviation?: unknown; season?: number | null } | undefined>,
    strategy: DarkLogoStrategy = { kind: 'abbr', logoLeague: 'nba', abbrs: NBA_DARK_LOGO_ABBRS },
): string {
    if (strategy.kind === 'none') return '';
    const seen = new Map<string, string>();
    for (const t of teams) {
        const id = String(t?.id ?? ''), ab = String(t?.abbreviation ?? '').toLowerCase();
        if (!/^\d+$/.test(id)) continue;
        if (strategy.kind === 'id') seen.set(id, id);
        else if (strategy.kind === 'idKeyed') { const k = strategy.abbrById[strategy.logoId ? strategy.logoId(id, t?.season) : id]; if (k) seen.set(id, k); }
        else if (strategy.abbrs.has(ab)) seen.set(id, ab);
    }
    return [...seen].map(([id, key]) => `img.team-logo-${id}{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/${strategy.logoLeague}/500-dark/${key}.png&h=120&w=120')}`).join('');
}

export interface ScoreboardGroupChoice { key: string; espn: string | null; label: string }
/**
 * The ?group= contract for a league with scoreboard groups (spec D3): absent / 'top25' is ESPN's ungrouped board (the games with
 * a ranked team), 'all' its every-team group, or one of ESPN's conference ids. Anything else is null (a 400 before any upstream
 * call, so junk never mints a cache key).
 */
export function scoreboardGroupOf(groups: ScoreboardGroups, raw: string | null): ScoreboardGroupChoice | null {
    if (raw == null || raw === '' || raw === groups.default) return { key: groups.default, espn: null, label: 'Top 25' };
    if (raw === 'all') return { key: 'all', espn: groups.all, label: 'Division I' };
    const c = groups.conferences.find((g) => g.id === raw);
    return c ? { key: c.id, espn: c.id, label: c.label } : null;
}

/** The scoreboard keys no card reads; a D-I day drops from 2.73 MB to 1.77 MB of events (2024-11-04, 199 games). */
export function trimScoreboardEvents(events: ESPNScheduleEvent[]): ESPNScheduleEvent[] {
    return events.map((e) => {
        const { links: _l, ...rest } = e as ESPNScheduleEvent & { links?: unknown };
        return {
            ...rest,
            competitions: e.competitions.map((c) => {
                const { highlights: _h, headlines: _hd, geoBroadcasts: _g, ...cr } = c as typeof c & { highlights?: unknown; headlines?: unknown; geoBroadcasts?: unknown };
                return { ...cr, competitors: c.competitors.map(({ statistics: _s, linescores: _ls, ...r }: any) => r) };
            }),
        } as ESPNScheduleEvent;
    });
}

/** ESPN gives a college competitor `team.logo` exactly when its logo exists (435 teams measured 2026-10-12); others draw the default shield. */
export function hasEspnLogo(c: { team?: { logo?: unknown } } | undefined, league: League): boolean {
    return espnLogoLeague(league) !== 'ncaa' || !!c?.team?.logo;
}

export type StatusSectionKey = 'live' | 'upcoming' | 'final';
export interface StatusSection { key: StatusSectionKey; label: 'Live' | 'Upcoming' | 'Final'; events: ESPNScheduleEvent[] }
const SECTIONS = [['live', 'Live'], ['upcoming', 'Upcoming'], ['final', 'Final']] as const;
/**
 * D36: a day's games by ESPN's status state (`in` live, `pre` upcoming, anything else final, including postponed and
 * cancelled, whose card shows its own status line). Non-empty sections only, in that order; ESPN's order inside each.
 */
export function statusSections(events: ESPNScheduleEvent[]): StatusSection[] {
    const keyOf = (e: ESPNScheduleEvent): StatusSectionKey => {
        const state = (e.competitions[0]?.status as { type?: { state?: string } } | undefined)?.type?.state;
        return state === 'in' ? 'live' : state === 'pre' ? 'upcoming' : 'final';
    };
    return SECTIONS.map(([key, label]) => ({ key, label, events: events.filter((e) => keyOf(e) === key) })).filter((s) => s.events.length > 0);
}

/** The scoreboard competitor's leaders block: points, rebounds, assists as '26 C. Anthony'. */
export function gameLeaders(comp: ESPNCompetitor): { pts?: string; reb?: string; ast?: string } {
    const out: { pts?: string; reb?: string; ast?: string } = {};
    const keys: Record<string, 'pts' | 'reb' | 'ast'> = { points: 'pts', rebounds: 'reb', assists: 'ast' };
    for (const block of comp?.leaders ?? []) {
        const k = keys[block?.name];
        const top = block?.leaders?.[0];
        if (k && top?.displayValue && top?.athlete?.shortName) out[k] = `${top.displayValue} ${top.athlete.shortName}`;
    }
    return out;
}

/** The scoreboard day a game belongs to (its tip in America/New_York): `/nba/scoreboard?date=`, or the bare page when that day is out of range. */
export function scoreboardBackHref(gameDate: string | null | undefined, today: string = DateTime.now().setZone('America/New_York').toISODate()!): string {
    const day = gameDate ? DateTime.fromISO(gameDate).setZone('America/New_York').toISODate() : null;
    return day && parseDateParam(day, today).ok ? `/nba/scoreboard?date=${day}` : '/nba/scoreboard';
}
