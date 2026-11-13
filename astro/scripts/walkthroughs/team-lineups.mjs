// The team page's Lineups tab (BB-G3): Minnesota 2025-26, scrolled to the tab, then 3-man units and totals from its
// selects (each a plain URL), "Ranked only" from the gate select and a sort by the +/- header; then Duke 2025-26's
// pairs on the college shot-zone basis (the Boozers by first name, names linked to player pages). Behind
// 'bball-lineups' inside each league's flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the
// flags forced on.
const TEAM = '/nba/team/1610612750?season=2026';
const DUKE = '/mbb/team/150?season=2026&unit=2&basis=zones';

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('#lineups').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
}

async function pick(page, id, index, url) {
  await Promise.all([page.waitForURL(url, { timeout: 60_000 }), page.locator(id).selectOption({ index })]);
  await settle(page);
}

async function open(page, base, path) {
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#lineups-table', { timeout: 30_000 });
  await settle(page);
}

export default async (page, base) => {
  await open(page, base, TEAM);
  await pick(page, '#lineups-unit', 1, /unit=3/);
  if ((await page.locator('#lineups-table').count()) !== 1) throw new Error('expected the 3-man lineups table');
  await pick(page, '#lineups-basis', 1, /basis=totals/);
  await pick(page, '#lineups-min', 3, /min=ranked/);
  await Promise.all([page.waitForURL(/lsort=plus_minus/, { timeout: 60_000 }), page.locator('th[data-sort="plus_minus"] a').click()]);
  await settle(page);
  await open(page, base, DUKE);
};
