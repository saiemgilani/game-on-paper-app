// The spec's parity gate: for three Nets players, the header shooting line on the GOP page equals
// the one on blazingthenets.com for the same season (same release, two code paths).
//   BASE=https://<preview> COOKIE='gop_preview=...' node scripts/nba-parity.mjs 1629008 1627832 1641705
import { loadChromium, launchOptions } from './lib/browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const COOKIE = process.env.COOKIE ?? '';
const SEASON = process.env.SEASON ?? '2026';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: nba-parity.mjs <person_id>...');

const line = (t) => { const m = /(\d[\d,]*)\/(\d[\d,]*) FG[^\d]*([\d.]+)% FG%[^\d]*([\d.]+)% eFG%/.exec(t); if (!m) throw new Error(`no shooting line in: ${t.slice(0, 200)}`); return m.slice(1).join(' '); };
const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());
let failed = 0;
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const id of ids) {
    await page.goto(`https://blazingthenets.com/players/${id}?season=${SEASON}`, { waitUntil: 'networkidle' });
    const theirs = line(await page.locator('header').filter({ hasText: 'eFG%' }).first().innerText());
    // the preview cookie goes only to our own origin, never to blazingthenets.com
    await page.setExtraHTTPHeaders(COOKIE ? { cookie: COOKIE } : {});
    await page.goto(`${BASE}/nba/players/${id}?season=${SEASON}`, { waitUntil: 'networkidle' });
    await page.setExtraHTTPHeaders({});
    const ours = line(await page.locator('#nba-line').innerText());
    const ok = theirs === ours;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${id}: blazing ${theirs} | gop ${ours}`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
