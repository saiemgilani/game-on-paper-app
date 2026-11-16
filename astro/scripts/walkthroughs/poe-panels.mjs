// Points over expected (BB-G15, 'bball-poe'): on an NBA game page, jump to the Points over expected panel from the
// nav; on the Nets' team page, open the folded "Each shooter" toggle; on a player page, show the visible model note.
// The evidence build forces every 'preview' flag on (lighthouse-compare.mjs), so the clean URLs render it.
export default async (page, base) => {
  await page.goto(base + '/nba/game/401811022', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('a[href="#poe"]:visible').first().click({ timeout: 10_000 }).catch(() => {});
  await page.locator('#poe-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.goto(base + '/nba/team/1610612751?season=2026', { waitUntil: 'networkidle', timeout: 90_000 });
  const shooters = page.locator('#poe-shooters');
  await shooters.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shooters.locator('summary').click();
  await page.waitForTimeout(2500);
  await page.goto(base + '/nba/players/1629008?season=2026', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#nba-poe-note').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
};
