import { describe, expect, test } from 'vitest';
// @ts-ignore -- plain .mjs script module, no type declarations
import { aggregate, normalizeHtml, verdicts } from '../scripts/lighthouse-verdicts.mjs';

// one Lighthouse run's metrics, with overrides
const run = (m: Record<string, number>, failing: string[] = []) => ({
  performance: 0.6, accessibility: 0.86, bestPractices: 0.96, seo: 1,
  fcp: 3000, lcp: 3500, tbt: 300, cls: 0.2, si: 3000, ttfb: 5, htmlKb: 111, jsKb: 146, dom: 14839,
  failing, shift: null, ...m,
});
const side = (runs: Record<string, number>[], failing: string[] = []) => aggregate(runs.map((m) => run(m, failing)));
const lines = (base: any, head: any) => verdicts(base, head, 'mobile').map((v: any) => v.line);

describe('verdicts', () => {
  test('#247: byte-identical HTML whose 3-run TBT ranges separated (329 → 232 ms) is not flagged', () => {
    const base = side([{ tbt: 284 }, { tbt: 329 }, { tbt: 334 }]);
    const head = side([{ tbt: 226 }, { tbt: 232 }, { tbt: 235 }]);
    expect(lines(base, head)).toEqual([]);
  });

  test('#243: real regressions are still flagged', () => {
    const base = side([{ performance: 0.56, tbt: 473, cls: 0.229, lcp: 3800, htmlKb: 111 }, { performance: 0.57, tbt: 570, cls: 0.229, lcp: 3900, htmlKb: 111 }]);
    const head = side([{ performance: 0.40, tbt: 888, cls: 0.262, lcp: 4200, htmlKb: 168 }, { performance: 0.43, tbt: 1399, cls: 0.262, lcp: 4400, htmlKb: 168 }], ['select-name']);
    const out = lines(base, head).join('\n');
    expect(out).toContain('Regression, mobile Performance');
    expect(out).toContain('Regression, mobile TBT');
    expect(out).toContain('Regression, mobile LCP');
    expect(out).toContain('Regression, mobile CLS');
    expect(out).toContain('Regression, mobile HTML transfer');
    expect(out).toContain('Newly failing audits, mobile:** `select-name`');
  });

  test('overlapping ranges are never flagged, however large the median gap', () => {
    const base = side([{ performance: 0.51 }, { performance: 0.69 }, { performance: 0.65 }]);
    const head = side([{ performance: 0.55 }, { performance: 0.72 }, { performance: 0.57 }]);
    expect(lines(base, head)).toEqual([]);
  });

  test('a 2-point Performance gap with separated ranges is below the floor', () => {
    const base = side([{ performance: 0.60 }, { performance: 0.61 }]);
    const head = side([{ performance: 0.58 }, { performance: 0.585 }]);
    expect(lines(base, head)).toEqual([]);
  });

  test('improvements read as improvements', () => {
    const base = side([{ tbt: 900 }, { tbt: 1000 }]);
    const head = side([{ tbt: 400 }, { tbt: 450 }]);
    expect(lines(base, head)).toEqual([expect.stringContaining('Improvement, mobile TBT')]);
  });
});

describe('normalizeHtml', () => {
  test('ignores Astro island uids, nothing else', () => {
    const a = '<astro-island uid="1ojDVd" component-url="/_astro/LocalDate.js"></astro-island>';
    const b = '<astro-island uid="pvyKW" component-url="/_astro/LocalDate.js"></astro-island>';
    expect(normalizeHtml(a)).toBe(normalizeHtml(b));
    expect(normalizeHtml(a)).not.toBe(normalizeHtml(b.replace('LocalDate', 'OtherDate')));
  });
});
