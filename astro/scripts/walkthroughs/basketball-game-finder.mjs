// Basketball game finder (BB-G57): the empty form, then a 30-point search over last season from the form. The evidence build forces
// every 'preview' flag on. The results need sdv-db's /v1/wnba/game_finder (BB-D41); until it is deployed the search answers the
// page's 503, so only the form is asserted.
export default async (page, base) => {
  await page.goto(base + '/wnba/games/find', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!(await page.locator('#game-finder-form').count())) throw new Error('expected the finder form');
  await page.waitForTimeout(1500);
  await page.locator('#game-finder-pts').fill('30');
  await page.locator('#game-finder-from').selectOption({ label: '2025' });
  await page.locator('#game-finder-to').selectOption({ label: '2025' });
  await page.locator('#game-finder-form button[type=submit]').click();
  await page.waitForURL(/pts=30/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(2000);
};
