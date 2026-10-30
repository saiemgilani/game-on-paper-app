// The MBB landing (teams by conference): filter for Texas, open its 2025-26 team page, the hex chart's Zones on the NCAA
// court, the roster sorted by USG% (box-score usage; no PIE column), a player's dashboard; then Texas in 2018-19 (the
// 20' 9" arc, the partial-season coverage note) and the per-team player list. Behind the 'mbb' preview flag: pass
// WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  await go('/mbb');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('team name').fill('texas');
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/mbb\/team\/251$/), page.click('a[href="/mbb/team/251"]')]);
  let hex = page.locator('#nba-hex-panel');
  if ((await hex.count()) !== 1) throw new Error('team page: expected one shot chart panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  const roster = page.locator('#nba-roster');
  await roster.scrollIntoViewIfNeeded();
  await Promise.all([page.waitForURL(/sort=usgPct/), roster.locator('th[data-sort="usgPct"] a').click()]);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/mbb\/players\/\d+/), page.locator('#nba-roster tbody tr th a').first().click()]);
  await page.locator('#nba-hex-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await go('/mbb/team/251?season=2019');
  hex = page.locator('#nba-hex-panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  await go('/mbb/players?team=251');
  await page.locator('#nba-players').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
