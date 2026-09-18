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
