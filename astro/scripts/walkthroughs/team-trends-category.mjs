// Open a team profile, scroll to Metric History, switch the category to Net Statistics and
// pick Net Yards/Play, then Defensive and a defensive metric (#330: the metric list used to keep
// the offensive metrics after a category switch, so only Net EPA/Play was reachable).
export default async (page, base) => {
  await page.goto(base + '/team/2509', { waitUntil: 'networkidle', timeout: 90_000 });
  const panel = page.locator('.container', { has: page.locator('#metricHistory') }).first();
  // the flow exists to exercise this panel: a missing one is a failed recording, not a skip
  if ((await panel.count()) !== 1) throw new Error('expected the Metric History panel');
  await panel.scrollIntoViewIfNeeded();
  // client:only: the selects exist once the island has mounted
  const [category, metric] = [panel.locator('select').nth(0), panel.locator('select').nth(1)];
  await metric.waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  for (const [cat, pick] of [['differential', 'yardsplay_margin'], ['defensive', 'success_def']]) {
    await category.selectOption(cat);
    await page.waitForTimeout(1200);
    const values = await metric.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.value));
    if (!values.includes(pick)) throw new Error(`metric list after switching to ${cat}: ${values.join(', ')}`);
    await metric.click();
    await page.waitForTimeout(800);
    await metric.selectOption(pick);
    await page.waitForTimeout(1500);
  }
};
