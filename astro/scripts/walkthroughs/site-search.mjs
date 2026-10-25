// Search from the header: type a team, read the grouped suggestions, press Enter and land on
// the top hit's team page. On a phone the box is in the collapsed menu, so the flow opens the
// menu first. The desktop run then narrows to a 768px tablet, where the box sits behind a
// magnifier button, and searches again from there. The evidence build forces every 'preview'
// flag on (lighthouse-compare.mjs).
async function searchAlab(page) {
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
}

export default async (page, base) => {
  const desktop = page.viewportSize().width >= 1200;
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 90_000 });
  const menu = page.locator('button[data-bs-target="#navOptions"]');
  if (await menu.isVisible()) {
    await menu.click();
    await page.locator('#navOptions.show').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(600);
  }
  await searchAlab(page);
  if (!desktop) return;

  // 768px: the expanded nav has no room for the box, so the magnifier opens it as a panel
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 90_000 });
  const open = page.locator('button[aria-controls="site-search-form"]');
  await open.waitFor({ state: 'visible', timeout: 5000 });
  // the button does nothing until the island hydrates (client:idle)
  await page.waitForFunction(() => !document.querySelector('#site-search astro-island[ssr]'), null, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await open.click();
  await page.locator('#site-search-form.show').waitFor({ state: 'visible', timeout: 5000 });
  await searchAlab(page);
};
