import { describe, expect, test } from 'vitest';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';

describe('the rank-neighbors flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['rank-neighbors']).toBe('preview');
        expect(isFeatureEnabled('rank-neighbors', {})).toBe(false);
        expect(isFeatureEnabled('rank-neighbors', { preview: true })).toBe(true);
    });
});
