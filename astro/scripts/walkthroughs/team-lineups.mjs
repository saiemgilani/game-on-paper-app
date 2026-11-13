// The team page's Lineups tab (BB-G3): Minnesota 2025-26, scrolled to the tab, then 3-man units and
// totals from its two selects (each a plain URL). Behind 'bball-lineups' inside 'nba': pass
// WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
const TEAM = '/nba/team/1610612750?season=2026';

async function pick(page, id, value, url) {
  await Promise.all([page.waitForURL(url, { timeout: 60_000 }), page.locator(id).selectOption({ index: value })]);
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('#lineups').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
}

export default async (page, base) => {
  const res = await page.goto(base + TEAM, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${TEAM} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#lineups-table', { timeout: 30_000 });
  await page.locator('#lineups').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await pick(page, '#lineups-unit', 1, /unit=3/);
  if ((await page.locator('#lineups-table').count()) !== 1) throw new Error('expected the 3-man lineups table');
  await pick(page, '#lineups-basis', 1, /basis=totals/);
};
