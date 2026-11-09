// Football features carried to basketball: Players to Watch, spice borders, SportsEvent JSON-LD, gated glossary terms.
import { describe, expect, test, vi } from 'vitest';
import { basketballEventJsonLd, basketballSpice, playersToWatch, type SpiceInput } from '../../src/basketball/parity';
import { SpiceLevel } from '../../src/utils/misc';
import type { SeasonPlayerRow } from '../../src/resources/nbaShots';

const row = (person_id: number, team_id: number, pts_pg: number | null, gp: number, has_stats = true, is_primary = true) =>
    ({ person_id, player_name: `P${person_id}`, team_id, pts_pg, gp, has_stats, is_primary, ts_pct: 0.6, usg_pct: 0.25 }) as SeasonPlayerRow;

describe('playersToWatch', () => {
    test("the team's top scorers among its regulars, highest first", () => {
        const rows = [row(1, 10, 20, 30), row(2, 10, 31, 3), row(3, 10, 25, 20), row(4, 10, 12, 30), row(5, 99, 40, 30), row(6, 10, null, 30), row(7, 10, 50, 30, false), row(8, 10, 9, 15)];
        // 2 (3 of 30 games) is a cameo, 5 is another team, 6 and 7 have no stats: 3, 1, 4
        expect(playersToWatch(rows, 10).map((p) => p.personId)).toEqual([3, 1, 4]);
        expect(playersToWatch(rows, 10, 1)[0]).toEqual({ personId: 3, name: 'P3', ptsPg: 25, tsPct: 0.6, usgPct: 0.25, gp: 20 });
    });
    test('no rows for the team: nobody', () => expect(playersToWatch([row(1, 10, 20, 30)], 11)).toEqual([]));
    test('a traded player is on his primary team only, and his other row sets no games cutoff', () => {
        // 9 was traded from 10 to 11: his row for 10 is not primary, so 10's busiest regular is 1 (20 games) and 4 (12) qualifies
        const rows = [row(9, 10, 30, 60, true, false), row(9, 11, 28, 10), row(1, 10, 20, 20), row(4, 10, 12, 12)];
        expect(playersToWatch(rows, 10).map((p) => p.personId)).toEqual([1, 4]);
        expect(playersToWatch(rows, 11).map((p) => p.personId)).toEqual([9]);
    });
});

describe('basketballSpice', () => {
    const g = (o: Partial<SpiceInput> & { h?: number; a?: number; hr?: number; ar?: number }): SpiceInput => ({
        state: 'in', period: 4, clock: 120, regulationPeriods: 4, ...o, home: { score: o.h ?? 100, rank: o.hr }, away: { score: o.a ?? 97, rank: o.ar },
    });
    test('close in the last five minutes of regulation or in overtime', () => {
        expect(basketballSpice(g({}))).toBe(SpiceLevel.SERRANO);
        expect(basketballSpice(g({ period: 5, clock: 280, h: 110, a: 104 }))).toBe(SpiceLevel.SERRANO);
        expect(basketballSpice(g({ hr: 3, ar: 12 }))).toBe(SpiceLevel.GHOST);
        expect(basketballSpice(g({ period: 2, regulationPeriods: 2, clock: 60, h: 70, a: 66 }))).toBe(SpiceLevel.SERRANO); // college halves
    });
    test('not late, not close, or not live: none', () => {
        expect(basketballSpice(g({ clock: null }))).toBe(SpiceLevel.BELL); // no clock from ESPN: not known to be late
        expect(basketballSpice(g({ clock: 301 }))).toBe(SpiceLevel.BELL);
        expect(basketballSpice(g({ period: 3 }))).toBe(SpiceLevel.BELL);
        expect(basketballSpice(g({ h: 110 }))).toBe(SpiceLevel.BELL);
        expect(basketballSpice(g({ state: 'post' }))).toBe(SpiceLevel.BELL);
        expect(basketballSpice(g({ state: 'pre', period: 0 }))).toBe(SpiceLevel.BELL);
    });
    test('a ranked team trailing an unranked one in the second half', () => {
        expect(basketballSpice(g({ period: 2, regulationPeriods: 2, clock: 900, h: 50, a: 41, ar: 7 }))).toBe(SpiceLevel.CAYENNE);
        expect(basketballSpice(g({ period: 1, regulationPeriods: 2, clock: 900, h: 30, a: 21, ar: 7 }))).toBe(SpiceLevel.BELL); // first half
        expect(basketballSpice(g({ period: 2, regulationPeriods: 2, clock: 900, h: 41, a: 50, ar: 7 }))).toBe(SpiceLevel.BELL); // the ranked team leads
    });
});

describe('basketballEventJsonLd', () => {
    const spec = {
        league: 'wnba' as const, path: '/wnba/game/401736287', date: '2025-08-01T23:00Z', description: 'd', venue: 'Climate Pledge Arena', statusDetail: 'Final',
        home: { name: 'Seattle Storm', href: '/wnba/team/1611661328', score: 84 }, away: { name: 'Las Vegas Aces', href: null, score: 80 },
    };
    test('a basketball SportsEvent, with the box score as its Dataset once scored', () => {
        const j = basketballEventJsonLd(spec) as any;
        expect(j).toMatchObject({ '@type': 'SportsEvent', sport: 'Basketball', url: 'https://gameonpaper.com/wnba/game/401736287', name: 'Las Vegas Aces at Seattle Storm', organizer: { name: 'WNBA' }, location: { name: 'Climate Pledge Arena' } });
        expect(j.homeTeam).toEqual({ '@type': 'SportsTeam', name: 'Seattle Storm', sport: 'Basketball', url: 'https://gameonpaper.com/wnba/team/1611661328' });
        expect(j.awayTeam.url).toBeUndefined();
        expect(j.subjectOf.name).toBe('Las Vegas Aces 80, Seattle Storm 84 advanced box score');
    });
    test('pregame: no Dataset; college is NCAA', () => {
        const j = basketballEventJsonLd({ ...spec, league: 'mbb', home: { ...spec.home, score: null }, away: { ...spec.away, score: null } }) as any;
        expect(j.subjectOf).toBeUndefined();
        expect(j.organizer.name).toBe('NCAA');
    });
});

describe('the glossary', () => {
    test('basketball terms stay out while the NBA pages are in preview', async () => {
        vi.resetModules();
        const { generateGlossaryItems } = await import('../../src/resources/glossary');
        const terms = [...generateGlossaryItems().values()].flat().map((t) => t.term);
        expect(terms.some((t) => t.includes('basketball'))).toBe(false);
        expect(terms).toContain('Expected points added (EPA)');
    });
    test('and join, in order, once they are public', async () => {
        vi.resetModules();
        vi.doMock('../../src/utils/features', async (orig) => {
            const m = await orig<typeof import('../../src/utils/features')>();
            return { ...m, FLAGS: { ...m.FLAGS, nba: 'on' } };
        });
        const { generateGlossaryItems } = await import('../../src/resources/glossary');
        const g = generateGlossaryItems();
        const terms = [...g.values()].flat().map((t) => t.term);
        expect(terms).toContain('Four factors (basketball)');
        expect(terms).toContain('Expected points added (EPA)');
        expect(g.get('U')!.map((t) => t.term)).toEqual(['Usage rate (USG%, basketball)']); // a letter only basketball has
        const f = g.get('F')!.map((t) => t.term);
        expect(f).toEqual([...f].sort((a, b) => a.localeCompare(b)));
        vi.doUnmock('../../src/utils/features');
    });
});
