// The NBA header menu: Scoreboard, Players, Teams, Scatter, Leaders, with no Nets entry. On a
// phone the menu is collapsed, so the flow opens it first and holds it open on camera. The
// evidence build forces the 'nba' preview flag on (lighthouse-compare.mjs).
export default async (page, base) => {
  const res = await page.goto(base + '/nba', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto /nba failed: status ${res ? res.status() : '(no response)'}`);
  const toggle = page.locator('button[data-bs-target="#navOptions"]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.locator('#navOptions.show').waitFor({ state: 'visible', timeout: 5000 });
  }
  const labels = (await page.locator('#navOptions > ul > li > a').allTextContents()).map((s) => s.trim());
  for (const want of ['Scoreboard', 'Players', 'Teams', 'Scatter', 'Leaders']) {
    if (!labels.includes(want)) throw new Error(`NBA menu is missing ${want}: ${labels.join(', ')}`);
  }
  if (labels.includes('Nets')) throw new Error(`NBA menu still lists Nets: ${labels.join(', ')}`);
  await page.waitForTimeout(2500);
  // follow one entry so the clip shows the menu is live
  await Promise.all([page.waitForURL(/\/nba\/scoreboard/, { timeout: 30_000 }), page.locator('#navOptions a', { hasText: 'Scoreboard' }).first().click()]);
  await page.waitForSelector('h1');
  await page.waitForTimeout(1500);
};
