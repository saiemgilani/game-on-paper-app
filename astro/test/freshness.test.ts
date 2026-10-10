import { describe, expect, test } from 'vitest';
import { freshnessStamp, freshnessSubtitle, freshnessTime } from '../src/utils/freshness';

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

describe('freshnessSubtitle', () => {
    test('draws the stamp at the bottom of the canvas', () => {
        expect(freshnessSubtitle('Sep 26, 2026, 8:14 AM CDT')).toMatchObject({ display: true, text: 'Last updated: Sep 26, 2026, 8:14 AM CDT', position: 'bottom', align: 'end' });
    });
    test('no stamp, no subtitle', () => {
        expect(freshnessSubtitle(null)).toEqual({ display: false });
        expect(freshnessSubtitle(undefined)).toEqual({ display: false });
    });
});
