import { describe, expect, test } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extractGameState, isRegression, mergeHighWater, pickFresher } from '../src/utils/gameState';

const st = (period: number, plays: number, scores = [0, 0], completed = false,
            status = 'STATUS_IN_PROGRESS') => ({ period, plays, scores, completed, status });

describe('isRegression', () => {
  test('accepts a game moving forward', () => {
    expect(isRegression(st(3, 120), st(3, 110)).regressed).toBe(false);
  });
  test('rejects the period going backwards (the 401866532 case)', () => {
    const v = isRegression(st(3, 103), st(4, 138));
    expect(v.regressed).toBe(true);
    expect(v.reason).toContain('period');
  });
  test('rejects plays disappearing', () => {
    expect(isRegression(st(3, 103), st(3, 138)).reason).toContain('plays');
  });
  test('rejects a final game reverting to in-progress', () => {
    expect(isRegression(st(4, 150), st(4, 150, [0, 0], true)).reason).toContain('final');
  });
  test('ALLOWS a score-only drop — officials do reverse points on review', () => {
    expect(isRegression(st(3, 120, [14, 21]), st(3, 120, [21, 21])).regressed).toBe(false);
  });
  test('exempts scheduled only BEFORE kickoff, when nothing has happened yet', () => {
    const beforeKickoff = st(0, 0, [0, 0], false, 'STATUS_SCHEDULED');
    expect(isRegression(beforeKickoff, st(0, 0)).regressed).toBe(false);
  });
  test('rejects a live game reverting to scheduled (401867874, 401869128)', () => {
    const v = isRegression(st(0, 0, [0, 0], false, 'STATUS_SCHEDULED'), st(1, 10));
    expect(v.regressed).toBe(true);
    expect(v.reason).toContain('scheduled');
  });
  test('is inert with no high-water mark', () => {
    expect(isRegression(st(3, 120), null).regressed).toBe(false);
  });
});

describe('mergeHighWater', () => {
  test('never lowers the mark on a transient dip', () => {
    const hw = mergeHighWater(st(4, 138, [15, 21]), st(3, 103, [8, 21]));
    expect(hw).toMatchObject({ period: 4, plays: 138, scores: [15, 21] });
  });
  test('keeps completed sticky', () => {
    expect(mergeHighWater(st(4, 150, [0, 0], true), st(4, 150))!.completed).toBe(true);
  });
});

describe('pickFresher', () => {
  test('prefers the further-along payload', () => {
    const a = { state: st(3, 103), payload: 'stale' };
    const b = { state: st(4, 138), payload: 'fresh' };
    expect(pickFresher(a, b).payload).toBe('fresh');
    expect(pickFresher(b, a).payload).toBe('fresh');
  });
});

// The point of the guard: replay real captured timelines and confirm it
// suppresses the regressions we actually observed without rejecting progress.
describe('captured ESPN timelines', () => {
  const root = new URL('../../fixtures/game-states/', import.meta.url).pathname;
  const have = existsSync(root);

  test.skipIf(!have)('flags every observed regression and no forward step', () => {
    const raw = execSync(
      `python3 - <<'PY'
import json,glob,os
out=[]
for mf in glob.glob(os.path.join(${JSON.stringify(root)},"*","manifest.jsonl")):
    states=[]
    for line in open(mf):
        r=json.loads(line); s=r["state"]
        states.append({"period":s.get("period") or 0,
                       "plays":s.get("n_plays") or 0,
                       "scores":[int(x) for x in str(s.get("score","")).split("-") if x.isdigit()],
                       "completed":bool(s.get("completed")),
                       "status":s.get("status","UNKNOWN")})
    if len(states)>1: out.append(states)
print(json.dumps(out))
PY`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

    const games: any[][] = JSON.parse(raw);
    expect(games.length).toBeGreaterThan(0);

    let forward = 0, caught = 0, leaked = 0;
    for (const states of games) {
      let hw: any = null;
      for (const s of states) {
        const v = isRegression(s, hw);
        if (hw && (s.period < hw.period || s.plays < hw.plays)) {
          v.regressed ? caught++ : leaked++;     // a real regression must be caught
        } else if (hw) {
          if (v.regressed) throw new Error(`forward step wrongly rejected: ${v.reason}`);
          forward++;
        }
        hw = mergeHighWater(hw, s);              // mark only ever rises
      }
    }
    expect(leaked).toBe(0);
    expect(caught).toBeGreaterThan(0);
    expect(forward).toBeGreaterThan(0);
    console.log(`  captured timelines: ${games.length} games, ${caught} regressions caught, ${forward} forward steps allowed`);
  });
});

// Regression: ESPN omits `period` on FINAL payloads and sometimes ships no
// `drives` object at all. Coercing either to 0 marked every completed game as
// stale, which disabled its year-long cache and forced a refetch per view.
describe('absent signals are not regressions', () => {
  test('a FINAL payload with no period does not regress a 4th-quarter mark', () => {
    const final = { period: null, plays: 155, scores: [21, 14], completed: true, status: 'STATUS_FINAL' };
    expect(isRegression(final as any, st(4, 150)).regressed).toBe(false);
  });
  test('a payload with no drives object does not regress on plays', () => {
    const noDrives = { period: 4, plays: null, scores: [0, 0], completed: false, status: 'STATUS_IN_PROGRESS' };
    expect(isRegression(noDrives as any, st(4, 120)).regressed).toBe(false);
  });
  test('extractGameState reports absent as null, never 0', () => {
    const s = extractGameState({ gamepackageJSON: { header: { competitions: [{
      status: { type: { name: 'STATUS_FINAL', completed: true } }, competitors: [] } ] } } });
    expect(s!.period).toBeNull();
    expect(s!.plays).toBeNull();
  });
  test('high-water still rises when one side is unknown', () => {
    const hw = mergeHighWater(st(4, 150), { period: null, plays: null, scores: [0, 0], completed: true, status: 'STATUS_FINAL' } as any);
    expect(hw).toMatchObject({ period: 4, plays: 150, completed: true });
  });
  test('a final payload with fewer plays than a final high-water mark is post-game cleanup, not a regression', () => {
    // 401868073: ESPN trimmed 184 -> 182 plays after the game went final; the
    // guard flagged it forever and the page never cached again.
    const hw = st(4, 184, [30, 29], true, 'STATUS_FINAL');
    expect(isRegression(st(4, 182, [30, 29], true, 'STATUS_FINAL'), hw).regressed).toBe(false);
  });
  test('real regressions are still caught', () => {
    expect(isRegression(st(3, 103), st(4, 138)).regressed).toBe(true);
  });
});
