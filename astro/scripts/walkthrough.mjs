// Walkthrough video: record a short clip of the site being used, per {device, scheme}, so a
// PR reviewer sees the change move, not just the screenshot matrix. See ../CLAUDE.md
// "PR evidence" — every UI PR carries BOTH the screenshots and a walkthrough.
//
//   BASE=http://localhost:4321 npm run walkthrough -- /nfl /game/401856682   # auto scroll-through per route
//   BASE=$PREVIEW_URL npm run walkthrough -- --steps scripts/walkthroughs/game-stats-panels.mjs
//
// A steps module exports `default async (page, base) => { ... }` written against the plain
// Playwright page API (goto, click, fill, waitFor...). Nothing to learn beyond Playwright.
//
// Output: img/walkthrough/<name>-<device>-<scheme>.webm, plus an .mp4 (h264, what GitHub's
// PR editor accepts by drag-and-drop) when `ffmpeg` is on PATH. Defaults record
// desktop + mobile in light; WALKTHROUGH_SCHEMES=light,dark widens
// it, WALKTHROUGH_DEVICES=desktop narrows it. Exits non-zero if any route fails to load.
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadChromium, launchOptions, newThemedContext, appliedScheme, DEVICES, SCHEMES, slug } from './lib/browser.mjs';

const BASE = (process.env.BASE ?? 'http://localhost:4321').replace(/\/$/, '');
const OUT = process.env.OUT ?? 'img/walkthrough';
const argv = process.argv.slice(2);
const stepsIdx = argv.indexOf('--steps');
const stepsPath = stepsIdx >= 0 ? argv[stepsIdx + 1] : null;
const routes = stepsIdx >= 0 ? argv.filter((_, i) => i !== stepsIdx && i !== stepsIdx + 1) : argv;
if (!stepsPath && !routes.length) routes.push('/game/401856682');

const pick = (env, all, key) => {
  const want = (process.env[env] ?? '').split(',').filter(Boolean);
  const unknown = want.filter((v) => !all.some((x) => key(x) === v));
  if (unknown.length) {
    // a typo must not become a silent "0 clips, exit 0"
    console.error(`${env}: unknown value(s) ${unknown.join(', ')}; valid: ${all.map(key).join(', ')}`);
    process.exit(2);
  }
  return want.length ? all.filter((x) => want.includes(key(x))) : null;
};
const devices = pick('WALKTHROUGH_DEVICES', DEVICES, (d) => d.name) ?? DEVICES;
const schemes = pick('WALKTHROUGH_SCHEMES', SCHEMES, (s) => s) ?? ['light'];
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

// Default walkthrough: load the route, then scroll it top to bottom at reading pace.
async function scrollThrough(page, base, route) {
  const res = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90_000 });
  if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
  await page.waitForTimeout(1500);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  // reading pace, but a long directory page must still finish inside ~30 s of footage
  const step = Math.max(240, Math.ceil(total / 120));
  for (let y = 0; y < total; y += step) {
    await page.evaluate((to) => window.scrollTo({ top: to, behavior: 'smooth' }), y + step);
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(800);
}

const steps = stepsPath ? (await import(pathToFileURL(resolve(stepsPath)).href)).default : null;
const scenarios = steps
  ? [{ name: slug(stepsPath.replace(/^.*\//, '').replace(/\.m?js$/, '')), run: (page) => steps(page, BASE) }]
  : routes.map((r) => ({ name: slug(r), run: (page) => scrollThrough(page, BASE, r) }));

const chromium = await loadChromium();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launchOptions());
const clips = [];
const failures = [];
try {
  for (const device of devices) {
    for (const scheme of schemes) {
      for (const sc of scenarios) {
        const where = `${sc.name} (${device.name}/${scheme})`;
        const stem = join(OUT, `${sc.name}-${device.name}-${scheme}`);
        const tmp = join(OUT, `.rec-${sc.name}-${device.name}-${scheme}`);
        // a failed run must leave no clip under this name: a stale one from an earlier run
        // would otherwise be attached as evidence for a combination that just failed
        await Promise.all([tmp, `${stem}.webm`, `${stem}.mp4`].map((f) => rm(f, { recursive: true, force: true })));
        const ctx = await newThemedContext(browser, device, scheme, {
          recordVideo: { dir: tmp, size: { width: device.width, height: device.height } },
        });
        const page = await ctx.newPage();
        let ok = true;
        try {
          await sc.run(page);
          const applied = await appliedScheme(page);
          if (applied !== scheme) throw new Error(`page rendered ${applied}, not ${scheme}`);
        } catch (e) {
          ok = false;
          failures.push(`${where}: ${e.message}`);
        }
        await ctx.close(); // flushes the video file
        const [file] = await readdir(tmp);
        if (!ok || !file) { await rm(tmp, { recursive: true, force: true }); continue; }
        await rename(join(tmp, file), `${stem}.webm`);
        await rm(tmp, { recursive: true, force: true });
        clips.push(`${stem}.webm`);
        if (hasFfmpeg) {
          // h264 + yuv420p + even dimensions: what GitHub's PR editor and every player accept
          const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${stem}.webm`,
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '28', '-an', `${stem}.mp4`]);
          if (r.status === 0) clips.push(`${stem}.mp4`);
          else failures.push(`${where}: ffmpeg mp4 conversion failed (webm kept)`);
        }
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`${clips.length} clip(s) -> ${OUT}/${hasFfmpeg ? '' : '  (no ffmpeg on PATH: webm only)'}`);
for (const c of clips) console.log('  ' + c);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error('  ' + f);
  process.exitCode = 1;
}
