// College bracketology (BB-G22): reached from the Header's Tools menu on /mbb (Nov 17 decisions, #394), then
// /mbb/bracketology's bracket (First Four and the four regions), the bubble and the seed
// table; the Standings view and one conference; the Team sheets; last season's final snapshot; then /wbb/bracketology.
// Behind 'bball-bracketology' inside 'mbb' / 'wbb': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with
// the flags forced on.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  const pick = async (id, label, url) => {
    const sel = page.locator(`#${id}`);
    const value = await sel.locator('option', { hasText: label }).first().getAttribute('value');
    await Promise.all([page.waitForURL(url), sel.selectOption(value)]);
    await page.waitForTimeout(1200);
  };
  await go('/mbb');
  // on a phone the menu is collapsed: open it first
  const toggle = page.locator('button[data-bs-target="#navOptions"]');
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.locator('#navOptions.show').waitFor({ state: 'visible', timeout: 5000 });
  }
  await page.locator('#navOptions .dropdown-toggle', { hasText: 'Tools' }).click();
  await page.waitForTimeout(1200);
  await Promise.all([
    page.waitForURL(/\/mbb\/bracketology/, { timeout: 90_000 }),
    page.locator('#navOptions .dropdown-menu a', { hasText: 'Bracketology' }).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  for (const text of ['The bubble', 'Seed distribution']) {
    await page.getByRole('heading', { name: text }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await pick('bracketology-view', 'Standings', /view=standings/);
  await pick('bracketology-conference', 'Big Ten', /conference=/);
  await pick('bracketology-view', 'Team sheets', /view=resume/);
  await pick('bracketology-season', '2025-26', /season=2026/);
  await go('/wbb/bracketology');
  await page.waitForTimeout(1500);
};
