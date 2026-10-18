import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
// @ts-ignore -- plain .mjs script module, no type declarations
import { pageKey, slug, slugger } from '../scripts/lib/browser.mjs';
// @ts-ignore -- plain .mjs script module, no type declarations
import { serveStatic } from '../scripts/lib/serve-static.mjs';

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

describe('slugger (stems for one run)', () => {
  test('routes that slug alike get distinct stems; the rest keep their slug', () => {
    const routes = ['/a-b', '/a/b', '/a?x=1', '/a?x_1', '/game/1', '/game/1'];
    const stem = slugger(routes);
    expect(stem('/game/1')).toBe('game-1');
    expect(new Set(['/a-b', '/a/b', '/a?x=1', '/a?x_1'].map(stem)).size).toBe(4);
    expect(stem('/a-b')).toMatch(/^a-b_[0-9a-f]{8}$/);
    expect(slugger([...routes].reverse())('/a/b')).toBe(stem('/a/b')); // order-independent
  });
});

describe('pageKey (saved-page lookup)', () => {
  test('path plus query, trailing slash ignored', () => {
    expect(pageKey('/players/4837248?season=2025')).toBe('/players/4837248?season=2025');
    expect(pageKey('/players/4837248/?season=2025')).toBe('/players/4837248?season=2025');
    expect(pageKey('/players/4837248')).toBe('/players/4837248');
    expect(pageKey('/')).toBe('/');
    expect(pageKey('//a/b')).toBe('/a/b'); // a path, not the host `a`
  });
  test('the static server serves each route its own saved page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gop-serve-'));
    const page = (name: string) => {
      writeFileSync(join(dir, name), name);
      return { file: join(dir, name) };
    };
    const pages = { '/players/1': page('bare'), '/players/1?season=2025': page('season'), '/b': page('b'), '//a/b': page('ab') };
    const server = await serveStatic({ astro: dir }, pages, 0);
    const get = async (p: string) => (await fetch(`http://127.0.0.1:${server.address().port}${p}`)).text();
    try {
      expect(await get('/players/1?season=2025')).toBe('season');
      expect(await get('/players/1/')).toBe('bare');
      expect(await get('/b')).toBe('b');
      expect(await get('//a/b')).toBe('ab');
    } finally {
      server.close();
    }
  });
});
