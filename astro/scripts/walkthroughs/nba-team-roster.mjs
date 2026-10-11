// Open the Nets team page, sort the roster by TS%, switch to per-game numbers, filter by name,
// then step over to the player list for the team. Behind the 'nba' preview flag: pass
// WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
const TEAM = '/nba/team/1610612751?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + TEAM, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${TEAM} failed: status ${res ? res.status() : '(no response)'}`);
  const hex = page.locator('#nba-hex-panel');
  if ((await hex.count()) !== 1) throw new Error(`${TEAM}: expected one shot chart panel`);
  await hex.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const roster = page.locator('#nba-roster');
  if ((await roster.count()) !== 1) throw new Error(`${TEAM}: expected one roster table`);
  await roster.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await Promise.all([page.waitForURL(/sort=tsPct/), roster.locator('th[data-sort="tsPct"] a').click()]);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/mode=pergame/), page.getByRole('link', { name: 'Per game', exact: true }).click()]);
  await page.locator('#nba-roster').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.locator('#nba-roster-filter').fill('cla');
  await page.waitForTimeout(1200);
  await page.locator('#nba-roster-filter').fill('');
  await Promise.all([page.waitForURL(/\/nba\/players\?team=BKN/), page.getByRole('link', { name: /player list/ }).click()]);
  await page.waitForTimeout(1200);
  await page.locator('#nba-players').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
