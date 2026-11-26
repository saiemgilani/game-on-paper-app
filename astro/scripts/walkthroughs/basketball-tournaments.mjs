// College tournament runs (BB-G59): the 2024-25 men's tournaments, then the national champion's run.
// The evidence build forces every 'preview' flag on.
export default async (page, base) => {
  await page.goto(base + '/mbb/tournaments?season=2025', { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await page.locator('[data-tournament]').count()) < 30) throw new Error('expected the 2025 tournaments');
  await page.waitForTimeout(1500);
  await page.locator('[data-run-link="2025-22-57"]').click();
  await page.waitForURL(/\/mbb\/tournaments\/2025-22-57/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if ((await page.locator('[data-run-game]').count()) !== 6) throw new Error('expected six games');
  await page.waitForTimeout(2000);
};
