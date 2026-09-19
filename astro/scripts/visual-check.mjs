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
import { loadChromium, launchOptions, newThemedContext, DEVICES, SCHEMES, slug } from './lib/browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const OUT = process.env.OUT ?? 'img/visual';
// For posting to a PR (see scripts/lighthouse-compare.mjs --shots): JPEG keeps a
// 10k-px full-page mobile shot to a few hundred KB, and THUMBS adds an
// above-the-fold `-thumb` shot per combination, since full pages are too tall to inline.
const JPEG = process.env.VISUAL_CHECK_FORMAT === 'jpeg';
const THUMBS = Boolean(process.env.VISUAL_CHECK_THUMBS);
const shotOpts = JPEG ? { type: 'jpeg', quality: 80 } : {};
const ext = JPEG ? 'jpg' : 'png';
// Collapsed panels (`.collapse` blocks behind a [show/hide] toggle) hide their
// content from a full-page shot. VISUAL_CHECK_EXPAND lists the collapse ids to
// open before the full-page capture, comma-separated; the default opens a game
// page's two team-stats panels, whose per-player tables are otherwise never
// seen. Set it empty to shoot every page exactly as it loads. The above-the-fold
// thumbnail is taken afterwards from the top and is unaffected.
const EXPAND = (process.env.VISUAL_CHECK_EXPAND ?? 'away-stats-panel,home-stats-panel')
  .split(',').map((s) => s.trim()).filter(Boolean);
// pass routes as args; the default set is one scoreboard, one leaderboard, one
// team page -- enough surfaces that a layout/theme regression shows up.
const passed = process.argv.slice(2);
const routes = passed.length ? passed : ['/', '/nfl', '/nfl/year/2025/teams/tendencies'];

const chromium = await loadChromium();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(launchOptions());
const shots = [];
const failures = [];
try {
  for (const device of DEVICES) {
    for (const colorScheme of SCHEMES) {
      const ctx = await newThemedContext(browser, device, colorScheme);
      const page = await ctx.newPage();
      for (const route of routes) {
        const url = BASE + route;
        const where = `${route} (${device.name}/${colorScheme})`;
        const before = failures.length;
        try {
          const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
          if (res && res.status() >= 400) failures.push(`${where}: HTTP ${res.status()}`);
          await page.waitForTimeout(1200); // let islands hydrate + charts draw
        } catch (e) {
          failures.push(`${where}: ${e.message}`);
        }
        // an error page must not be saved under this combination's name (the PR comment
        // would publish it as evidence); the comment shows the combination as missing
        if (failures.length > before) continue;
        if (EXPAND.length) {
          // plain class toggles, the same state Bootstrap's collapse leaves behind
          await page.evaluate((ids) => {
            for (const id of ids) {
              const el = document.getElementById(id);
              if (!el || !el.classList.contains('collapse')) continue;
              el.classList.add('show');
              el.classList.remove('hide');
              document.querySelector(`a[data-bs-toggle="collapse"][href="#${id}"]`)?.setAttribute('aria-expanded', 'true');
            }
          }, EXPAND);
          await page.waitForTimeout(300); // let lazy islands inside the panel paint
        }
        const stem = join(OUT, `${slug(route)}-${device.name}-${colorScheme}`);
        await page.screenshot({ ...shotOpts, path: `${stem}.${ext}`, fullPage: true });
        shots.push(`${stem}.${ext}`);
        if (THUMBS) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ ...shotOpts, path: `${stem}-thumb.${ext}` });
          shots.push(`${stem}-thumb.${ext}`);
        }
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
