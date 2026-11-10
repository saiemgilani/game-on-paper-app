// The football Header's league switch in preview mode (BB-G31): open it on the cfb home, see the four basketball leagues
// beside the NFL, and follow MBB. Preview only: pass WALKTHROUGH_COOKIE (see README.md); a public viewer has no switch here.
export default async (page, base) => {
  const res = await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto / failed: status ${res ? res.status() : '(no response)'}`);
  const toggle = page.locator('button.league-switch');
  const menu = page.locator('button[data-bs-target="#navOptions"]');
  if (await menu.isVisible()) await menu.click(); // the phone menu holds the switch
  await toggle.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await toggle.click();
  for (const lg of ['nfl', 'nba', 'wnba', 'mbb', 'wbb']) await page.locator(`.dropdown-item[href^="/${lg}"]`).first().waitFor({ timeout: 5_000 });
  await page.waitForTimeout(2000);
  await Promise.all([page.waitForURL(/\/mbb/, { timeout: 60_000 }), page.locator('.dropdown-item[href^="/mbb"]').first().click()]);
  await page.waitForTimeout(2000);
};
