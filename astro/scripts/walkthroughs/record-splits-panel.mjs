// Open a season team page, read the One-score definition, then collapse and expand
// the Record panel, the way a reader does. The evidence build forces every 'preview'
// flag on (lighthouse-compare.mjs), so the clean URL renders the flagged panel.
export default async (page, base) => {
  await page.goto(base + '/year/2025/team/333', { waitUntil: 'networkidle', timeout: 90_000 });
  const toggle = page.locator('a[data-bs-toggle="collapse"][href="#record-splits"]');
  // the flow exists to exercise this panel: a missing toggle is a failed recording, not a skip
  if ((await toggle.count()) !== 1) throw new Error(`expected one Record toggle, found ${await toggle.count()}`);
  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.locator('#record-splits abbr', { hasText: 'One-score' }).hover();
  await page.waitForTimeout(1200);
  await toggle.click();
  // assert the panel actually collapsed and reopened, not just that the clicks completed
  await page.locator('#record-splits').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(800);
  await toggle.click();
  await page.locator('#record-splits').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1200);
};
