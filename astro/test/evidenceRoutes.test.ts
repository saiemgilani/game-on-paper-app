import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
// @ts-ignore -- plain .mjs script module, no type declarations
import { pageKey, slug } from '../scripts/lib/browser.mjs';

// the exact filter pr-evidence.yml applies to the PR body's `Evidence routes:` tokens
const workflow = readFileSync(new URL('../../.github/workflows/pr-evidence.yml', import.meta.url), 'utf8');
const pattern = workflow.match(/grep -E '(\^\/[^']*)' \| head -4 \| tr/)?.[1];
const routeFilter = new RegExp(pattern ?? '(?!)');

describe('Evidence routes filter (pr-evidence.yml)', () => {
  test('the workflow still has the filter this test reads', () => {
    expect(pattern).toBeTruthy();
  });
  test.each(['/', '/game/401856682', '/year/2025/team/333', '/players/4837248?season=2025', '/nfl/x?a=1&b=two_3.4-5'])(
    'keeps %s', (r) => expect(routeFilter.test(r)).toBe(true),
  );
  test.each(['players/1', '/a b', '/a?x=$(id)', '/a?x=`id`', '/a?x;rm', "/a?x='y'", '/a?x"', '/a?*', '/a?x=[1]', '/a?x=%20', '/a?b?c', '/a#frag'])(
    'drops %s', (r) => expect(routeFilter.test(r)).toBe(false),
  );
});

describe('slug', () => {
  test('query-free routes keep the stems existing evidence links use', () => {
    expect(slug('/')).toBe('home');
    expect(slug('/game/401856682')).toBe('game-401856682');
    expect(slug('/year/2025/team/333/')).toBe('year-2025-team-333');
  });
  test('a query string is part of the stem, so it never collides with the bare path', () => {
    expect(slug('/players/4837248?season=2025')).toBe('players-4837248_season_2025');
    expect(slug('/players/4837248?season=2024')).not.toBe(slug('/players/4837248?season=2025'));
    expect(slug('/players/4837248?season=2025')).not.toBe(slug('/players/4837248'));
    expect(slug('/a?x=1&y=2')).toBe('a_x_1_y_2');
    expect(slug('/?x=1')).toBe('home_x_1');
  });
  test('stems are filesystem-safe', () => {
    expect(slug('/nfl/x?a=1&b=two_3.4-5')).toMatch(/^[\w-]+$/);
  });
});

describe('pageKey (saved-page lookup)', () => {
  test('path plus query, trailing slash ignored', () => {
    expect(pageKey('/players/4837248?season=2025')).toBe('/players/4837248?season=2025');
    expect(pageKey('/players/4837248/?season=2025')).toBe('/players/4837248?season=2025');
    expect(pageKey('/players/4837248')).toBe('/players/4837248');
    expect(pageKey('/')).toBe('/');
  });
  test('a route and its request URL resolve to the same page, distinct from the bare path', () => {
    const pages = new Map([['/players/1', 'bare.html'], ['/players/1?season=2025', 'season.html']].map(([r, f]) => [pageKey(r), f]));
    expect(pages.get(pageKey('/players/1?season=2025'))).toBe('season.html');
    expect(pages.get(pageKey('/players/1/'))).toBe('bare.html');
  });
});
