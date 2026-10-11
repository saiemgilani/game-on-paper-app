// test/nba/chartFrame.test.ts
// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { chartFrame, RESIZE_DEBOUNCE_MS } from '../../src/components/nba/chartFrame';

class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    cb: (entries: { contentRect: { width: number } }[]) => void;
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { this.cb = cb; FakeResizeObserver.last = this; }
    observe() {}
    disconnect() {}
    fire(width: number) { this.cb([{ contentRect: { width } }]); }
}

describe('chartFrame', () => {
    test('draws at the first measured width at once, debounces later ones, cleans up before each redraw', () => {
        vi.useFakeTimers();
        (globalThis as any).ResizeObserver = FakeResizeObserver;
        window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const calls: [number, boolean][] = [];
        const cleanups: number[] = [];
        const draw = (_: SVGSVGElement, width: number, animate: boolean) => { calls.push([width, animate]); return () => cleanups.push(width); };
        const action = chartFrame(svg, draw)!;
        expect(calls).toEqual([]);
        FakeResizeObserver.last!.fire(300);
        expect(calls).toEqual([[300, true]]);
        FakeResizeObserver.last!.fire(310);
        FakeResizeObserver.last!.fire(320);
        expect(calls.length).toBe(1);
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
        expect(calls).toEqual([[300, true], [320, false]]);
        expect(cleanups).toEqual([300]);
        // a new draw function (data changed) redraws at the known width, no animation
        action.update!((s, w, a) => { calls.push([w, a]); return () => cleanups.push(-w); });
        expect(calls.at(-1)).toEqual([320, false]);
        expect(cleanups).toEqual([300, 320]);
        action.destroy!();
        expect(cleanups).toEqual([300, 320, -320]);
        vi.useRealTimers();
    });
});
