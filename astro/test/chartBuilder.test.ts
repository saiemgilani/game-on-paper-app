import { describe, expect, test } from 'vitest';
import { FLAGS, isFeatureEnabled } from '../src/utils/features';

describe('the chart-builder-v2 flag', () => {
    test('is a preview feature until promoted', () => {
        expect(FLAGS['chart-builder-v2']).toBe('preview');
        expect(isFeatureEnabled('chart-builder-v2', {})).toBe(false);
        expect(isFeatureEnabled('chart-builder-v2', { preview: true })).toBe(true);
    });
});
