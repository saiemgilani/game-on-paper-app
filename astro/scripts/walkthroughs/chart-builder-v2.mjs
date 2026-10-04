// Chart Builder v2: pick a Y metric from the rail, then Random.
export default async (page, base) => {
  await page.goto(base + '/charts/builder?season=2025&x=adj_off_epa&y=adj_def_epa', { waitUntil: 'networkidle', timeout: 90_000 });
  const rail = page.locator('#metric-rail');
  if ((await rail.count()) !== 1) throw new Error('expected the metric rail');
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/y=success_def/), rail.locator('tr[data-rail-metric="success_def"] input[name="rail-y"]').check()]);
  await page.waitForTimeout(1500);
  const before = page.url();
  await Promise.all([page.waitForURL((u) => u.toString() !== before), page.locator('#random-axes').click()]);
  await page.waitForTimeout(1500);
};
