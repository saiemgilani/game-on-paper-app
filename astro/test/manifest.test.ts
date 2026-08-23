import { describe, expect, test } from 'vitest';
import { GAME_PAGE_MANIFEST, evaluateManifest, salvageGame } from '../src/utils/manifest';

// Field names mirror the real ProcessedGame shape (astro/src/resources/internal.ts):
// `header`, `advBoxScore` (not `boxScore`), per-play `winProbability`, `drives.previous`.
const fullGame = () => ({
  header: { id: '1', competitions: [{ competitors: [{}, {}] }] },
  advBoxScore: { team: [{}, {}] },
  plays: [{ winProbability: { before: 0.5, after: 0.6, added: 0.1 } }],
  drives: { previous: [{}] },
});

describe('evaluateManifest', () => {
  test('complete game -> ok', () => {
    const v = evaluateManifest(GAME_PAGE_MANIFEST, fullGame());
    expect(v.outcome).toBe('ok');
    expect(v.missingNames).toEqual([]);
  });
  test('missing optional -> degraded', () => {
    const g: any = fullGame();
    g.plays = [{}]; // plays present, no winProbability on them
    g.drives = undefined;
    const v = evaluateManifest(GAME_PAGE_MANIFEST, g);
    expect(v.outcome).toBe('degraded');
    expect(v.missingNames).toContain('winprobability');
    expect(v.missingNames).toContain('drives');
    expect(v.requiredMissing).toEqual([]);
  });
  test('missing required -> failed', () => {
    const g: any = fullGame();
    g.plays = [];
    const v = evaluateManifest(GAME_PAGE_MANIFEST, g);
    expect(v.outcome).toBe('failed');
    expect(v.requiredMissing).toContain('plays');
  });
  test('null game -> failed with everything missing', () => {
    const v = evaluateManifest(GAME_PAGE_MANIFEST, null);
    expect(v.outcome).toBe('failed');
    expect(v.missingNames.length).toBe(GAME_PAGE_MANIFEST.length);
  });
  test('check exceptions count as missing (fail-open)', () => {
    const v = evaluateManifest([{ name: 'boom', need: 'optional', check: () => { throw new Error('x'); } }], {});
    expect(v.outcome).toBe('degraded');
    expect(v.missingNames).toEqual(['boom']);
  });
});

describe('salvageGame', () => {
  test('backfills neutral winProbability only where missing', () => {
    const g: any = { plays: [{ text: 'run' }, { winProbability: { before: 0.9, after: 0.8, added: -0.1 } }] };
    salvageGame(g);
    expect(g.plays[0].winProbability).toEqual({ before: 0.5, after: 0.5, added: 0.0 });
    expect(g.plays[1].winProbability.before).toBe(0.9);
  });
  test('backfills missing drives to neutral shape; manifest still reports drives missing', () => {
    // GamePage order: evaluate on the original, then salvage.
    const g: any = fullGame();
    g.drives = null;
    const v = evaluateManifest(GAME_PAGE_MANIFEST, g);
    expect(v.outcome).toBe('degraded');
    expect(v.missingNames).toContain('drives');
    salvageGame(g);
    expect(g.drives).toEqual({ previous: [] });
    // salvage must not make the check pass
    expect(evaluateManifest(GAME_PAGE_MANIFEST, g).missingNames).toContain('drives');
    // intact drives untouched
    const g2: any = fullGame();
    salvageGame(g2);
    expect(g2.drives.previous.length).toBe(1);
  });
});
