import { describe, expect, test } from 'vitest';
import { freshnessStamp, freshnessSubtitle } from '../src/utils/freshness';

describe('freshnessStamp', () => {
    test('the ingest time in ET, with the ISO kept for <time datetime>', () => {
        expect(freshnessStamp('2026-09-26T13:14:00Z')).toEqual({ iso: '2026-09-26T13:14:00Z', text: 'Sep 26, 2026, 9:14 AM ET' });
    });
    test('the stamp /v1/meta actually sends (microseconds, +00:00), and EST in January', () => {
        expect(freshnessStamp('2026-10-07T15:02:10.934928+00:00')!.text).toBe('Oct 7, 2026, 11:02 AM ET');
        expect(freshnessStamp('2026-01-05T02:30:00Z')!.text).toBe('Jan 4, 2026, 9:30 PM ET');
    });
    test('absent or unparseable is null, never a guess', () => {
        expect(freshnessStamp(undefined)).toBeNull();
        expect(freshnessStamp(null)).toBeNull();
        expect(freshnessStamp('')).toBeNull();
        expect(freshnessStamp('not a date')).toBeNull();
    });
});

describe('freshnessSubtitle', () => {
    test('draws the stamp at the bottom of the canvas', () => {
        expect(freshnessSubtitle('Sep 26, 2026, 9:14 AM ET')).toMatchObject({ display: true, text: 'Last updated: Sep 26, 2026, 9:14 AM ET', position: 'bottom', align: 'end' });
    });
    test('no stamp, no subtitle', () => {
        expect(freshnessSubtitle(null)).toEqual({ display: false });
        expect(freshnessSubtitle(undefined)).toEqual({ display: false });
    });
});
