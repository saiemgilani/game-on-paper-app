import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, regulationFor } from '../../src/basketball/config';
import { darkLogoCss, hasEspnLogo, statusLine } from '../../src/nba/scoreboard';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/mbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const line = (e: any) => {
    const comp = e.competitions[0];
    const reg = regulationFor('mbb', e.season?.year ?? null, comp.format?.regulation?.periods);
    return statusLine(comp.status, reg.periods, reg.kind).text;
};

describe('MBB scoreboard status from real days (D14)', () => {
    test('2025-02-22, all of D-I: 123 finals and 8 Final/OT (period 3 of a halves game)', () => {
        const lines: string[] = events('20250222-all').map(line);
        expect([lines.filter((l) => l === 'Final').length, lines.filter((l) => l === 'Final/OT').length]).toEqual([123, 8]);
    });
    test('the Top 25 board is a subset of the D-I board', () => {
        const all = new Set(events('20250222-all').map((e: any) => e.id));
        expect(events('20250222-top25').every((e: any) => all.has(e.id))).toBe(true);
    });
});

describe('logos (Decision 5)', () => {
    test('dark rules by ESPN id for teams ESPN has a logo for; none for a logo-less non-D-I opponent', () => {
        const comps = events('20241104-g30').flatMap((e: any) => e.competitions[0].competitors);
        const shown = comps.filter((c: any) => hasEspnLogo(c, 'mbb')).map((c: any) => ({ id: c.id, abbreviation: c.team.abbreviation }));
        expect(comps.filter((c: any) => !hasEspnLogo(c, 'mbb')).map((c: any) => c.id).sort()).toEqual(['126794', '2027', '484']);
        const css = darkLogoCss(shown, BASKETBALL.mbb.darkLogo);
        expect(css.match(/img\.team-logo-\d+\{/g)).toHaveLength(13);
        expect(css).not.toContain('126794');
        expect(hasEspnLogo({ team: {} }, 'nba')).toBe(true); // only the ncaa logo folder has logo-less opponents
    });
});

describe('light logos (ruling R5: no lightLogoCss; the id path is the light logo)', () => {
    test("an MBB light logo is ESPN's ncaa id path", async () => {
        const { teamLogoUrl } = await import('../../src/utils/league');
        expect(teamLogoUrl('mbb', '250', false)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/250.png');
    });
});
