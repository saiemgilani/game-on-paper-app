// Step one week forward from the schedule, then (phones) open the folded pickers.
export default async (page, base) => {
  await page.goto(base + '/year/2025/type/2/week/5', { waitUntil: 'networkidle', timeout: 90_000 });
  const next = page.locator('a[rel="next"]');
  if ((await next.count()) !== 1) throw new Error(`expected one next-week link, found ${await next.count()}`);
  await Promise.all([page.waitForURL(/\/year\/2025\/type\/2\/week\/6/, { timeout: 60_000 }), next.click()]);
  await page.waitForLoadState('networkidle', { timeout: 90_000 });
  await page.waitForTimeout(1200);
  const toggle = page.locator('button[data-bs-target="#schedule-filters"]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.locator('#schedule-filters form.form-picker').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1200);
  }
};
