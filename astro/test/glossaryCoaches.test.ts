import { describe, expect, test } from 'vitest';
import { generateGlossaryItems, withoutCoachBoards } from '../src/resources/glossary';
import { FLAGS } from '../src/utils/features';

// The glossary prerenders, so it follows the 'coaches' flag's build-time state:
// while the boards are gated (a public 404) the copy must not link to them. The
// metric definitions themselves stay; only the board pointers go.
const entries = [...generateGlossaryItems().values()].flat();
const byTerm = (t: string) => entries.find((e) => e.term === t);

describe('glossary while the coaches flag is not public', () => {
    test('the flag is still preview (glossaryCoachesOn.test.ts covers promotion)', () => {
        expect(FLAGS['coaches']).toBe('preview');
    });

    test('no definition or source points at a coach board', () => {
        for (const e of entries) {
            expect(e.definition, e.term).not.toMatch(/\/coaches(\/|['"#?])/);
            expect(e.source, e.term).not.toMatch(/\/coaches(\/|$)/);
        }
    });

    test('the coach metric definitions stay, minus their board pointers', () => {
        for (const t of ['Seconds per play', 'Situation-neutral pass rate', 'Scripted drives', 'Scoring opportunity',
            'Fourth-down agreement rate', 'Win probability left on the field']) {
            const e = byTerm(t);
            expect(e, t).toBeDefined();
            expect(e!.definition.length, t).toBeGreaterThan(80);
            expect(e!.definition, t).not.toContain('Shown on the');
        }
        // a mid-sentence board link is unwrapped to its text, keeping the grammar
        expect(byTerm('Scripted drives')!.definition).toContain('columns of the head coach scoring board; the gap');
        // a board source is blanked (GlossaryItem then renders the term unlinked)
        expect(byTerm('Seconds per play')!.source).toBe('');
        // a non-board source is untouched
        expect(byTerm('Fourth-down agreement rate')!.source).toBe('https://cfb4th.sportsdataverse.org');
    });

    test('withoutCoachBoards leaves an entry with no board link unchanged', () => {
        const e = { term: 'EPA', definition: 'See the <a href=\'/year/{season}/teams/differential\'>team board</a>.', source: 'https://gameonpaper.com/glossary' };
        expect(withoutCoachBoards(e)).toEqual(e);
    });
});

// The explainer wave-2 audit (2026-09-30) read each definition against the code
// that computes it; these pin the corrected claims.
describe('definitions say what the code computes', () => {
    test('fourth downs: a three-way recommendation, but confidence, agreement and WP left are go against the best kick', () => {
        const rec = byTerm('Fourth down recommendations')!.definition;
        expect(rec).toContain('each choice (go, field goal, punt)');
        expect(rec).toContain('between going for it and the better of the two kicks');
        expect(rec).not.toContain('second-highest');
        expect(byTerm('Fourth-down agreement rate')!.definition).toContain('on go or kick; a punt and a field goal both count as a kick');
        expect(byTerm('Win probability left on the field')!.definition).toContain('the gap between going for it and the better of the two kicks');
    });

    test('scoring opportunities count runs and passes; seconds per play is game clock, not a chosen tempo', () => {
        expect(byTerm('Scoring opportunity')!.definition).toMatch(/^A drive with at least one run or pass inside the opponent's 40/);
        const pace = byTerm('Seconds per play')!.definition;
        expect(pace).not.toContain('tempo the head coach chose');
        expect(pace).toContain('an incompletion stops the clock');
    });

    test('third downs quote the bundled college curve; neutral pass rate cites a live source and names the NFL filter', () => {
        // sportsdataverse cfb_third_down_conversion.parquet: 3rd-and-10 = 0.2749
        expect(byTerm('Third Downs Over Expected')!.definition).toContain('73% and 27.5% in college');
        const neutral = byTerm('Situation-neutral pass rate')!;
        expect(neutral.source).not.toContain('opensourcefootball.com/posts/2020-08-20-what-is-neutral-situation');
        expect(neutral.source).toBe('https://github.com/sportsdataverse/sportsdataverse-py/blob/main/sportsdataverse/football/tendencies.py');
        expect(neutral.definition).toContain('The NFL team Neutral Pass Rate follows');
        expect(neutral.definition).toContain('first and second down only, first three quarters');
    });
});
