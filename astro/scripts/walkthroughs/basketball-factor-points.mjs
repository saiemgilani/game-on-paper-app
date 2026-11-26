// Four-factor points (BB-G58): the Nets' season block factor-points table, then Minnesota's Lineups tab switched to the
// Four-factor points basis and sorted by the free-throw column. The evidence build forces every 'preview' flag on.
export default async (page, base) => {
  await page.goto(base + '/nba/team/1610612751', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#season').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.goto(base + '/nba/team/1610612750?season=2025#lineups', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#lineups-basis').selectOption({ label: 'Four-factor points' });
  await page.waitForURL(/basis=points/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('#lineups').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const ft = page.locator('th[data-sort="ft_pts"] a');
  if (await ft.count()) {
    await ft.click();
    await page.waitForURL(/lsort=ft_pts/, { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 });
    await page.waitForTimeout(2000);
  }
};
