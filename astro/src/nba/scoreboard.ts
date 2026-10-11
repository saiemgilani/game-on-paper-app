// Pure helpers for /nba/scoreboard: ordering, status copy, the ?date= contract and day stepping.
// No I/O here; routes/nba/scoreboard.ts does the fetching.
import { DateTime } from 'luxon';
import type { ESPNCompetitor, ESPNScheduleEvent, ESPNStatus } from '../resources/espn';
import { FIRST_SEASON } from './seasonRange';

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

const ORD = ['', '1st', '2nd', '3rd', '4th'];
/** 'Q3', 'OT', '2OT' for a period number. */
function periodLabel(period: number): string {
    if (period <= 4) return `Q${period}`;
    return period === 5 ? 'OT' : `${period - 4}OT`;
}

/** The one line under the teams: tip time is rendered elsewhere, so 'scheduled' carries no text. */
export function statusLine(status: ESPNStatus): { kind: 'scheduled' | 'live' | 'final' | 'other'; text: string } {
    const name = status?.type?.name ?? '';
    const detail = status?.type?.detail ?? '';
    const period = Number(status?.period ?? 0);
    const hasPeriod = period >= 1; // !(>= 1) also catches NaN
    if (name === 'STATUS_SCHEDULED') return { kind: 'scheduled', text: '' };
    if (name === 'STATUS_FINAL') return { kind: 'final', text: period > 4 ? `Final/${periodLabel(period).replace('Q', '')}` : 'Final' };
    if (name === 'STATUS_HALFTIME') return { kind: 'live', text: 'Halftime' };
    if (name === 'STATUS_END_PERIOD') return { kind: 'live', text: !hasPeriod ? detail : period <= 4 ? `End of ${ORD[period]}` : `End of ${periodLabel(period)}` };
    if (LIVE.includes(name)) {
        if (!hasPeriod) return { kind: 'live', text: detail };
        const clock = String(status.displayClock ?? '').trim();
        return { kind: 'live', text: [periodLabel(period), clock].filter(Boolean).join(' ') };
    }
    return { kind: 'other', text: detail };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** The ?date= contract: ISO day, real, within [1997-10-01, today + 14 days]. */
export function parseDateParam(raw: string | null, today: string): { ok: true; date: string } | { ok: false; reason: 'format' | 'calendar' | 'range' } {
    if (raw == null || raw === '') return { ok: true, date: today };
    if (!ISO.test(raw)) return { ok: false, reason: 'format' };
    const d = DateTime.fromISO(raw, { zone: 'utc' });
    if (!d.isValid) return { ok: false, reason: 'calendar' };
    const floor = DateTime.utc(FIRST_SEASON - 1, 10, 1);
    const ceil = DateTime.fromISO(today, { zone: 'utc' }).plus({ days: 14 });
    if (d < floor || d > ceil) return { ok: false, reason: 'range' };
    return { ok: true, date: raw };
}

/** Previous and next calendar day plus the heading. Dates are days, so UTC arithmetic is exact. */
export function dayNav(day: string): { prev: string; next: string; label: string } {
    const d = DateTime.fromISO(day, { zone: 'utc' });
    return { prev: d.minus({ days: 1 }).toISODate()!, next: d.plus({ days: 1 }).toISODate()!, label: d.setLocale('en-US').toFormat('cccc, LLLL d') };
}

/** '2026-10-11' -> '20261011', the cdn scoreboard's &date= form. */
export function toEspnDate(iso: string): string {
    return iso.replaceAll('-', '');
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
