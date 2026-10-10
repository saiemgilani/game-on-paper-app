// The spec's parity gate: for three Nets players, the header shooting line on the GOP page equals
// the one on blazingthenets.com for the same season (same release, two code paths).
//   BASE=https://<preview> COOKIE='gop_preview=...' node scripts/nba-parity.mjs 1629008 1627832 1641705
import { loadChromium, launchOptions } from './lib/browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const COOKIE = process.env.COOKIE ?? '';
const SEASON = process.env.SEASON ?? '2026';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: nba-parity.mjs <person_id>...');

const line = (t) => { const m = /(\d[\d,]*)\/(\d[\d,]*) FG[^\d]*([\d.]+)% FG%[^\d]*([\d.]+)% eFG%[^\d]*([\d.]+)% 3P%[^\d]*(\d[\d,]*)\/(\d[\d,]*)/.exec(t); if (!m) throw new Error(`no shooting line in: ${t.slice(0, 200)}`); return m.slice(1).join(' '); };
const chromium = await loadChromium();
const browser = await chromium.launch(launchOptions());
let failed = 0;
try {
  const ctx = await browser.newContext();
  // browser-scoped cookies (as visual-check.mjs): sent only to BASE's host, never to blazingthenets.com
  const { hostname, protocol } = new URL(BASE);
  const cookies = COOKIE.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
    const i = c.indexOf('=');
    return { name: c.slice(0, i), value: c.slice(i + 1), domain: hostname, path: '/', secure: protocol === 'https:' };
  });
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  for (const id of ids) {
    const theirUrl = `https://blazingthenets.com/players/${id}?season=${SEASON}`;
    const r1 = await page.goto(theirUrl, { waitUntil: 'networkidle' });
    if (!r1 || !r1.ok()) throw new Error(`goto ${theirUrl} failed: status ${r1 ? r1.status() : '(no response)'}`);
    const theirs = line(await page.locator('header').filter({ hasText: 'eFG%' }).first().innerText());
    const ourUrl = `${BASE}/nba/players/${id}?season=${SEASON}`;
    const r2 = await page.goto(ourUrl, { waitUntil: 'networkidle' });
    if (!r2 || !r2.ok()) throw new Error(`goto ${ourUrl} failed: status ${r2 ? r2.status() : '(no response)'}`);
    const ours = line(await page.locator('#nba-line').innerText());
    const ok = theirs === ours;
    if (!ok) failed++;
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${id}: blazing ${theirs} | gop ${ours}`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
