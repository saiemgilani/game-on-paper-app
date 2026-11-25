// Open a final game, jump to the Fourth Down Decisions panel from the section nav (one row per team), then hide and
// show it. The evidence build forces every 'preview' flag on, so the clean URL renders the panel.
export default async (page, base) => {
  await page.goto(base + '/game/401729745', { waitUntil: 'networkidle', timeout: 90_000 });
  const nav = page.locator('a[href="#decision-summary-panel"]');
  // the flow exists to exercise this panel: a missing one is a failed recording, not a skip
  if ((await nav.count()) < 1) throw new Error('no Fourth Down Decisions entry in the section nav');
  await nav.first().click();
  const panel = page.locator('#decision-summary-panel');
  await panel.waitFor({ state: 'visible', timeout: 5000 });
  const rows = await panel.locator('tbody tr').count();
  if (rows !== 2) throw new Error(`expected one row per team, found ${rows}`);
  await page.waitForTimeout(2000);
  const toggle = panel.locator('a.toggle-link');
  await toggle.click();
  await page.locator('#decision-summary').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(1000);
  await toggle.click();
  await page.locator('#decision-summary').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(2000);
};
