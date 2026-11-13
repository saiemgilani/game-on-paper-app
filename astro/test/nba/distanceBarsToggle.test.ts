// @vitest-environment jsdom
// BB-G39 (Q16): the game page's one distance bar chart switches between Share and FG% in place, still pinnable.
// Real fixtures: an NBA processor final's home shots against the WNBA 2026 league curve.
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';

vi.mock('../../src/nba/charts/distanceBars', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/nba/charts/distanceBars')>()),
    renderDistanceBars: vi.fn(() => () => {}),
}));
import { renderDistanceBars } from '../../src/nba/charts/distanceBars';
import DistanceBarsToggle from '../../src/components/nba/charts/DistanceBarsToggle.svelte';
import { distanceCharts } from '../../src/nba/dashboard';
import { leagueContextFromRows } from '../../src/nba/adapters';
import { fromProcessor } from '../../src/resources/nbaGame';
import { shotsOf } from '../../src/nba/data/game';
import { gameShotsLite } from '../../src/nba/charts/gameShotChart';

class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    cb: (entries: { contentRect: { width: number } }[]) => void;
    constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { this.cb = cb; FakeResizeObserver.last = this; }
    observe() {}
    disconnect() {}
    fire(width: number) { this.cb([{ contentRect: { width } }]); }
}

test('FG% first; Share redraws the same chart with the share metric, and back', () => {
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    const game = fromProcessor(JSON.parse(readFileSync('test/fixtures/nba/game_401766458_processor.json').toString()), 'nba');
    const shots = shotsOf(game.plays, Number(game.home.team.id)).map((p) => ({ x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: p.text, period: p.period }));
    const context = leagueContextFromRows(JSON.parse(readFileSync('test/fixtures/wnba/dashboards/league_context_2026.json').toString()));
    const { bars } = distanceCharts(gameShotsLite(shots, game.id), context);
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(DistanceBarsToggle, { target, props: { data: bars, team: 'Home', subjectLabel: 'HOM' } });
    flushSync();
    FakeResizeObserver.last!.fire(300);
    const render = vi.mocked(renderDistanceBars);
    const button = (label: string) => [...target.querySelectorAll('button')].find((b) => b.textContent === label)!;
    expect(render.mock.calls.at(-1)![2]).toMatchObject({ metric: 'fgPct', pinnable: true });
    expect(button('FG%').getAttribute('aria-pressed')).toBe('true');
    expect(target.querySelector('h4')!.textContent).toBe('Field goal percentage by distance');
    button('Share').click();
    flushSync();
    expect(render.mock.calls.at(-1)![2]).toMatchObject({ metric: 'share', pinnable: true, animate: false });
    expect(button('Share').getAttribute('aria-pressed')).toBe('true');
    expect(target.querySelector('h4')!.textContent).toBe('Share of shots by distance');
    expect(target.querySelector('svg')!.getAttribute('aria-label')).toBe('Home share of shots by distance vs league');
    // one chart in either view: the panel's height does not change
    expect(target.querySelectorAll('svg')).toHaveLength(1);
    button('FG%').click();
    flushSync();
    expect(render.mock.calls.at(-1)![2]).toMatchObject({ metric: 'fgPct' });
    unmount(app);
});
