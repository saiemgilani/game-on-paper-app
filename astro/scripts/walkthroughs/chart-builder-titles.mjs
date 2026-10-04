// Open the chart builder on the scoring-opportunity metrics from the review on #293, by URL, and
// check that both axis menus show the metric titles, not raw column names. The evidence routes keep
// only path-shaped routes, so this flow is how the query-string case gets recorded.
export default async (page, base) => {
  await page.goto(base + '/charts/builder?x=pts_per_opp_off&y=pts_per_opp_def&season=2025', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  for (const [axis, prompt, key] of [['x', 'Choose X-Axis Metric', 'pts_per_opp_off'], ['y', 'Choose Y-Axis Metric', 'pts_per_opp_def']]) {
    const menu = page.locator('select', { has: page.locator('option', { hasText: prompt }) });
    if ((await menu.count()) !== 1) throw new Error(`expected one ${axis}-axis menu, found ${await menu.count()}`);
    const picked = await menu.evaluate((s) => ({ value: s.value, text: s.options[s.selectedIndex]?.text ?? '' }));
    if (picked.value !== key) throw new Error(`${axis}-axis menu selected ${picked.value}, want ${key}`);
    if (!/Points\/Opp/.test(picked.text) || picked.text.includes('pts_per_opp')) {
      throw new Error(`${axis}-axis menu shows "${picked.text}", not the Points/Opp title`);
    }
    await menu.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1500);
};
