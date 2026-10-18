import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BASKETBALL, regulationFor } from '../../src/basketball/config';
import { darkLogoCss, statusLine } from '../../src/nba/scoreboard';
import { teamLogoUrl } from '../../src/utils/league';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../fixtures/${p}.json`, import.meta.url)).toString());
const events = (d: string) => read(`wnba/scoreboard-${d}`).content.sbData.events;
const line = (e: any) => {
    const comp = e.competitions[0];
    const reg = regulationFor('wnba', e.season?.year ?? null, comp.format?.regulation?.periods);
    return statusLine(comp.status, reg.periods, reg.kind).text;
};
const teams = (evs: any[]) => evs.flatMap((e) => e.competitions[0].competitors).map((c: any) => ({ id: c.id, abbreviation: c.team?.abbreviation }));

describe('WNBA scoreboard status from real days', () => {
    test('2025-08-01: four regulation finals and a double overtime', () => {
        expect(events('20250801').map(line)).toEqual(['Final', 'Final', 'Final', 'Final', 'Final/2OT']);
    });
    test('2005-06-03, the halves era: period 3 is the overtime (D14)', () => {
        expect(events('20050603').map(line)).toEqual(['Final', 'Final/OT']);
    });
});

describe('logos by abbreviation (Decision 5, Review Focus 4)', () => {
    // TeamRow.astro draws the card's light logo from teamLogoUrl(league, id, false) through the combiner.
    test('light: the three abbreviation-only franchises at 500/<abbr>.png; a defunct team and the NBA keep the id path', () => {
        for (const [id, ab] of [['129689', 'gs'], ['131935', 'tor'], ['132052', 'por']]) {
            expect(teamLogoUrl('wnba', id, false)).toBe(`https://a.espncdn.com/i/teamlogos/wnba/500/${ab}.png`);
            expect(teamLogoUrl('wnba', id, true)).toBe(`https://a.espncdn.com/i/teamlogos/wnba/500-dark/${ab}.png`);
        }
        expect(teamLogoUrl('wnba', '1', false)).toBe('https://a.espncdn.com/i/teamlogos/wnba/500/1.png'); // Charlotte Sting
        expect(teamLogoUrl('nba', '18', false)).toBe('https://a.espncdn.com/i/teamlogos/nba/500/18.png');
    });
    test('dark: every team of the 2025 board; on 2005-06-03 all four teams too, keyed by ESPN id (D22, R14)', () => {
        const css = darkLogoCss(teams(events('20250801')), BASKETBALL.wnba.darkLogo);
        expect(css.match(/img\.team-logo-\d+\{/g)).toHaveLength(10);
        expect(css).toContain('/i/teamlogos/wnba/500-dark/gs.png');
        // ESPN's 2005 payload spells WAS, TUL and NYL (today wsh, dal, ny); the id-keyed strategy reads the ESPN id, so every
        // card gets today's dark logo (each URL probed 200 in Task 1 Step 0)
        const old = darkLogoCss(teams(events('20050603')), BASKETBALL.wnba.darkLogo);
        const rule = (id: string, ab: string) => `img.team-logo-${id}{content:url('https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500-dark/${ab}.png&h=120&w=120')}`;
        for (const [id, ab] of [['16', 'wsh'], ['8', 'min'], ['3', 'dal'], ['9', 'ny']]) expect(old).toContain(rule(id, ab));
        expect(old.match(/img\.team-logo-\d+\{/g)).toHaveLength(4);
    });
});
