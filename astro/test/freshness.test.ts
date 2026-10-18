import { afterEach, describe, expect, test, vi } from 'vitest';
import { freshnessStamp, freshnessSubtitle, freshnessTime, localizeFreshness } from '../src/utils/freshness';
import { useSystemZone } from './helpers/systemZone';

/** what localizeFreshness writes into one `<time data-freshness>` */
function localized(iso: string): string {
    const el = { dateTime: iso, textContent: 'server UTC text' };
    localizeFreshness({ querySelectorAll: (() => [el]) as any }, 'en-US');
    return el.textContent;
}

describe('freshnessStamp (the server text a viewer without JS reads)', () => {
    test('UTC, labelled, with the ISO kept as-is for <time datetime>', () => {
        expect(freshnessStamp('2026-09-26T13:14:00Z')).toEqual({ iso: '2026-09-26T13:14:00Z', text: 'Sep 26, 2026, 1:14 PM UTC' });
    });
    test('the ISO round-trips: the stamp /v1/meta actually sends (microseconds, +00:00)', () => {
        const iso = '2026-10-07T15:02:10.934928+00:00';
        const s = freshnessStamp(iso)!;
        expect(s.iso).toBe(iso);
        expect(new Date(s.iso).toISOString()).toBe('2026-10-07T15:02:10.934Z');
        expect(s.text).toBe('Oct 7, 2026, 3:02 PM UTC');
    });
    test('the fallback always names its zone', () => {
        for (const iso of ['2026-01-05T02:30:00Z', '2026-07-04T23:59:00Z']) expect(freshnessStamp(iso)!.text).toMatch(/ UTC$/);
    });
    test('absent or unparseable is null, never a guess', () => {
        expect(freshnessStamp(undefined)).toBeNull();
        expect(freshnessStamp(null)).toBeNull();
        expect(freshnessStamp('')).toBeNull();
        expect(freshnessStamp('not a date')).toBeNull();
    });
});

describe('freshnessTime (the viewer-local rewrite, zone passed in so the test is deterministic)', () => {
    test('a known ISO in a given zone, the zone named', () => {
        expect(freshnessTime('2026-09-26T13:14:00Z', { locale: 'en-US', timeZone: 'America/Chicago' })).toBe('Sep 26, 2026, 8:14 AM CDT');
        expect(freshnessTime('2026-09-26T13:14:00Z', { locale: 'en-US', timeZone: 'America/Los_Angeles' })).toBe('Sep 26, 2026, 6:14 AM PDT');
    });
    test('standard time in January, and the date rolls back across midnight', () => {
        expect(freshnessTime('2026-01-05T02:30:00Z', { locale: 'en-US', timeZone: 'America/New_York' })).toBe('Jan 4, 2026, 9:30 PM EST');
    });
    test('same fields as the fallback: in UTC it is the server text', () => {
        expect(freshnessTime('2026-09-26T13:14:00Z', { locale: 'en-US', timeZone: 'UTC' })).toBe(freshnessStamp('2026-09-26T13:14:00Z')!.text);
    });
});

describe("the viewer's own zone: the system zone is stubbed, nothing passes a timeZone", () => {
    afterEach(() => { vi.unstubAllEnvs(); });
    test.each([
        // zone, UTC offset in minutes (getTimezoneOffset), the ISO, what the viewer reads
        ['America/New_York', 240, '2026-09-26T13:14:00Z', 'Sep 26, 2026, 9:14 AM EDT'],
        ['America/Los_Angeles', 420, '2026-09-26T13:14:00Z', 'Sep 26, 2026, 6:14 AM PDT'],
        // standard time, and the local date is the day before the UTC date
        ['America/New_York', 300, '2026-01-05T02:30:00Z', 'Jan 4, 2026, 9:30 PM EST'],
        ['America/Los_Angeles', 480, '2026-01-05T02:30:00Z', 'Jan 4, 2026, 6:30 PM PST'],
        // DST ends 2026-11-01 at 2:00 local: 1:30 AM happens twice, an hour apart, told apart by the zone name
        ['America/New_York', 240, '2026-11-01T05:30:00Z', 'Nov 1, 2026, 1:30 AM EDT'],
        ['America/New_York', 300, '2026-11-01T06:30:00Z', 'Nov 1, 2026, 1:30 AM EST'],
        ['America/Los_Angeles', 420, '2026-11-01T08:30:00Z', 'Nov 1, 2026, 1:30 AM PDT'],
        ['America/Los_Angeles', 480, '2026-11-01T09:30:00Z', 'Nov 1, 2026, 1:30 AM PST'],
        // DST starts 2026-03-08: one UTC minute apart, the local clock skips 2:00-2:59
        ['America/New_York', 300, '2026-03-08T06:59:00Z', 'Mar 8, 2026, 1:59 AM EST'],
        ['America/New_York', 240, '2026-03-08T07:00:00Z', 'Mar 8, 2026, 3:00 AM EDT'],
    ])('%s, %s', (zone, offset, iso, local) => {
        useSystemZone(zone, offset, iso);
        expect(freshnessTime(iso, { locale: 'en-US' })).toBe(local); // the chart's call
        expect(localized(iso)).toBe(local); // the page script's rewrite
        expect(freshnessStamp(iso)!.text).toMatch(/ UTC$/); // the server text never follows the system zone
    });
    test('a time that will not format keeps the server text', () => {
        useSystemZone('America/New_York', 300, '2026-01-05T02:30:00Z');
        expect(localized('not a date')).toBe('server UTC text');
    });
});

describe('freshnessSubtitle', () => {
    test('draws the stamp at the bottom of the canvas', () => {
        expect(freshnessSubtitle('Sep 26, 2026, 8:14 AM CDT')).toMatchObject({ display: true, text: 'Last updated: Sep 26, 2026, 8:14 AM CDT', position: 'bottom', align: 'end' });
    });
    test('no stamp, no subtitle', () => {
        expect(freshnessSubtitle(null)).toEqual({ display: false });
        expect(freshnessSubtitle(undefined)).toEqual({ display: false });
    });
});
