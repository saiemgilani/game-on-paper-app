// The WBB landing (every D-I program by conference): filter for South Carolina, open its 2025-26 team page, the hex chart's
// Zones on the women's court, the roster sorted by USG% (box-score usage; no PIE column), a player's dashboard; then South
// Carolina in 2021-22 (the first season of the 22' 1 3/4" arc), New Haven's empty page (D38: shots not linked), and the
// per-team player list. Behind the 'wbb' preview flag: pass WALKTHROUGH_COOKIE (see README.md).
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  await go('/wbb');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('team name').fill('south carolina');
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/wbb\/team\/2579$/), page.click('a[href="/wbb/team/2579"]')]);
  let hex = page.locator('#nba-hex-panel');
  if ((await hex.count()) !== 1) throw new Error('team page: expected one shot chart panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  const roster = page.locator('#nba-roster');
  await roster.scrollIntoViewIfNeeded();
  await Promise.all([page.waitForURL(/sort=usgPct/), roster.locator('th[data-sort="usgPct"] a').click()]);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/wbb\/players\/\d+/), page.locator('#nba-roster tbody tr th a').first().click()]);
  await page.locator('#nba-hex-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await go('/wbb/team/2579?season=2022');
  hex = page.locator('#nba-hex-panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  await go('/wbb/team/2441');
  if ((await page.locator('#nba-empty').count()) !== 1) throw new Error('/wbb/team/2441: expected the empty-team sentence');
  await page.waitForTimeout(1200);
  await go('/wbb/players?team=2579');
  await page.locator('#nba-players').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
