// @vitest-environment jsdom
// BB-G38: the shot filter island in the browser on a real college final (fixtures/mbb/game_401820775_api.json): a menu
// refilters both charts and their FG lines, writes the state into the URL, and a chosen shooter shows his team alone.
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import GameShotFilters from '../../src/components/nba/charts/GameShotFilters.svelte';
import { fromDataApi } from '../../src/resources/nbaGame';
import { shotsOf } from '../../src/nba/data/game';
import { courtFor } from '../../src/basketball/config';
import { filterShot, NO_FILTERS, shotLine } from '../../src/basketball/shotFilters';

class FakeResizeObserver { observe() {} disconnect() {} }

test('a menu refilters, keeps the URL, and a chosen shooter shows his team alone', () => {
    (globalThis as any).ResizeObserver = FakeResizeObserver;
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
    history.replaceState(null, '', '/mbb/game/401820775?order=oldest');
    const g = fromDataApi(JSON.parse(readFileSync(`${process.cwd()}/test/fixtures/mbb/game_401820775_api.json`).toString()), 'mbb');
    const court = courtFor('mbb', g.season);
    const sides = ([['away', g.away], ['home', g.home]] as const).map(([key, s]) => {
        const shots = shotsOf(g.plays, Number(s.team.id)).map((p) => filterShot(p, { x: p.xLegacy!, y: p.yLegacy!, made: p.scoringPlay, value: p.scoreValue || 2, label: p.text, period: p.period }, court, null));
        const players = s.players.filter((r) => shots.some((x) => x.shooter === String(r.athlete_id))).map((r) => ({ id: String(r.athlete_id), name: r.name }));
        return { key, abbr: s.team.abbreviation, name: s.team.displayName, shots, players };
    });
    const target = document.body.appendChild(document.createElement('div'));
    const app = mount(GameShotFilters, { target, props: { sides, periods: [{ value: '1', label: 'H1' }, { value: '2', label: 'H2' }], zones: [], kinds: [], gameId: g.id, initial: NO_FILTERS, court } });
    flushSync();
    const lines = () => [...target.querySelectorAll('p[aria-live]')].map((p) => p.textContent);
    expect(lines()).toEqual(sides.map((s) => shotLine(s.shots)));
    expect(location.search).toBe('?order=oldest');

    const result = target.querySelector<HTMLSelectElement>('select[aria-label="Result"]')!;
    result.value = 'made'; result.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(lines()).toEqual(sides.map((s) => shotLine(s.shots.filter((x) => x.made))));
    expect(lines()[0]).toMatch(/^FG (\d+)-\1 \(100\.0%\)/);
    expect(location.search).toBe('?order=oldest&shot_result=made');

    const shooter = target.querySelector<HTMLSelectElement>('select[aria-label="Shooter"]')!;
    shooter.value = sides[1].players[0].id; shooter.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(target.querySelectorAll('h3')).toHaveLength(1);
    expect(target.querySelector('h3')!.textContent).toBe(`${sides[1].abbr}: ${sides[1].players[0].name}`);
    expect(location.search).toBe(`?order=oldest&shot_player=${sides[1].players[0].id}&shot_result=made`);

    // the other team: his filter goes, that team's chart alone
    const team = target.querySelector<HTMLSelectElement>('select[aria-label="Team"]')!;
    team.value = 'away'; team.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(target.querySelector('h3')!.textContent).toBe(sides[0].abbr);
    expect(location.search).toBe('?order=oldest&shot_team=away&shot_result=made');

    [...target.querySelectorAll('button')].find((b) => b.textContent === 'Clear')!.click();
    flushSync();
    expect(target.querySelectorAll('h3')).toHaveLength(2);
    expect(location.search).toBe('?order=oldest');
    unmount(app);
});
