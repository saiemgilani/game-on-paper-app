// @vitest-environment jsdom
// A derived draw must reach the action's update: switching the hex mode redraws (no animation)
// and cleans up the previous draw.
import { flushSync, mount, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';

const cleanups: ReturnType<typeof vi.fn>[] = [];
vi.mock('../../src/nba/charts/hexShotChart', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/nba/charts/hexShotChart')>()),
    renderHexShotChart: vi.fn(() => { const c = vi.fn(); cleanups.push(c); return c; }),
}));
import { renderHexShotChart } from '../../src/nba/charts/hexShotChart';
import HexShotChart from '../../src/components/nba/charts/HexShotChart.svelte';
import { ZONES } from '../../src/nba/data/aggregate';

class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    cb: (entries: { contentRect: { width: number } }[]) => void;
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { this.cb = cb; FakeResizeObserver.last = this; }
    observe() {}
    disconnect() {}
    fire(width: number) { this.cb([{ contentRect: { width } }]); }
}

test('switching the hex mode redraws through the action', () => {
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    const zero = { attempts: 0, makes: 0, fgPct: null };
    const zones = Object.fromEntries(ZONES.map((z) => [z, { player: zero, league: zero }])) as any;
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(HexShotChart, { target, props: { data: { hexes: [], radius: 15, zones }, title: 't' } });
    flushSync(); // actions attach in an effect
    const render = vi.mocked(renderHexShotChart);
    FakeResizeObserver.last!.fire(300);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][2]).toMatchObject({ width: 300, mode: 'raw', animate: true });
    [...target.querySelectorAll('button')].find((b) => b.textContent === 'Zones')!.click();
    flushSync();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][2]).toMatchObject({ width: 300, mode: 'zones', animate: false });
    expect(cleanups[0]).toHaveBeenCalled();
    expect(cleanups[1]).not.toHaveBeenCalled();
    unmount(app);
    expect(cleanups[1]).toHaveBeenCalled();
});
