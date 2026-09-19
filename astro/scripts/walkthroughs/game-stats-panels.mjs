// Example: open a final game and expand both team-stats panels, the way a reader does.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  for (const id of ['away-stats-panel', 'home-stats-panel']) {
    const toggle = page.locator(`a[data-bs-toggle="collapse"][href="#${id}"]`).first();
    if (await toggle.count()) {
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click();
      // assert the panel actually opened, not just that the click completed
      await page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(1200);
    }
  }
  await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
  await page.waitForTimeout(1500);
};
