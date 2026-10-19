// Open a team profile (Purdue), scroll to Metric History, show EPA/Play offense against the team-season
// distribution, then switch to Net Statistics, which draws boxes only under 'team-season-bands', then National
// Trends, whose boxes come from the same distribution. The
// evidence build forces every 'preview' flag on (lighthouse-compare.mjs), so the clean URL renders it.
export default async (page, base) => {
  await page.goto(base + '/team/2509', { waitUntil: 'networkidle', timeout: 90_000 });
  const panel = page.locator('#metricHistory').locator('xpath=ancestor::div[contains(@class,"container")][1]');
  await panel.locator('canvas').first().waitFor({ timeout: 30_000 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  // Net Statistics opens on Net EPA/Play (modifyMetricForCategory)
  await panel.locator('select').first().selectOption('differential');
  await page.waitForTimeout(3000);
  // National Trends draws its EPA/Play boxes from the same team-season distribution
  await page.goto(base + '/charts/trends?sort=EPAplay', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
};
