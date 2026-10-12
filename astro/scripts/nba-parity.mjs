// The spec's parity gate: for three Nets players and the Nets, the header shooting line on the GOP page equals
// the one on blazingthenets.com for the same season (same release, two code paths), and so does
// every chart's <desc> -- the describe* text the copied renderers write from the derived tables.
// A team argument is team:<team_id>.
//   BASE=https://<preview> COOKIE='gop_preview=...' node scripts/nba-parity.mjs 1629008 1627832 1641705 team:1610612751
import { loadChromium, launchOptions } from './lib/browser.mjs';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const COOKIE = process.env.COOKIE ?? '';
const SEASON = process.env.SEASON ?? '2026';
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: nba-parity.mjs <person_id|team:<team_id>|scatter|leaders>...');

const line = (t, { team = false } = {}) => { const m = /(\d[\d,]*)\/(\d[\d,]*) FG[^\d]*([\d.]+)% FG%[^\d]*([\d.]+)% eFG%[^\d]*([\d.]+)% 3P%(?:[^\d]*(\d[\d,]*)\/(\d[\d,]*))?/.exec(t); if (!m) throw new Error(`no shooting line in: ${t.slice(0, 200)}`); if (!team && m[6] === undefined) throw new Error('no 3PM/3PA pair in a player header'); return m.slice(1).filter((v) => v !== undefined).join(' '); };
// every chart's <desc>, whitespace-collapsed and sorted (both sites render one per chart svg)
const descs = (page) => page.$$eval('svg > desc', (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()).sort());
// the default leaders board: first 15 rows, 'rank name team value', whitespace-collapsed (player cell: link text, else minus a trailing "last game ...")
const leaderRows = (page, sel) => page.$$eval(sel, (trs) => trs.slice(0, 15).map((tr) => [...tr.querySelectorAll('td,th')].slice(0, 4).map((c, i) => {
  let t = i === 1 ? (c.querySelector('a')?.textContent ?? c.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/\s*last game.*$/i, '') : (c.textContent ?? '').replace(/\s+/g, ' ').trim();
  return t;
}).join(' ')));
const cut = (t) => (t.length > 200 ? `${t.slice(0, 200)}...` : t);
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
  for (const arg of ids) {
    if (arg === 'scatter' || arg === 'leaders') {
      const theirUrl = `https://blazingthenets.com/${arg}?season=${SEASON}`;
      const ourUrl = `${BASE}/nba/${arg}?season=${SEASON}`;
      const grab = async (url, ours) => {
        const r = await page.goto(url, { waitUntil: 'networkidle' });
        if (!r || !r.ok()) throw new Error(`goto ${url} failed: status ${r ? r.status() : '(no response)'}`);
        return arg === 'scatter' ? descs(page) : leaderRows(page, ours ? '#nba-leaders tbody:first-of-type tr' : 'table tbody tr');
      };
      const a = await grab(theirUrl, false);
      const b = await grab(ourUrl, true);
      const k = Array.from({ length: Math.max(a.length, b.length) }, (_, j) => j).find((j) => a[j] !== b[j]);
      const pass = k === undefined && a.length > 0;
      if (!pass) failed++;
      console.log(`${pass ? 'OK  ' : 'DIFF'} ${arg}: ${pass ? `${b.length} ${arg === 'scatter' ? 'desc texts' : 'rows'} equal` : `blazing ${a.length}, gop ${b.length}`}`);
      if (!pass && k !== undefined) { console.log(`     first difference [${k}]:`); console.log(`       blazing: ${cut(a[k] ?? '(none)')}`); console.log(`       gop:     ${cut(b[k] ?? '(none)')}`); }
      continue;
    }
    const team = arg.startsWith('team:');
    const id = team ? arg.slice(5) : arg;
    if (!/^\d+$/.test(id)) throw new Error(`not an id: ${arg}`);
    const theirUrl = team ? `https://blazingthenets.com/teams/${id}?season=${SEASON}` : `https://blazingthenets.com/players/${id}?season=${SEASON}`;
    const r1 = await page.goto(theirUrl, { waitUntil: 'networkidle' });
    if (!r1 || !r1.ok()) throw new Error(`goto ${theirUrl} failed: status ${r1 ? r1.status() : '(no response)'}`);
    const theirs = line(await page.locator('header').filter({ hasText: 'eFG%' }).first().innerText(), { team });
    const theirDescs = await descs(page);
    const ourUrl = team ? `${BASE}/nba/team/${id}?season=${SEASON}` : `${BASE}/nba/players/${id}?season=${SEASON}`;
    const r2 = await page.goto(ourUrl, { waitUntil: 'networkidle' });
    if (!r2 || !r2.ok()) throw new Error(`goto ${ourUrl} failed: status ${r2 ? r2.status() : '(no response)'}`);
    const ours = line(await page.locator('#nba-line').innerText(), { team });
    const ourDescs = await descs(page);
    const ok = theirs === ours;
    const k = Array.from({ length: Math.max(theirDescs.length, ourDescs.length) }, (_, j) => j).find((j) => theirDescs[j] !== ourDescs[j]);
    const descOk = k === undefined && theirDescs.length > 0;
    if (!ok || !descOk) failed++;
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${arg}: blazing ${theirs} | gop ${ours}`);
    console.log(`${descOk ? 'OK  ' : 'DIFF'} ${arg}: ${descOk ? `${ourDescs.length} desc texts equal` : `desc texts: blazing ${theirDescs.length}, gop ${ourDescs.length}`}`);
    if (!descOk && k !== undefined) {
      console.log(`     first difference [${k}]:`);
      console.log(`       blazing: ${cut(theirDescs[k] ?? '(none)')}`);
      console.log(`       gop:     ${cut(ourDescs[k] ?? '(none)')}`);
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
