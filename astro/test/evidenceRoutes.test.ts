import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
// @ts-ignore -- plain .mjs script module, no type declarations
import { pageKey, slug, slugger } from '../scripts/lib/browser.mjs';
// @ts-ignore -- plain .mjs script module, no type declarations
import { serveStatic } from '../scripts/lib/serve-static.mjs';
// @ts-ignore -- plain .mjs script module, no type declarations
import { checkEvidenceRoutes, isBasketballFile, isBasketballRoute, landedOffBasketball } from '../scripts/lib/evidence-routes.mjs';

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

describe('basketball evidence-route check (pr-evidence.yml)', () => {
  const defaultRoutes = [workflow.match(/DEFAULT_ROUTES: (\S+)/)?.[1] ?? '(missing)'];
  // #458's files: shot on the template's football route before its description was fixed
  const pr458 = [
    'astro/src/basketball/hub.ts', 'astro/src/components/nba/NbaGameCard.astro',
    'astro/src/components/routes/BasketballHubRoute.astro', 'astro/src/pages/nba/index.astro',
    'astro/src/resources/gameLines.ts', 'astro/src/routes/basketball/hub.ts',
  ];
  test('the workflow default is the football game page', () => {
    expect(defaultRoutes).toEqual(['/game/401856682']);
  });
  test.each(['/nba', '/wnba/', '/mbb/players/5105337?season=2026', '/wbb?x=1', '/preview/nba/game/401909088'])(
    'basketball route %s', (r) => expect(isBasketballRoute(r)).toBe(true),
  );
  test.each(['/', '/nfl', '/game/401856682', '/nbax', '/players/1?league=nba'])(
    'not a basketball route %s', (r) => expect(isBasketballRoute(r)).toBe(false),
  );
  test('basketball files, and shared or football ones that are not', () => {
    expect(pr458.filter(isBasketballFile)).toHaveLength(5);
    expect(isBasketballFile('astro/src/pages/wbb/game/[id].astro')).toBe(true);
    expect(isBasketballFile('astro/src/components/routes/NbaGameRoute.astro')).toBe(true);
    expect(isBasketballFile('python/nba_game.py')).toBe(true);
    expect(isBasketballFile('astro/src/resources/bballScheduleContext.ts')).toBe(true);
    expect(isBasketballFile('astro/src/utils/nbaCup.ts')).toBe(true);
    expect(isBasketballFile('astro/src/resources/teamSeason.ts')).toBe(false);    expect(isBasketballFile('astro/src/components/routes/GameRoute.astro')).toBe(false);
    expect(isBasketballFile('astro/src/components/Header.astro')).toBe(false);
    expect(isBasketballFile('astro/test/nbaHeaderOverride.test.ts')).toBe(false);
  });
  test('a basketball PR left on the default football page fails, naming the default', () => {
    const reason = checkEvidenceRoutes({ files: pr458, routes: defaultRoutes, defaultRoutes });
    expect(reason).toMatch(/default football page \(\/game\/401856682\)/);
    expect(reason).toMatch(/Evidence routes: \/nba/);
  });
  test('a basketball PR with only football routes fails', () => {
    expect(checkEvidenceRoutes({ files: pr458, routes: ['/', '/nfl'], defaultRoutes }))
      .toMatch(/none of its evidence routes \(\/ \/nfl\) is a basketball page/);
  });
  test('one basketball route is enough', () => {
    expect(checkEvidenceRoutes({ files: pr458, routes: ['/game/401856682', '/mbb'], defaultRoutes })).toBeNull();
  });
  test('a basketball route must end on this site and on a basketball page', () => {
    const base = 'http://localhost:4321';
    expect(landedOffBasketball('/nba/', `${base}/nba/roster`, base)).toBeNull();
    expect(landedOffBasketball('/game/401856682', `${base}/`, base)).toBeNull();
    expect(landedOffBasketball('/nba', `${base}/game/401856682`, base)).toMatch(/landed on http:\/\/localhost:4321\/game\/401856682/);
    expect(landedOffBasketball('/nba', 'https://evil.example/nba', base)).toMatch(/evil\.example/);
  });
  test('a PR with no basketball files passes on any route', () => {
    expect(checkEvidenceRoutes({ files: ['astro/src/components/Header.astro'], routes: defaultRoutes, defaultRoutes })).toBeNull();
    expect(checkEvidenceRoutes({ files: [], routes: [], defaultRoutes })).toBeNull();
  });
});
