// Visual verification: shoot the {desktop, mobile} x {light, dark} matrix for a
// set of routes, so a change to any rendered page/component/CSS is reviewed the
// way people actually see it. See ../../CLAUDE.md "Visual verification".
//
//   BASE=https://gameonpaper.com node scripts/visual-check.mjs /nfl /nfl/year/2025/teams/tendencies
//   node scripts/visual-check.mjs                 # BASE defaults to localhost:4321, default routes
//
// Deliberately NOT a repo dependency (keeps npm ci lean): the driver is
// playwright-core, resolved from wherever it is installed. If it is missing:
//   npm i -g playwright-core          # or -D in astro/, or `npx playwright-core`
// and a Chrome/Chromium: $VISUAL_CHECK_EXECUTABLE (a chrome binary path) or the
// developer's installed Google Chrome (channel). playwright-core pulls no
// browser on install, so this never downloads one.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

async function loadChromium() {
  // try a normal resolve first (astro devDep / global), then NODE_PATH entries
  try { return (await import('playwright-core')).chromium; } catch {}
  const req = createRequire(import.meta.url);
  for (const base of (process.env.NODE_PATH ?? '').split(':').filter(Boolean)) {
    try { return req(join(base, 'playwright-core')).chromium; } catch {}
  }
  console.error('playwright-core not found. Install it: `npm i -g playwright-core` '
    + '(or `npm i -D playwright-core` in astro/), then re-run. It pulls no browser.');
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
const launch = process.env.VISUAL_CHECK_EXECUTABLE
  ? { executablePath: process.env.VISUAL_CHECK_EXECUTABLE, args: ['--no-sandbox'] }
  : { channel: 'chrome', args: ['--no-sandbox'] };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launch);
const shots = [];
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
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
          await page.waitForTimeout(1200); // let islands hydrate + charts draw
        } catch (e) {
          console.error(`WARN ${url} (${device.name}/${colorScheme}): ${e.message}`);
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
