import { describe, expect, test, vi } from 'vitest';

// Once the head-coach boards are promoted ('coaches': 'on') the glossary links
// to them again, resolved to the latest finished season.
vi.mock('../src/utils/features', async (orig) => {
    const real = await orig<typeof import('../src/utils/features')>();
    return { ...real, FLAGS: { ...real.FLAGS, coaches: 'on' } };
});

import { generateGlossaryItems } from '../src/resources/glossary';
import { LAST_YEAR } from '../src/utils/constants';

describe('glossary with the coaches flag on', () => {
    test('the board pointers and the board source are back', () => {
        const entries = [...generateGlossaryItems().values()].flat();
        const spp = entries.find((e) => e.term === 'Seconds per play')!;
        expect(spp.definition).toContain(`<a href='/year/${LAST_YEAR}/coaches/pace'>head coach pace board</a>`);
        expect(spp.source).toBe('https://gameonpaper.com/coaches/pace');
        const scripted = entries.find((e) => e.term === 'Scripted drives')!;
        expect(scripted.definition).toContain(`<a href='/year/${LAST_YEAR}/coaches/scoring'>`);
    });
});
