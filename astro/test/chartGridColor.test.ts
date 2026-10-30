import { describe, expect, it } from 'vitest';
import { chartGridColor, chartGridLines } from '../src/resources/chart';

// the page text colours the three Chart.js charts read (Bootstrap body colour; dark-*.css body colour)
describe('chartGridColor', () => {
    it('fades the light theme ink to 0.3', () => {
        expect(chartGridColor('rgb(33, 37, 41)', false)).toBe('rgba(33, 37, 41, 0.3)');
    });
    it('fades the dark theme ink to 0.2', () => {
        expect(chartGridColor('rgb(209, 205, 199)', true)).toBe('rgba(209, 205, 199, 0.2)');
    });
});

// the zero line must stand out from the grid in both themes (#339 left it the grid's shade on white)
describe('chartGridLines', () => {
    it.each([['rgb(33, 37, 41)', false], ['rgb(209, 205, 199)', true]] as const)('draws %s zero line bold (dark %s)', (ink, dark) => {
        const g = chartGridLines(ink, dark);
        expect(g.color({ tick: { value: 0 } })).toBe(ink.replace('rgb', 'rgba').replace(')', ', 0.75)'));
        expect(g.lineWidth({ tick: { value: 0 } })).toBe(2);
        expect(g.color({ tick: { value: 5 } })).toBe(chartGridColor(ink, dark));
        expect(g.lineWidth({ tick: { value: 5 } })).toBe(1);
        expect(g.lineWidth({})).toBe(1);
    });
});
