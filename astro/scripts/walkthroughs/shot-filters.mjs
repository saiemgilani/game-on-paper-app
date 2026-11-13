// The game page's shot filters (BB-G38): on an NBA final, the pros' Shot move menu (driving), then a period, which cuts the
// charts but leaves the signature and bars on the whole game, then a shooter, whose signature and bars are his own.
// Behind 'bball-shot-filters': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909088';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const bar = page.locator('#shots [data-shot-filters]');
  await bar.waitFor({ timeout: 30_000 });
  await bar.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await bar.locator('select[aria-label="Shot move"]').selectOption('driving');
  await page.waitForTimeout(2000);
  await bar.locator('select[aria-label="Period"]').selectOption('1');
  await page.waitForTimeout(2000);
  const shooter = bar.locator('select[aria-label="Shooter"]');
  const first = await shooter.locator('option').nth(1).getAttribute('value');
  if (first) { await shooter.selectOption(first); await page.waitForTimeout(2000); }
  await page.locator('#shots').getByText('Shooting signature').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1500);
};
