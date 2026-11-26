// Basketball playoff series (BB-G59): the 2024-25 NBA series index, then the Finals page, then the WNBA's season select.
// The evidence build forces every 'preview' flag on.
export default async (page, base) => {
  await page.goto(base + '/nba/series?season=2025', { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await page.locator('[data-series-link]').count()) !== 15) throw new Error('expected 15 series');
  await page.waitForTimeout(1500);
  await page.locator('[data-series-link="2025-11-25"]').click();
  await page.waitForURL(/\/nba\/series\/2025-11-25/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if ((await page.locator('[data-series-game]').count()) !== 7) throw new Error('expected 7 games');
  await page.waitForTimeout(2000);
  await page.goto(base + '/wnba/series?season=2024', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#series-season').selectOption({ label: '2025' });
  await page.waitForURL(/season=2025/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
};
