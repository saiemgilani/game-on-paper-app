// The Team Stats "Drives" table's drive-start EP row, switched through the "Show only" windows.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  // the indented "Expected Points" sub-row (exact cell text: other rows say "Expected Points Added")
  const row = page.locator('#team-stats tr').filter({ has: page.locator('td, th', { hasText: /^\s*Expected Points\s*$/ }) });
  // the flow exists to show this row: a missing one is a failed recording, not a skip
  if ((await row.count()) !== 1) throw new Error(`expected one drive-start EP row, found ${await row.count()}`);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const select = page.locator('#span-stats');
  for (const value of ['q1', 'h2', 'all']) {
    await select.scrollIntoViewIfNeeded();
    await select.selectOption(value);
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
