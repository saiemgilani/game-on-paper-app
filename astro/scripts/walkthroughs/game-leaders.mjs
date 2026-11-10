// The game page's Leaders panel (BB-G35): a 2026-27 final, from the Leaders nav entry to the leaders table, the
// players against their average and the assist web, then the panel's show/hide. Behind 'bball-game-leaders' inside
// 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909834';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#leaders-table', { timeout: 30_000 });
  const nav = page.locator('a[href="#leaders"].link-secondary');
  if (await nav.isVisible()) await nav.click();
  else await page.locator('#leaders-table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  for (const id of ['#leaders-over-under', '#leaders-assist-web']) {
    const el = page.locator(id);
    if (await el.count()) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(1800); }
  }
  const more = page.locator('#leaders-assist-web details summary').first();
  if (await more.count()) { await more.click(); await page.waitForTimeout(1500); }
  await page.locator('#leaders-panel .toggle-link').scrollIntoViewIfNeeded();
  await page.locator('#leaders-panel .toggle-link').click();
  await page.waitForTimeout(1200);
  await page.locator('#leaders-panel .toggle-link').click();
  await page.waitForTimeout(1200);
};
