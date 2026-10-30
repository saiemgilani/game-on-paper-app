import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, regulationFor } from '../../src/basketball/config';
import { darkLogoCss, hasEspnLogo, statusLine } from '../../src/nba/scoreboard';

const events = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/wbb/scoreboard-${n}.json`, import.meta.url)).toString()).content.sbData.events;
const line = (e: any) => {
    const comp = e.competitions[0];
    const reg = regulationFor('wbb', e.season?.year ?? null, comp.format?.regulation?.periods);
    return statusLine(comp.status, reg.periods, reg.kind).text;
};

describe('WBB scoreboard status from real days (D14: quarters are unchanged)', () => {
    test('2026-02-07, all of D-I: 130 Final, 6 Final/OT, 1 Final/2OT (periods 5 and 6 of a quarters game), 1 postponed', () => {
        const lines: string[] = events('20260207-all').map(line);
        expect([lines.filter((l) => l === 'Final').length, lines.filter((l) => l === 'Final/OT').length, lines.filter((l) => l === 'Final/2OT').length]).toEqual([130, 6, 1]);
        expect(lines.filter((l) => !l.startsWith('Final'))).toHaveLength(1);
    });
    test('the Top 25 board is a subset of the D-I board', () => {
        const all = new Set(events('20260207-all').map((e: any) => e.id));
        expect(events('20260207-top25').every((e: any) => all.has(e.id))).toBe(true);
    });
});

describe('logos (Decision 5)', () => {
    test('2024-11-04: dark rules by ESPN id for the 288 competitors ESPN has a logo for; none for the 34 non-D-I opponents', () => {
        const comps = events('20241104-all').flatMap((e: any) => e.competitions[0].competitors);
        const shown = comps.filter((c: any) => hasEspnLogo(c, 'wbb')).map((c: any) => ({ id: c.id, abbreviation: c.team.abbreviation }));
        expect([comps.length, shown.length]).toEqual([322, 288]);
        const css = darkLogoCss(shown, BASKETBALL.wbb.darkLogo);
        expect(css.match(/img\.team-logo-\d+\{/g)).toHaveLength(288);
        expect(css).toContain('ncaa/500-dark/2579.png'); // South Carolina
        expect(css).not.toContain('111956'); // Meredith, a non-D-I opponent
    });
});
