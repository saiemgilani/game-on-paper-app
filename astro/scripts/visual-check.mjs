// Visual verification: shoot the {desktop, mobile} x {light, dark} matrix for a
// set of routes, so a change to any rendered page/component/CSS is reviewed the
// way people actually see it. See ../../CLAUDE.md "Visual verification".
//
//   BASE=https://gameonpaper.com node scripts/visual-check.mjs /nfl /nfl/year/2025/teams/tendencies
//   node scripts/visual-check.mjs                 # BASE defaults to localhost:4321, default routes
//
// Deliberately NOT a repo dependency (keeps npm ci lean): the driver is
// playwright-core, resolved from a local (`npm i -D playwright-core`) OR global
// (`npm i -g playwright-core`) install. It pulls NO browser on install; it
// drives the developer's installed Google Chrome, or the chromium at
// $VISUAL_CHECK_EXECUTABLE. Exits non-zero if any route fails to load, so a dead
// server or a 404 can't pass off an error-page screenshot as valid.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

async function loadChromium() {
  // 1) a normal resolve (local devDep) 2) the global npm root (npm i -g)
  // 3) any NODE_PATH entry
  try { return (await import('playwright-core')).chromium; } catch {}
  const req = createRequire(import.meta.url);
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  roots.push(...(process.env.NODE_PATH ?? '').split(':').filter(Boolean));
  for (const base of roots) {
    try { return req(join(base, 'playwright-core')).chromium; } catch {}
  }
  console.error('playwright-core not found. Install it (it downloads no browser): '
    + '`npm i -g playwright-core` or `npm i -D playwright-core` in astro/, then re-run.');
  process.exit(2);
}

const BASE = process.env.BASE ?? 'http://localhost:4321';
const OUT = process.env.OUT ?? 'img/visual';
// pass routes as args; the default set is one scoreboard, one leaderboard, one
// team page -- enough surfaces that a layout/theme regression shows up.
const passed = process.argv.slice(2);
const routes = passed.length ? passed : ['/', '/nfl', '/nfl/year/2025/teams/tendencies'];

// the review matrix -- never fewer than these four per route
const DEVICES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

const slug = (r) => (r === '/' ? 'home' : r.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '-'));

const chromium = await loadChromium();
// The Chrome sandbox stays ON for a developer's Chrome; only an isolated
// container running as root needs it off (opt in with VISUAL_CHECK_NO_SANDBOX=1).
const args = process.env.VISUAL_CHECK_NO_SANDBOX ? ['--no-sandbox'] : [];
const launch = process.env.VISUAL_CHECK_EXECUTABLE
  ? { executablePath: process.env.VISUAL_CHECK_EXECUTABLE, args }
  : { channel: 'chrome', args };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launch);
const shots = [];
const failures = [];
try {
  for (const device of DEVICES) {
    for (const colorScheme of SCHEMES) {
      const ctx = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        colorScheme,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      for (const route of routes) {
        const url = BASE + route;
        const where = `${route} (${device.name}/${colorScheme})`;
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
          if (res && res.status() >= 400) failures.push(`${where}: HTTP ${res.status()}`);
          await page.waitForTimeout(1200); // let islands hydrate + charts draw
        } catch (e) {
          failures.push(`${where}: ${e.message}`);
        }
        const path = join(OUT, `${slug(route)}-${device.name}-${colorScheme}.png`);
        await page.screenshot({ path, fullPage: true });
        shots.push(path);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`${shots.length} screenshots -> ${OUT}/`);
for (const s of shots) console.log('  ' + s);
if (failures.length) {
  console.error(`\n${failures.length} route(s) failed to load — screenshots may be error pages:`);
  for (const f of failures) console.error('  ' + f);
  process.exitCode = 1;
}
