// Open the NBA Impact leaderboard, switch its Columns select to Season vs Current (#463 Q18), and hover the two Net
// headers for their definitions; the caption carries Current impact's date. The page is behind the 'nba' and
// 'bball-leaderboards-v2' preview flags: pass the preview cookie the walkthrough runner supports (WALKTHROUGH_COOKIE),
// or run against a tree with the flags forced on.
const PATH = '/nba/leaderboards?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + PATH, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${PATH} failed: status ${res ? res.status() : '(no response)'}`);
  const select = page.locator('#lb-impact');
  if ((await select.count()) !== 1) throw new Error(`${PATH}: no Columns select on the Impact board (is the preview cookie set?)`);
  await page.waitForTimeout(1200);
  const option = await select.locator('option', { hasText: 'Season vs Current' }).getAttribute('value');
  await Promise.all([page.waitForURL(/impact=current/, { timeout: 90_000 }), select.selectOption(option)]);
  await page.waitForLoadState('networkidle', { timeout: 90_000 });
  await page.locator('#lb-current-note').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const col of ['a[data-col="season"]', 'a[data-col="current"]']) {
    await page.locator(col).hover();
    await page.waitForTimeout(1500);
  }
  await page.locator('#lb-table tbody tr').nth(8).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
