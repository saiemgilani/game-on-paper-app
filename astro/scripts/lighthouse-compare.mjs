// Lighthouse comparison of a PR against its base, the evidence CLAUDE.md
// "PR evidence" requires (and .github/workflows/pr-evidence.yml posts on every PR).
//
//   node scripts/lighthouse-compare.mjs --base origin/main --head HEAD /game/401856682
//   node scripts/lighthouse-compare.mjs --python-url http://127.0.0.1:5177 \
//     --backend-cmd 'uv run gunicorn app:app -c gunicorn.conf.py -b 127.0.0.1:5177' --shots /game/401856682
//
// For each of base and head it checks out a git worktree, `npm ci`s it (skipped
// when the lockfile is unchanged since the last run), forces every 'preview' feature
// flag to 'on' (or only --flags) so both sides render the same surfaces, runs
// `astro build`, serves the build with `astro preview` (plus --backend-cmd, run from
// that tree's python/, so a processor change is measured too), and saves each
// route's rendered HTML.
//
// Modes (--mode):
//   frontend (default): Lighthouse against each tree's saved HTML plus its own
//     dist/client, from an in-process gzip server. TTFB is ~0, so the numbers
//     measure what the branch ships, not uncached local processing (15-20 s on a
//     game page, which swamps any frontend delta). Base and head runs alternate so
//     machine drift hits both sides. `astro preview` doesn't compress, so this
//     is also the only mode whose HTML/JS sizes match production.
//   e2e: Lighthouse against the live preview. both: frontend and e2e.
//
// Performance swings 10+ points between identical builds, so every metric keeps its
// min-max run range and a delta is called a regression only when the ranges don't
// overlap. Writes <out>/summary.json and <out>/lighthouse.md; raw reports go in
// <out>/reports/. --shots also runs visual-check.mjs (JPEG + above-the-fold thumbs)
// against the head preview into <out>/shots/.
//
// Not repo dependencies (keeps `npm ci` lean): lighthouse is resolved from
// astro/node_modules, `npm root -g`, or NODE_PATH (`npm i -g lighthouse`). Chrome
// comes from CHROME_PATH or the installed Google Chrome. Set LIGHTHOUSE_NO_SANDBOX=1
// for a root container or an Ubuntu 24.04 runner. When the host can't run workerd
// (glibc < 2.35), set LH_ASTRO_PREFIX to a command prefix for the npm/astro steps.
// `{cwd}` expands to the tree's astro dir, e.g.
//   LH_ASTRO_PREFIX='docker run --rm --init --network host -v /tmp:/tmp -v {cwd}:{cwd} -w {cwd} node:22-bookworm'
import { parseArgs } from 'node:util';
import { spawn, spawnSync, execFileSync, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const { values: opt, positionals: routes } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string', default: 'origin/main' },
    head: { type: 'string', default: 'HEAD' },
    runs: { type: 'string', default: '3' },
    mode: { type: 'string', default: 'frontend' },
    presets: { type: 'string', default: 'mobile,desktop' },
    flags: { type: 'string' },
    'python-url': { type: 'string' },
    'backend-cmd': { type: 'string' },
    expect: { type: 'string' },
    shots: { type: 'boolean', default: false },
    out: { type: 'string' },
    work: { type: 'string' },
    port: { type: 'string', default: '4321' },
    'static-port': { type: 'string', default: '4398' },
    keep: { type: 'boolean', default: false },
  },
});

const ASTRO = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = execFileSync('git', ['-C', ASTRO, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const RUNS = Number(opt.runs);
const PRESETS = opt.presets.split(',').filter(Boolean);
const MODES = opt.mode === 'both' ? ['frontend', 'e2e'] : [opt.mode];
const PORT = Number(opt.port);
const STATIC_PORT = Number(opt['static-port']);

function usage(msg) {
  console.error(`${msg}\nusage: node scripts/lighthouse-compare.mjs [--base ref] [--head ref] [--runs 3] [--mode frontend|e2e|both]
  [--presets mobile,desktop] [--flags a,b] [--python-url url] [--backend-cmd cmd] [--expect text] [--shots]
  [--out dir] [--work dir] [--keep] <route> [route...]`);
  process.exit(2);
}
if (!routes.length) usage('at least one route is required');
if (!routes.every((r) => r.startsWith('/'))) usage('routes are paths starting with "/"');
if (!(RUNS >= 1)) usage('--runs must be >= 1');
if (!MODES.every((m) => m === 'frontend' || m === 'e2e')) usage(`unknown --mode ${opt.mode}`);
if (!PRESETS.every((p) => p === 'mobile' || p === 'desktop')) usage(`unknown preset in --presets ${opt.presets}`);
if (opt['backend-cmd'] && !opt['python-url']) usage('--backend-cmd needs --python-url (the address it serves)');

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
const sha = { base: git('rev-parse', `${opt.base}^{commit}`), head: git('rev-parse', `${opt.head}^{commit}`) };
const short = (s) => s.slice(0, 7);
const OUT = resolve(opt.out ?? join(ASTRO, 'img', 'lighthouse', `${short(sha.base)}-${short(sha.head)}`));
const WORK = resolve(opt.work ?? join(tmpdir(), 'gop-lighthouse'));
mkdirSync(join(OUT, 'reports'), { recursive: true });
mkdirSync(join(OUT, 'logs'), { recursive: true });

const slug = (r) => (r === '/' ? 'home' : r.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '-'));
const say = (msg) => console.log(`[lighthouse-compare] ${msg}`);

// ---------------------------------------------------------------- lighthouse CLI
function findLighthouse() {
  const roots = [join(ASTRO, 'node_modules')];
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {}
  roots.push(...(process.env.NODE_PATH ?? '').split(':').filter(Boolean));
  for (const root of roots) {
    const cli = join(root, 'lighthouse', 'cli', 'index.js');
    if (existsSync(cli)) return cli;
  }
  console.error('lighthouse not found. Install it (not a repo dependency): `npm i -g lighthouse`, then re-run.');
  process.exit(2);
}
const LIGHTHOUSE = findLighthouse();

// ---------------------------------------------------------------- processes
const children = new Set();
process.on('exit', () => {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGKILL'); } catch {}
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

// npm/astro steps run through LH_ASTRO_PREFIX when set (see header).
function astroCommand(cwd, args) {
  const prefix = (process.env.LH_ASTRO_PREFIX ?? '').trim();
  if (!prefix) return [args[0] === 'node' ? process.execPath : args[0], args.slice(1)];
  const words = prefix.replaceAll('{cwd}', cwd).split(/\s+/);
  return [words[0], [...words.slice(1), ...args]];
}

function tail(file, lines = 40) {
  try { return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return ''; }
}

function runStep(cwd, args, log) {
  const [bin, rest] = astroCommand(cwd, args);
  const fd = openSync(log, 'a');
  const r = spawnSync(bin, rest, { cwd, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  if (r.status !== 0) throw new Error(`\`${args.join(' ')}\` failed in ${cwd} (exit ${r.status})\n${tail(log)}`);
}

function startBackground(cwd, bin, args, log) {
  const fd = openSync(log, 'a');
  // own process group, so stop() also reaches uv -> gunicorn -> workers
  const child = spawn(bin, args, { cwd, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  children.add(child);
  return child;
}

async function stop(child) {
  if (!child) return;
  children.delete(child);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  if ((await Promise.race([exited.then(() => true), sleep(15_000).then(() => false)])) === false) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
}

async function waitUp(url, child, log, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`process serving ${url} exited early\n${tail(log)}`);
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(5_000) });
      return;
    } catch {}
    await sleep(1_000);
  }
  throw new Error(`${url} not up after ${timeoutMs / 1000}s\n${tail(log)}`);
}

async function waitDown(url, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { await fetch(url, { signal: AbortSignal.timeout(2_000) }); } catch { return; }
    await sleep(500);
  }
}

// ---------------------------------------------------------------- trees
function prepareTree(name) {
  const dir = join(WORK, `${name}-${short(sha[name])}`);
  const log = join(OUT, 'logs', `${name}.log`);
  let current = null;
  try {
    current = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  if (current !== sha[name]) {
    if (existsSync(dir)) {
      try { git('worktree', 'remove', '--force', dir); } catch { rmSync(dir, { recursive: true, force: true }); }
      git('worktree', 'prune');
    }
    mkdirSync(WORK, { recursive: true });
    say(`${name}: worktree ${short(sha[name])} -> ${dir}`);
    git('worktree', 'add', '--detach', dir, sha[name]);
  }
  const astro = join(dir, 'astro');
  // local secrets (git-ignored) come from the checkout running this script
  for (const f of ['.env', '.dev.vars']) {
    if (existsSync(join(ASTRO, f))) copyFileSync(join(ASTRO, f), join(astro, f));
  }

  const flagsOn = [];
  const features = join(astro, 'src', 'utils', 'features.ts');
  if (existsSync(features)) {
    const only = opt.flags ? new Set(opt.flags.split(',')) : null;
    const src = readFileSync(features, 'utf8').replace(
      /(['"])([\w-]+)\1(\s*:\s*)(['"])preview\4/g,
      (m, q, key, colon, q2) => {
        if (only && !only.has(key)) return m;
        flagsOn.push(key);
        return `${q}${key}${q}${colon}${q2}on${q2}`;
      },
    );
    writeFileSync(features, src);
  }

  const lockHash = createHash('sha256').update(readFileSync(join(astro, 'package-lock.json'))).digest('hex');
  const marker = join(astro, 'node_modules', '.lighthouse-compare-lock');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== lockHash) {
    say(`${name}: npm ci`);
    runStep(astro, ['npm', 'ci', '--no-audit', '--no-fund'], log);
    writeFileSync(marker, lockHash);
  }
  say(`${name}: astro build (flags on: ${flagsOn.join(', ') || 'none'})`);
  rmSync(join(astro, 'dist'), { recursive: true, force: true });
  runStep(astro, ['node', 'node_modules/astro/bin/astro.mjs', 'build'], log);

  // The build copies only *secrets* into dist/server/.dev.vars; PYTHON_HTTP_URL is
  // a plain var in wrangler.jsonc, so it has to be rewritten in the generated config.
  const wrangler = join(astro, 'dist', 'server', 'wrangler.json');
  if (opt['python-url'] && existsSync(wrangler)) {
    const cfg = JSON.parse(readFileSync(wrangler, 'utf8'));
    cfg.vars = { ...(cfg.vars ?? {}), PYTHON_HTTP_URL: opt['python-url'] };
    if (['127.0.0.1', 'localhost'].includes(new URL(opt['python-url']).hostname)) {
      // this flag makes workerd refuse fetches to private addresses
      cfg.compatibility_flags = (cfg.compatibility_flags ?? []).filter((f) => f !== 'global_fetch_strictly_public');
    }
    writeFileSync(wrangler, JSON.stringify(cfg, null, 2));
  }
  return { name, sha: sha[name], dir, astro, log, flagsOn };
}

function removeTree(tree) {
  try { git('worktree', 'remove', '--force', tree.dir); } catch {}
}

async function withPreview(tree, fn) {
  let backend = null;
  let preview = null;
  const origin = `http://127.0.0.1:${PORT}`;
  try {
    if (opt['backend-cmd']) {
      say(`${tree.name}: starting backend`);
      backend = startBackground(join(tree.dir, 'python'), 'sh', ['-c', opt['backend-cmd']], tree.log);
      await waitUp(opt['python-url'], backend, tree.log, 600_000);
    }
    // A preview lock left by an earlier run names PID 1, which is always alive
    // inside a fresh container, so `--force` never clears it. Delete it instead.
    rmSync(join(tree.astro, '.astro', 'preview.json'), { force: true });
    const [bin, args] = astroCommand(tree.astro, ['node', 'node_modules/astro/bin/astro.mjs', 'preview', '--host', '127.0.0.1', '--port', String(PORT)]);
    preview = startBackground(tree.astro, bin, args, tree.log);
    await waitUp(`${origin}/`, preview, tree.log, 180_000);
    return await fn(origin);
  } finally {
    await stop(preview);
    await stop(backend);
    await waitDown(`${origin}/`);
    if (opt['python-url']) await waitDown(opt['python-url']);
  }
}

// ---------------------------------------------------------------- capture + serve
async function capture(tree, origin) {
  const pages = {};
  for (const route of routes) {
    let res, body, ms;
    // first request pays page generation; the second is the warm response
    for (let i = 0; i < 2; i++) {
      const t0 = performance.now();
      res = await fetch(origin + route, { signal: AbortSignal.timeout(300_000) });
      ms = performance.now() - t0;
      body = await res.text();
    }
    const title = (body.match(/<title>([^<]*)/i)?.[1] ?? '').trim();
    if (!res.ok) throw new Error(`${tree.name} ${route}: HTTP ${res.status}`);
    // error pages answer 200 on this site ("Game Unprocessable" when the processor is unreachable)
    if (/unprocessable|not found|^error/i.test(title)) throw new Error(`${tree.name} ${route}: rendered an error page ("${title}"); is the processor reachable?`);
    if (opt.expect && !body.includes(opt.expect)) throw new Error(`${tree.name} ${route}: response lacks --expect text`);
    const file = join(OUT, 'html', tree.name, `${slug(route)}.html`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    pages[route] = { file, title, bytes: Buffer.byteLength(body), warmMs: Math.round(ms) };
    say(`${tree.name} ${route}: "${title}" ${(pages[route].bytes / 1024).toFixed(0)} KB, warm response ${(ms / 1000).toFixed(1)} s`);
  }
  return pages;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const trimSlash = (p) => p.replace(/\/+$/, '') || '/';

function serveStatic(tree, pages, port) {
  const client = existsSync(join(tree.astro, 'dist', 'client')) ? join(tree.astro, 'dist', 'client') : join(tree.astro, 'dist');
  const html = new Map(Object.entries(pages).map(([route, p]) => [trimSlash(route), p.file]));
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = html.get(trimSlash(path));
    let type = TYPES['.html'];
    if (!file) {
      const candidate = resolve(client, `.${path}`);
      if (candidate.startsWith(client + sep) && existsSync(candidate) && statSync(candidate).isFile()) {
        file = candidate;
        type = TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream';
      }
    }
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = readFileSync(file);
    const headers = { 'Content-Type': type };
    if (path.startsWith('/_astro/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    if (/^(text\/|application\/(json|xml)|image\/svg)/.test(type)) {
      body = gzipSync(body, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

// ---------------------------------------------------------------- lighthouse runs
function metrics(report) {
  const num = (id) => report.audits[id]?.numericValue ?? null;
  const items = report.audits['resource-summary']?.details?.items ?? [];
  const kb = (type) => (items.find((i) => i.resourceType === type)?.transferSize ?? 0) / 1024;
  const failing = [];
  for (const cat of Object.values(report.categories)) {
    for (const ref of cat.auditRefs) {
      if (ref.weight > 0 && report.audits[ref.id]?.score === 0) failing.push(ref.id);
    }
  }
  const cat = (id) => (report.categories[id]?.score ?? null);
  return {
    performance: cat('performance'), accessibility: cat('accessibility'), bestPractices: cat('best-practices'), seo: cat('seo'),
    fcp: num('first-contentful-paint'), lcp: num('largest-contentful-paint'), tbt: num('total-blocking-time'),
    cls: num('cumulative-layout-shift'), si: num('speed-index'), ttfb: num('server-response-time'),
    htmlKb: kb('document'), jsKb: kb('script'), dom: num('dom-size'),
    failing: [...new Set(failing)],
    shift: report.audits['layout-shifts']?.details?.items?.[0]?.node?.selector ?? null,
  };
}

function lighthouse(url, preset, reportPath) {
  const chromeFlags = ['--headless=new', '--disable-gpu'];
  if (process.env.LIGHTHOUSE_NO_SANDBOX || process.env.VISUAL_CHECK_NO_SANDBOX) chromeFlags.push('--no-sandbox');
  const args = [LIGHTHOUSE, url, '--output=json', `--output-path=${reportPath}`, '--quiet',
    `--chrome-flags=${chromeFlags.join(' ')}`, '--max-wait-for-load=90000'];
  if (preset === 'desktop') args.push('--preset=desktop');
  // async: the frontend server lives in this process and must keep answering
  return new Promise((ok) => {
    let stderr = '';
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !existsSync(reportPath)) return ok({ error: stderr.trim().split('\n').pop() || `exit ${code}` });
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        if (report.runtimeError) return ok({ error: report.runtimeError.message });
        ok(metrics(report));
      } catch (e) {
        ok({ error: e.message });
      }
    });
  });
}

const results = {}; // results[mode][route][preset][tree] = [run metrics]
function record(mode, route, preset, tree, run, value) {
  const slot = (((results[mode] ??= {})[route] ??= {})[preset] ??= {});
  (slot[tree] ??= [])[run] = value;
  const perf = value.error ? `ERROR ${value.error}` : `perf ${Math.round(value.performance * 100)}`;
  say(`${mode} ${route} ${preset} ${tree} run ${run + 1}/${RUNS}: ${perf}`);
}

async function lighthouseLoop(mode, trees, origins) {
  for (const route of routes) {
    for (const preset of PRESETS) {
      for (let run = 0; run < RUNS; run++) {
        // alternate which tree goes first so drift over the loop lands on both
        const order = run % 2 ? [...trees].reverse() : trees;
        for (const tree of order) {
          const report = join(OUT, 'reports', `${mode}-${slug(route)}-${preset}-${tree.name}-${run + 1}.json`);
          record(mode, route, preset, tree.name, run, await lighthouse(origins[tree.name] + route, preset, report));
        }
      }
    }
  }
}

// ---------------------------------------------------------------- summary
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const KEYS = ['performance', 'accessibility', 'bestPractices', 'seo', 'fcp', 'lcp', 'tbt', 'cls', 'si', 'ttfb', 'htmlKb', 'jsKb', 'dom'];

function aggregate(runs = []) {
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
// deltas smaller than these are not worth a bullet even when ranges separate
const FLOOR = { performance: 0.01, fcp: 200, lcp: 200, tbt: 50, cls: 0.02, si: 250, htmlKb: 2, jsKb: 2, dom: 50 };
const LABEL = { performance: 'Performance', fcp: 'FCP', lcp: 'LCP', tbt: 'TBT', cls: 'CLS', si: 'Speed Index', htmlKb: 'HTML transfer', jsKb: 'JS transfer', dom: 'DOM elements' };

function fmt(key, v) {
  if (v == null) return '–';
  if (['performance', 'accessibility', 'bestPractices', 'seo'].includes(key)) return String(Math.round(v * 100));
  if (['fcp', 'lcp', 'si', 'ttfb'].includes(key)) return `${(v / 1000).toFixed(1)} s`;
  if (key === 'tbt') return `${Math.round(v).toLocaleString('en-US')} ms`;
  if (key === 'cls') return v.toFixed(3);
  if (key === 'htmlKb' || key === 'jsKb') return `${Math.round(v).toLocaleString('en-US')} KB`;
  return Math.round(v).toLocaleString('en-US');
}
const withRange = (key, m) => (fmt(key, m.min) === fmt(key, m.max) ? fmt(key, m.median) : `${fmt(key, m.median)} (${fmt(key, m.min)}–${fmt(key, m.max)})`);

function verdicts(base, head, preset) {
  const out = [];
  for (const key of Object.keys(FLOOR)) {
    const b = base[key];
    const h = head[key];
    if (b.median == null || h.median == null) continue;
    const delta = h.median - b.median;
    if (Math.abs(delta) < FLOOR[key]) continue;
    const separated = h.min > b.max || h.max < b.min;
    const sizeKey = key === 'htmlKb' || key === 'jsKb' || key === 'dom';
    if (!separated || (sizeKey && Math.abs(delta) / Math.max(b.median, 1) < 0.02)) continue;
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

function markdown(summary) {
  const lines = [];
  const flags = summary.flagsOn.length ? summary.flagsOn.map((f) => `\`${f}\``).join(', ') : 'none';
  lines.push(`Base \`${short(sha.base)}\` → head \`${short(sha.head)}\` · ${RUNS} run${RUNS > 1 ? 's' : ''} per preset, median (min–max) · preview flags forced on: ${flags}`);
  for (const mode of MODES) {
    for (const route of routes) {
      const byPreset = summary.results[mode]?.[route];
      if (!byPreset) continue;
      lines.push('', `#### \`${route}\`: ${mode === 'frontend' ? 'frontend-only (saved HTML + built assets, gzip, no server wait)' : 'end-to-end (astro preview + local processor; uncompressed)'}`, '');
      const cols = PRESETS.flatMap((p) => [`base ${p}`, `PR ${p}`]);
      lines.push(`| | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
      const cell = (p, t, key) => (byPreset[p][t][key].median == null ? '–' : withRange(key, byPreset[p][t][key]));
      const row = (label, fn) => lines.push(`| ${label} | ${PRESETS.flatMap((p) => ['base', 'head'].map((t) => fn(p, t))).join(' | ')} |`);
      row('Performance', (p, t) => cell(p, t, 'performance'));
      row('Accessibility', (p, t) => fmt('accessibility', byPreset[p][t].accessibility.median));
      row('Best Practices', (p, t) => fmt('bestPractices', byPreset[p][t].bestPractices.median));
      row('SEO', (p, t) => fmt('seo', byPreset[p][t].seo.median));
      row('FCP / LCP', (p, t) => `${fmt('fcp', byPreset[p][t].fcp.median)} / ${fmt('lcp', byPreset[p][t].lcp.median)}`);
      row('TBT', (p, t) => cell(p, t, 'tbt'));
      row('CLS', (p, t) => cell(p, t, 'cls'));
      row('Speed Index', (p, t) => fmt('si', byPreset[p][t].si.median));
      row('HTML / JS transfer', (p, t) => `${fmt('htmlKb', byPreset[p][t].htmlKb.median)} / ${fmt('jsKb', byPreset[p][t].jsKb.median)}`);
      row('DOM elements', (p, t) => fmt('dom', byPreset[p][t].dom.median));
      if (mode === 'e2e') row('Server response', (p, t) => fmt('ttfb', byPreset[p][t].ttfb.median));
      const errors = PRESETS.flatMap((p) => ['base', 'head'].flatMap((t) => byPreset[p][t].errors.map((e) => `${t} ${p}: ${e}`)));
      // regressions first: they are what a reviewer has to act on
      const found = PRESETS.flatMap((p) => verdicts(byPreset[p].base, byPreset[p].head, p)).sort((a, b) => b.worse - a.worse);
      lines.push('');
      if (found.length) for (const v of found) lines.push(`- ${v.worse ? '🔴' : '🟢'} ${v.line}`);
      else lines.push('- No change beyond run-to-run noise (every metric\'s base and PR run ranges overlap).');
      for (const e of errors) lines.push(`- ⚠️ failed run, ${e}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- main
const trees = {};
const pages = {};
const failures = [];
try {
  trees.base = prepareTree('base');
  trees.head = prepareTree('head');

  for (const name of ['base', 'head']) {
    await withPreview(trees[name], async (origin) => {
      pages[name] = await capture(trees[name], origin);
      if (MODES.includes('e2e')) {
        for (const route of routes) {
          for (const preset of PRESETS) {
            for (let run = 0; run < RUNS; run++) {
              const report = join(OUT, 'reports', `e2e-${slug(route)}-${preset}-${name}-${run + 1}.json`);
              record('e2e', route, preset, name, run, await lighthouse(origin + route, preset, report));
            }
          }
        }
      }
      if (opt.shots && name === 'head') {
        say('head: screenshots (desktop/mobile x light/dark)');
        const code = await new Promise((ok) => {
          const child = spawn(process.execPath, [join(ASTRO, 'scripts', 'visual-check.mjs'), ...routes], {
            stdio: 'inherit',
            env: { ...process.env, BASE: origin, OUT: join(OUT, 'shots'), VISUAL_CHECK_FORMAT: 'jpeg', VISUAL_CHECK_THUMBS: '1' },
          });
          child.on('exit', ok);
        });
        if (code !== 0) failures.push(`visual-check exited ${code}`);
      }
    });
  }

  if (MODES.includes('frontend')) {
    const servers = [await serveStatic(trees.base, pages.base, STATIC_PORT), await serveStatic(trees.head, pages.head, STATIC_PORT + 1)];
    try {
      const origins = { base: `http://127.0.0.1:${STATIC_PORT}`, head: `http://127.0.0.1:${STATIC_PORT + 1}` };
      await lighthouseLoop('frontend', [trees.base, trees.head], origins);
    } finally {
      for (const s of servers) s.close();
    }
  }
} catch (e) {
  failures.push(e.message);
  console.error(`[lighthouse-compare] ${e.message}`);
} finally {
  if (!opt.keep) for (const t of Object.values(trees)) removeTree(t);
}

const summary = {
  base: { ref: opt.base, sha: sha.base },
  head: { ref: opt.head, sha: sha.head },
  routes, presets: PRESETS, modes: MODES, runs: RUNS,
  flagsOn: trees.head?.flagsOn ?? [],
  pages: Object.fromEntries(Object.entries(pages).map(([t, ps]) => [t, Object.fromEntries(Object.entries(ps).map(([r, p]) => [r, { title: p.title, bytes: p.bytes, warmMs: p.warmMs }]))])),
  results: {},
  failures,
};
for (const [mode, byRoute] of Object.entries(results)) {
  for (const [route, byPreset] of Object.entries(byRoute)) {
    for (const [preset, byTree] of Object.entries(byPreset)) {
      ((summary.results[mode] ??= {})[route] ??= {})[preset] = { base: aggregate(byTree.base), head: aggregate(byTree.head) };
    }
  }
}
// verdicts need both sides for every preset; a failed setup leaves results empty
const complete = MODES.every((m) => routes.every((r) => PRESETS.every((p) => summary.results[m]?.[r]?.[p])));
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(OUT, 'lighthouse.md'), complete ? markdown(summary) : `Lighthouse comparison incomplete:\n\n${failures.map((f) => `- ${f.split('\n')[0]}`).join('\n')}`);
say(`wrote ${join(OUT, 'lighthouse.md')} and summary.json`);
if (failures.length || !complete) process.exitCode = 1;
