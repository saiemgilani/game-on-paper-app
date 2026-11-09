// From the 2025 passing board, pick "All-time" in the season dropdown and land on the
// all-time board (S17): a Season column, each row in its own season. Switch the metric to
// EPA/DB, then the category to Rushing, both staying all-time. The evidence build forces
// every 'preview' flag on, so the All-time option and the board render.
export default async (page, base) => {
  await page.goto(base + '/year/2025/players/passing', { waitUntil: 'networkidle', timeout: 90_000 });
  // the dropdown is a client:idle island; a change before it hydrates does nothing
  const selects = page.locator('astro-island:not([ssr]) form select');
  await selects.first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1500);
  const season = selects.nth(0);
  if ((await season.locator('option[value="all-time"]').count()) !== 1) throw new Error('no All-time option in the season dropdown');
  await Promise.all([page.waitForURL(/\/all-time\/players\/passing/, { timeout: 60_000 }), season.selectOption('all-time')]);
  await page.waitForLoadState('networkidle');
  const seasonHeader = page.locator('th', { hasText: 'Season' });
  if ((await seasonHeader.count()) !== 1) throw new Error('the all-time board has no Season column');
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -1200);
  const again = page.locator('astro-island:not([ssr]) form select');
  await again.first().waitFor({ state: 'attached', timeout: 30_000 });
  await Promise.all([page.waitForURL(/\/all-time\/players\/passing\?sort=EPAplay/, { timeout: 60_000 }), again.nth(2).selectOption('EPAplay')]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  const third = page.locator('astro-island:not([ssr]) form select');
  await third.first().waitFor({ state: 'attached', timeout: 30_000 });
  await Promise.all([page.waitForURL(/\/all-time\/players\/rushing/, { timeout: 60_000 }), third.nth(1).selectOption('rushing')]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
};
