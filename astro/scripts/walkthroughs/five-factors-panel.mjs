// Open a season team page, read a factor's definition, then collapse and expand the
// Five Factors panel, the way a reader does. The evidence build forces every 'preview'
// flag on (lighthouse-compare.mjs), so the clean URL renders the flagged panel.
export default async (page, base) => {
  await page.goto(base + '/year/2025/team/333', { waitUntil: 'networkidle', timeout: 90_000 });
  const toggle = page.locator('a[data-bs-toggle="collapse"][href="#five-factors"]');
  // the flow exists to exercise this panel: a missing toggle is a failed recording, not a skip
  if ((await toggle.count()) !== 1) throw new Error(`expected one Five Factors toggle, found ${await toggle.count()}`);
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  // below md the Metric column is hidden and the label's hover carries the definition;
  // from md up the Metric column states it and the label is plain text
  const abbr = page.locator('#five-factors abbr', { hasText: 'Turnovers' });
  if (await abbr.isVisible()) await abbr.hover();
  else await page.locator('#five-factors td', { hasText: 'Giveaways or Takeaways per game' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1200);
  await toggle.click();
  // assert the panel actually collapsed and reopened, not just that the clicks completed
  await page.locator('#five-factors').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(800);
  await toggle.click();
  await page.locator('#five-factors').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1200);
};
