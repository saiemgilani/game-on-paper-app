// Basketball head-coach boards (BB-G9): /nba/coaches (careers), then the 2024-25 season, the Four Factors board and a
// column sort, then /wnba/coaches. Behind 'bball-coaches' inside 'nba' / 'wnba': pass WALKTHROUGH_COOKIE (see
// README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    await page.waitForTimeout(1200);
  };
  const pick = async (id, label, url) => {
    const sel = page.locator(`#${id}`);
    const value = await sel.locator('option', { hasText: label }).first().getAttribute('value');
    await Promise.all([page.waitForURL(url), sel.selectOption(value)]);
    await page.waitForTimeout(1200);
  };
  await go('/nba/coaches');
  await pick('coach-season', '2024-25', /season=2025/);
  await page.locator('.coach-partial-divider').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pick('coach-board', 'Four Factors', /board=four-factors/);
  await Promise.all([page.waitForURL(/sort=tov_pct/), page.getByRole('link', { name: 'TOV%', exact: true }).click()]);
  await page.waitForTimeout(1200);
  await go('/wnba/coaches?season=2025');
};
