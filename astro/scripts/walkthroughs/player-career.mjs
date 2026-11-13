// The player page's Career panel (BB-G54): scroll to it, open a WAR cell's rank / cohort / percentile / sample, then the trend
// row. Behind 'bball-career' inside 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/players/1629008?season=2026';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#career-table', { timeout: 30_000 });
  await page.locator('#career').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const cells = page.locator('#career-table .career-cell summary');
  for (const i of [0, 2]) { await cells.nth(i).click(); await page.waitForTimeout(1500); }
  await page.locator('#career-trend').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
