import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { RESUME_ROWS, formatRecord, resumeRows } from '../src/utils/resume';

// Both fixtures are the two Data API bodies retrieveTeamSchedule concatenates for a
// team-season (home_id then away_id), captured live; see fixtures/README.md.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)).toString());
const cfb = fixture('schedule-cfb-333-2025.json');
const nfl = fixture('schedule-nfl-12-2025.json');
const eventsOf = (f: any) => [...f.home_id.data, ...f.away_id.data];

// retrieveTeamSeasonInformation, unmocked, reads the same two bodies through the
// fetch layer, so the Overall row is checked against the record the TeamCard prints
const served: Record<string, any> = {};
vi.mock('../src/utils/telemetry', async (orig) => ({
    ...(await orig<typeof import('../src/utils/telemetry')>()),
    wrappedFetch: async (url: string) => {
        const side = /[?&](home_id|away_id)=/.exec(url)?.[1];
        const body = side ? served[side] : { data: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
}));

const byKey = (rows: ReturnType<typeof resumeRows>) => Object.fromEntries(rows.map((r) => [r.key, r]));
const sum = (rows: any[], k: 'wins' | 'losses' | 'ties') => rows.reduce((t, r) => t + r[k], 0);

/** A completed game with only the fields the pivot reads. */
const game = (o: Record<string, unknown>) => ({
    completed: true, neutral_site: false, conference_game: false, home_id: 1, away_id: 2,
    home_points: 0, away_points: 0, home_division: 'fbs', away_division: 'fbs', ...o,
}) as any;

describe('resumeRows on the captured schedules', () => {
    beforeEach(() => { for (const k of Object.keys(served)) delete served[k]; });

    test.each([
        ['cfb', cfb, '333'],
        ['nfl', nfl, '12'],
    ] as const)('%s: Home + Away + Neutral partition Overall, which matches the TeamCard record', async (league, f, id) => {
        const rows = byKey(resumeRows(eventsOf(f), id, league));
        const parts = [rows.home, rows.away, rows.neutral].filter(Boolean);
        for (const k of ['wins', 'losses', 'ties'] as const) expect(sum(parts, k), k).toBe(rows.overall[k]);

        Object.assign(served, f);
        const { retrieveTeamSeasonInformation } = await import('../src/resources/sdv');
        const info = await retrieveTeamSeasonInformation(2025, id, league);
        expect(info.events).toHaveLength(eventsOf(f).length);
        expect(formatRecord(rows.overall)).toBe(info.record);
    });

    test('cfb: Alabama 2025 from the real rows', () => {
        const rows = byKey(resumeRows(eventsOf(cfb), 333, 'cfb'));
        expect(formatRecord(rows.overall)).toBe('11-4');
        // Eastern Illinois is the one FCS opponent
        expect(formatRecord(rows.fbs)).toBe('10-4');
        // the data's home_rank/away_rank: Georgia, Vanderbilt, Missouri, Tennessee and
        // Oklahoma (CFP) beaten; Oklahoma (week 12), Georgia (SEC title) and Indiana not
        expect(formatRecord(rows.ranked)).toBe('5-3');
        // the SEC title game and the Rose Bowl
        expect(formatRecord(rows.neutral)).toBe('0-2');
        expect(rows.overall.winPct).toBeCloseTo(11 / 15, 10);
        const played = eventsOf(cfb);
        const margin = played.reduce((t: number, g: any) =>
            t + (g.home_id === 333 ? g.home_points - g.away_points : g.away_points - g.home_points), 0);
        expect(rows.overall.avgMargin).toBeCloseTo(margin / played.length, 10);
    });

    test('nfl: no vs FBS or vs Ranked row; the conference flag is a division record', () => {
        const rows = resumeRows(eventsOf(nfl), 12, 'nfl');
        const keys = rows.map((r) => r.key);
        expect(keys).not.toContain('fbs');
        expect(keys).not.toContain('ranked');
        expect(keys).not.toContain('conference');
        expect(byKey(rows).division.label).toBe('Division');
        expect(formatRecord(byKey(rows).overall)).toBe('6-11');
    });

    test('cfb: Conference, not Division', () => {
        const keys = resumeRows(eventsOf(cfb), 333, 'cfb').map((r) => r.key);
        expect(keys).toContain('conference');
        expect(keys).not.toContain('division');
    });
});

describe('resumeRows rules', () => {
    test('a tie counts as a tie, and the record grows a third number', () => {
        const rows = byKey(resumeRows([game({ home_points: 24, away_points: 24 })], 1, 'nfl'));
        expect(rows.overall).toMatchObject({ wins: 0, losses: 0, ties: 1, winPct: 0.5, avgMargin: 0 });
        expect(formatRecord(rows.overall)).toBe('0-0-1');
        expect(formatRecord({ wins: 10, losses: 6, ties: 1 })).toBe('10-6-1');
        expect(formatRecord({ wins: 10, losses: 7, ties: 0 })).toBe('10-7');
    });

    test('an uncompleted game is ignored', () => {
        const rows = byKey(resumeRows([
            game({ home_points: 31, away_points: 24 }),
            game({ completed: false, home_points: 0, away_points: 7 }),
            game({ home_points: null, away_points: null }),
        ], 1, 'cfb'));
        expect(formatRecord(rows.overall)).toBe('1-0');
    });

    test('one-score is a final margin of 8 or fewer', () => {
        const rows = byKey(resumeRows([
            game({ home_points: 31, away_points: 24 }),
            game({ home_points: 35, away_points: 24 }),
            game({ home_id: 2, away_id: 1, home_points: 32, away_points: 24 }),
        ], 1, 'cfb'));
        expect(formatRecord(rows.one_score)).toBe('1-1');
        expect(rows.overall.avgMargin).toBeCloseTo((7 + 11 - 8) / 3, 10);
    });

    test('a row with no games has a null Win % (the table omits it)', () => {
        const rows = byKey(resumeRows([game({ home_points: 31, away_points: 24 })], 1, 'cfb'));
        expect(rows.away).toMatchObject({ wins: 0, losses: 0, ties: 0, winPct: null, avgMargin: null });
        expect(rows.home.winPct).toBe(1);
    });

    test('vs Ranked needs the rank fields on the rows; a ranked opponent counts once', () => {
        const unranked = resumeRows([game({ home_points: 31, away_points: 24 })], 1, 'cfb');
        expect(unranked.map((r) => r.key)).not.toContain('ranked');
        const rows = byKey(resumeRows([
            game({ home_points: 31, away_points: 24, home_rank: null, away_rank: 7 }),
            game({ home_points: 14, away_points: 17, home_rank: 3, away_rank: null }),
        ], 1, 'cfb'));
        // our own rank (3) is not the opponent's
        expect(formatRecord(rows.ranked)).toBe('1-0');
    });

    test('vs FBS reads the opponent division', () => {
        const rows = byKey(resumeRows([
            game({ home_points: 56, away_points: 0, away_division: 'fcs' }),
            game({ home_id: 2, away_id: 1, home_points: 10, away_points: 20, home_division: 'fbs', away_division: 'fcs' }),
        ], 1, 'cfb'));
        expect(formatRecord(rows.fbs)).toBe('1-0');
    });

    test('every row key is unique, and Overall comes last, as a totals row', () => {
        const keys = RESUME_ROWS.map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys[keys.length - 1]).toBe('overall');
    });
});
