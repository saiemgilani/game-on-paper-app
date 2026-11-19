// From the NBA hub's page index to the Nets roster page (/nba/roster), switch the season, then open a player.
// Behind 'bball-hub' (and 'nba'): pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const res = await page.goto(base + '/nba', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto /nba failed: status ${res ? res.status() : '(no response)'}`);
  const index = page.locator('#hub-index');
  await index.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/nba\/roster(\?|$)/), index.getByRole('link', { name: 'Nets', exact: true }).click()]);
  const roster = page.locator('#nba-roster');
  if ((await roster.count()) !== 1) throw new Error('/nba/roster: expected one roster grid');
  await page.waitForTimeout(1500);
  const select = page.locator('#nba-season');
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
  if (values.length > 1) {
    await Promise.all([page.waitForURL(/\/nba\/roster\?season=/), select.selectOption(values[1])]);
    await page.waitForTimeout(1500);
  }
  await page.locator('#nba-roster').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/nba\/players\/\d+/), page.locator('#nba-roster a').first().click()]);
  await page.waitForTimeout(1500);
};
