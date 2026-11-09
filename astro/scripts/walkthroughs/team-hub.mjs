// Open Texas A&M's team profile, scroll through Best Seasons, Head Coaches and Conference
// History, then collapse/expand Head Coaches. The evidence build forces every
// 'preview' flag on (lighthouse-compare.mjs), so the clean URL renders the 'team-hub' panels.
export default async (page, base) => {
  await page.goto(base + '/team/245', { waitUntil: 'networkidle', timeout: 90_000 });
  for (const id of ['best-seasons', 'head-coaches', 'conference-history']) {
    const toggle = page.locator(`a[data-bs-toggle="collapse"][href="#${id}"]`);
    // the flow exists to show these panels: a missing one is a failed recording, not a skip
    if ((await toggle.count()) !== 1) throw new Error(`expected one ${id} toggle, found ${await toggle.count()}`);
    await toggle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
  const coaches = page.locator('a[data-bs-toggle="collapse"][href="#head-coaches"]');
  await coaches.scrollIntoViewIfNeeded();
  await coaches.click();
  await page.locator('#head-coaches').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(800);
  await coaches.click();
  await page.locator('#head-coaches').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1200);
};
