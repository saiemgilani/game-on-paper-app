// @vitest-environment jsdom
// An axis change redraws through the action and keeps the zoom; Reset zoom returns to identity.
import { zoomIdentity } from 'd3-zoom';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';

const cleanups: ReturnType<typeof vi.fn>[] = [];
vi.mock('../../src/nba/charts/scatterChart', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/nba/charts/scatterChart')>()),
    renderScatter: vi.fn((_svg: unknown, _points: unknown, opts: any) => { const c = vi.fn(); cleanups.push(c); opts.onZoom(zoomIdentity.scale(2)); return c; }),
}));
import { renderScatter } from '../../src/nba/charts/scatterChart';
import ScatterExplorer from '../../src/components/nba/ScatterExplorer.svelte';

class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    cb: (entries: { contentRect: { width: number } }[]) => void;
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { this.cb = cb; FakeResizeObserver.last = this; }
    observe() {}
    disconnect() {}
    fire(width: number) { this.cb([{ contentRect: { width } }]); }
}

test('changing the y axis redraws with the kept zoom; Reset zoom redraws at identity', () => {
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    const points = [{ person_id: 1, name: 'A B', team_id: 1610612751, team: 'BKN', color: '#000', nets: true, headshot: null, v: [20, 10, 30, 0.45, 0.5, 0.35, 0.55, 0.2] }];
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(ScatterExplorer, { target, props: { points, subject: 'Test' } });
    flushSync();
    const render = vi.mocked(renderScatter);
    FakeResizeObserver.last!.fire(600);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][2]).toMatchObject({ x: 'ptsPg', y: 'efgPct', faces: false, filter: '' });
    const y = [...target.querySelectorAll('select')].find((s) => s.name === 'y')!;
    y.value = 'fgPct';
    y.dispatchEvent(new Event('change'));
    flushSync();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][2].y).toBe('fgPct');
    expect(render.mock.calls[1][2].transform.k).toBe(2); // the zoom the first draw reported is kept
    expect(cleanups[0]).toHaveBeenCalled();
    [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset zoom')!.click();
    flushSync();
    expect(render).toHaveBeenCalledTimes(3);
    expect(render.mock.calls[2][2].transform.k).toBe(1);
    unmount(app);
    expect(cleanups[2]).toHaveBeenCalled();
});
