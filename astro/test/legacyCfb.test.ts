import { describe, expect, test } from 'vitest';
import { legacyCfbTarget, staleRedirectTarget } from '../src/utils/legacyCfb';

describe('legacyCfbTarget', () => {
  test('the most-shared URL reaches the scoreboard, not /index', () => {
    for (const p of ['/cfb', '/cfb/', '/cfb/index']) {
      expect(legacyCfbTarget(p)).toBe('/');
    }
  });

  test('legacy game links resolve (they 404d as /game/<id>/index.html)', () => {
    expect(legacyCfbTarget('/cfb/game/401752921')).toBe('/game/401752921');
    expect(legacyCfbTarget('/cfb/game/401752921/')).toBe('/game/401752921');
  });

  test('deep paths survive a plain prefix strip', () => {
    expect(legacyCfbTarget('/cfb/year/2015/team/333')).toBe('/year/2015/team/333');
    expect(legacyCfbTarget('/cfb/year/2026/type/2/week/1')).toBe('/year/2026/type/2/week/1');
    expect(legacyCfbTarget('/cfb/team/333')).toBe('/team/333');
  });

  test('sections that actually moved get their new home', () => {
    expect(legacyCfbTarget('/cfb/trends')).toBe('/charts/trends');
    expect(legacyCfbTarget('/cfb/players')).toBe('/year/2026/players');
    expect(legacyCfbTarget('/cfb/game')).toBe('/');
  });

  test('prerendered targets keep the trailing slash that avoids a second hop', () => {
    expect(legacyCfbTarget('/cfb/teams')).toBe('/teams/');
    expect(legacyCfbTarget('/cfb/glossary')).toBe('/glossary/');
  });

  test('leaves non-legacy paths alone', () => {
    for (const p of ['/', '/game/1', '/teams/', '/cfbsomething', '/admin']) {
      expect(legacyCfbTarget(p)).toBeNull();
    }
  });
});

// A 301 is cached by the browser forever and never revalidated, so anyone who
// followed the old broken redirects is pinned to their target locally. Fixing
// the source does nothing for them; these targets must resolve.
describe('staleRedirectTarget', () => {
  test('rescues /index, the old /cfb/ target', () => {
    for (const p of ['/index', '/index/', '/index.html']) {
      expect(staleRedirectTarget(p)).toBe('/');
    }
  });

  test('rescues /game/<id>/index.html, the old /cfb/game/<id> target', () => {
    expect(staleRedirectTarget('/game/401752921/index.html')).toBe('/game/401752921');
    expect(staleRedirectTarget('/year/2015/team/333/index.html')).toBe('/year/2015/team/333');
  });

  test('leaves real paths alone', () => {
    for (const p of ['/', '/game/401752921', '/teams/', '/indexed', '/charts/trends']) {
      expect(staleRedirectTarget(p)).toBeNull();
    }
  });
});
