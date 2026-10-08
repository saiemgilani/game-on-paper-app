// Search from the header: type a team, read the grouped suggestions, press Enter and land on
// the top hit's team page. On a phone the box is in the collapsed menu, so the flow opens the
// menu first. The evidence build forces every 'preview' flag on (lighthouse-compare.mjs).
export default async (page, base) => {
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 90_000 });
  const toggle = page.locator('button[data-bs-target="#navOptions"]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.locator('#navOptions.show').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(600);
  }
  const box = page.locator('#site-search-input');
  // the flow exists to exercise this box: a missing one is a failed recording, not a skip
  if ((await box.count()) !== 1) throw new Error(`expected one search box, found ${await box.count()}`);
  await box.click();
  await box.pressSequentially('alab', { delay: 180 });
  const results = page.locator('#site-search-results');
  await results.locator('a[href="/team/333"]').waitFor({ state: 'visible', timeout: 15_000 });
  await results.locator('.dropdown-header', { hasText: 'Teams' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(2000);
  // Enter on the typed text, nothing highlighted: it follows the top hit
  await box.press('Enter');
  await page.waitForURL(/\/team\/333$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(1500);
};
