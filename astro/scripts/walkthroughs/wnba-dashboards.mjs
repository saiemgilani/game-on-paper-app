// The WNBA landing (the teams index), Seattle's 2026 team page with the hex chart's Zones on the 2026 court, the same team
// in 2003 (12 ft lane, 19'9" arc), the roster sorted by USG%, then a player's dashboard. Behind the 'wnba' preview flag:
// pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  await go('/wnba');
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/wnba\/team\/1611661328$/), page.click('a[href="/wnba/team/1611661328"]')]);
  let hex = page.locator('#nba-hex-panel');
  if ((await hex.count()) !== 1) throw new Error('team page: expected one shot chart panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  await go('/wnba/team/1611661328?season=2003');
  hex = page.locator('#nba-hex-panel');
  await hex.scrollIntoViewIfNeeded();
  await hex.getByRole('button', { name: 'Zones' }).click();
  await page.waitForTimeout(1500);
  const roster = page.locator('#nba-roster');
  await roster.scrollIntoViewIfNeeded();
  await Promise.all([page.waitForURL(/sort=usgPct/), roster.locator('th[data-sort="usgPct"] a').click()]);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/wnba\/players\/\d+\?season=2003/), page.locator('#nba-roster tbody tr th a').first().click()]);
  await page.locator('#nba-hex-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
