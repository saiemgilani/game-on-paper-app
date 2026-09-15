// Pure summary + verdict logic for lighthouse-compare.mjs, split out so vitest can
// pin the rules (test/lighthouseVerdicts.test.ts) without building two trees.

export const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const KEYS = ['performance', 'accessibility', 'bestPractices', 'seo', 'fcp', 'lcp', 'tbt', 'cls', 'si', 'ttfb', 'htmlKb', 'jsKb', 'dom'];

export function aggregate(runs = []) {
  const ok = runs.filter((r) => r && !r.error);
  const agg = { runs: ok.length, errors: runs.filter((r) => r?.error).map((r) => r.error) };
  for (const k of KEYS) {
    const v = ok.map((r) => r[k]).filter((x) => x != null);
    agg[k] = { median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  }
  agg.failingAll = ok.length ? ok[0].failing.filter((id) => ok.every((r) => r.failing.includes(id))) : [];
  agg.failingAny = [...new Set(ok.flatMap((r) => r.failing))];
  const shifts = ok.map((r) => r.shift).filter(Boolean);
  agg.shift = shifts.sort((a, b) => shifts.filter((s) => s === b).length - shifts.filter((s) => s === a).length)[0] ?? null;
  return agg;
}

const LOWER_IS_BETTER = new Set(['fcp', 'lcp', 'tbt', 'cls', 'si', 'htmlKb', 'jsKb', 'dom']);
// A delta earns a bullet only when the base and PR run ranges don't overlap AND it
// clears both floors below. Separated ranges alone aren't enough for timing metrics:
// on a shared runner, 3 runs per side of byte-identical HTML separated TBT 329 → 232 ms
// (#247), so timings also need a real share of the base median.
export const FLOOR = { performance: 0.03, fcp: 200, lcp: 200, tbt: 100, cls: 0.02, si: 250, htmlKb: 2, jsKb: 2, dom: 50 };
// Performance has no relative floor on purpose: it is already a 0-100 score, and a
// 3-point drop matters as much on a 40 page as on a 90 one (a relative floor would
// hide real drops exactly where pages are already slow).
export const REL_FLOOR = { fcp: 0.1, lcp: 0.1, tbt: 0.25, si: 0.1, cls: 0.1, htmlKb: 0.02, jsKb: 0.02, dom: 0.02 };
const LABEL = { performance: 'Performance', fcp: 'FCP', lcp: 'LCP', tbt: 'TBT', cls: 'CLS', si: 'Speed Index', htmlKb: 'HTML transfer', jsKb: 'JS transfer', dom: 'DOM elements' };

export function fmt(key, v) {
  if (v == null) return '–';
  if (['performance', 'accessibility', 'bestPractices', 'seo'].includes(key)) return String(Math.round(v * 100));
  if (['fcp', 'lcp', 'si', 'ttfb'].includes(key)) return `${(v / 1000).toFixed(1)} s`;
  if (key === 'tbt') return `${Math.round(v).toLocaleString('en-US')} ms`;
  if (key === 'cls') return v.toFixed(3);
  if (key === 'htmlKb' || key === 'jsKb') return `${Math.round(v).toLocaleString('en-US')} KB`;
  return Math.round(v).toLocaleString('en-US');
}

export const withRange = (key, m) => (fmt(key, m.min) === fmt(key, m.max) ? fmt(key, m.median) : `${fmt(key, m.median)} (${fmt(key, m.min)}–${fmt(key, m.max)})`);

export function verdicts(base, head, preset) {
  const out = [];
  for (const key of Object.keys(FLOOR)) {
    const b = base[key];
    const h = head[key];
    if (b.median == null || h.median == null) continue;
    const delta = h.median - b.median;
    if (Math.abs(delta) < FLOOR[key]) continue;
    if (REL_FLOOR[key] && Math.abs(delta) < REL_FLOOR[key] * Math.abs(b.median)) continue;
    if (!(h.min > b.max || h.max < b.min)) continue;
    const worse = LOWER_IS_BETTER.has(key) ? delta > 0 : delta < 0;
    let line = `**${worse ? 'Regression' : 'Improvement'}, ${preset} ${LABEL[key]}:** ${withRange(key, b)} → ${withRange(key, h)}`;
    if (key === 'cls' && worse && head.shift) line += `. Largest shift: \`${head.shift}\``;
    out.push({ worse, line });
  }
  const newly = head.failingAll.filter((id) => !base.failingAny.includes(id));
  const fixed = base.failingAll.filter((id) => !head.failingAny.includes(id));
  if (newly.length) out.push({ worse: true, line: `**Newly failing audits, ${preset}:** ${newly.map((i) => `\`${i}\``).join(', ')}` });
  if (fixed.length) out.push({ worse: false, line: `**Audits now passing, ${preset}:** ${fixed.map((i) => `\`${i}\``).join(', ')}` });
  return out;
}

// Astro gives every island a random `uid` per render, so two renders of the same
// page never match byte for byte. Strip that attribute -- on <astro-island> tags
// only, so a real `uid` change on any other element still counts as a change.
export const normalizeHtml = (html) =>
  html.replace(/<astro-island\b[^>]*>/g, (tag) => tag.replace(/\suid="[^"]*"/, ''));
