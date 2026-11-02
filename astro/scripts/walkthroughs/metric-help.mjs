// Open the offensive team leaderboard, tap the SR% help button, and check the glossary popover opens
// with its link into the glossary anchor; then dismiss it with Escape (native popover dismiss).
export default async (page, base) => {
  const res = await page.goto(base + '/year/2025/teams/offensive', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  const btn = page.locator('th button[popovertarget="help-successful-play-success-rate"]').first();
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await btn.click();
  const pop = page.locator('#help-successful-play-success-rate');
  await pop.waitFor({ state: 'visible', timeout: 5000 });
  if ((await pop.locator('a[href="/glossary/#successful-play-success-rate"]').count()) !== 1) {
    throw new Error('popover has no link to the glossary anchor');
  }
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(500);
};
