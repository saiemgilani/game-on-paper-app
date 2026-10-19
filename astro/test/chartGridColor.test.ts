import { describe, expect, it } from 'vitest';
import { chartGridColor } from '../src/resources/chart';

// the page text colours the three Chart.js charts read (Bootstrap body colour; dark-*.css body colour)
describe('chartGridColor', () => {
    it('fades the light theme ink to 0.3', () => {
        expect(chartGridColor('rgb(33, 37, 41)', false)).toBe('rgba(33, 37, 41, 0.3)');
    });
    it('fades the dark theme ink to 0.2', () => {
        expect(chartGridColor('rgb(209, 205, 199)', true)).toBe('rgba(209, 205, 199, 0.2)');
    });
});
