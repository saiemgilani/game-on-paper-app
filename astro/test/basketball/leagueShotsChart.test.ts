// @vitest-environment jsdom
// BB-G16: the small-multiple square chart draws what the team page's chart draws (cells with 2+ attempts), on one size scale.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { MIN_DRAWN_ATTEMPTS, renderSquareMultiple, squareCells } from '../../src/nba/charts/hexShotChart';
import { SQUARE_SIDE } from '../../src/nba/dashboard';
import { leagueSquaresFromRows } from '../../src/nba/adapters';
import { leagueHexIndex, squaresVsLeague } from '../../src/nba/data/aggregate';
import type { ShotLite } from '../../src/nba/data/shots';
import type { LeagueContextRow } from '../../src/resources/nbaShots';

const fetched: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL) => { fetched.push(String(input)); throw new Error('no network in tests'); });
afterAll(() => { vi.unstubAllGlobals(); expect(fetched).toEqual([]); });

// read from the package root: under jsdom, import.meta.url does not resolve to the file
const nets = JSON.parse(readFileSync('test/fixtures/nba/shots.json', 'utf-8')) as ShotLite[];
const rows = JSON.parse(readFileSync('test/fixtures/nba/league_context_squares_2026.json', 'utf-8')) as LeagueContextRow[];

describe('squareCells + renderSquareMultiple', () => {
    const squares = squaresVsLeague(nets, leagueHexIndex(nets, 15), SQUARE_SIDE, undefined, undefined, leagueSquaresFromRows(rows));
    const cells = squareCells(squares, SQUARE_SIDE);

    test('cells are the squares with 2+ attempts, on the integer lattice', () => {
        expect(cells).toHaveLength(squares.filter((s) => s.attempts >= MIN_DRAWN_ATTEMPTS).length);
        for (const [i, j] of cells) expect(Number.isInteger(i) && Number.isInteger(j)).toBe(true);
    });

    test('one path per cell on the drawn court, sized by the shared cap', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);
        const cleanup = renderSquareMultiple(svg, cells, { width: 200, side: SQUARE_SIDE, cap: 40 });
        const marks = svg.querySelectorAll('g > g:last-child > path');
        expect(marks.length).toBe(cells.filter(([, j]) => j * SQUARE_SIDE <= 350).length);
        // the busiest cells are full size: 2.5 ft * 0.88 at 200 px wide
        const big = [...marks].map((m) => m.getAttribute('d')!).find((d) => d.startsWith('M-'));
        expect(big).toBeTruthy();
        expect(svg.getAttribute('viewBox')).toMatch(/^0 0 200 /);
        cleanup();
        expect(svg.querySelector('g')).toBeNull();
    });
});
