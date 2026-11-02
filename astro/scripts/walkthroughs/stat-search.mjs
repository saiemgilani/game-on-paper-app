// Season Search (S15): open the empty form, ask for >= 3,000 pass and >= 1,000 rush yards,
// submit, and land on the results with a row per player-season. Then add a rushing TD
// threshold to narrow it. The evidence build forces every 'preview' flag on.
export default async (page, base) => {
  await page.goto(base + '/search/seasons', { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await page.locator('table tbody tr').count()) !== 0) throw new Error('the empty form rendered results');
  await page.fill('#ss-pass_yards', '3000');
  await page.fill('#ss-rush_yards', '1000');
  await page.waitForTimeout(800);
  await Promise.all([page.waitForURL(/pass_yards=3000/, { timeout: 60_000 }), page.click('#season-search button[type="submit"]')]);
  await page.waitForLoadState('networkidle');
  if ((await page.locator('table tbody tr').count()) < 1) throw new Error('no results for the example query');
  await page.waitForTimeout(2000);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -800);
  await page.fill('#ss-rush_td', '20');
  await Promise.all([page.waitForURL(/rush_td=20/, { timeout: 60_000 }), page.click('#season-search button[type="submit"]')]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
};
