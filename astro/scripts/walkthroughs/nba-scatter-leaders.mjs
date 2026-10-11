// The league scatter: switch the Y axis, show faces, find a player, reset the zoom; then the
// leaders: the 5-game window and the Most improved board. Behind the 'nba' preview flag: pass
// WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const scatter = '/nba/scatter?season=2026';
  let res = await page.goto(base + scatter, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${scatter} failed: status ${res ? res.status() : '(no response)'}`);
  const svg = page.locator('svg.nba-chart');
  if ((await svg.count()) !== 1) throw new Error(`${scatter}: expected one scatter chart`);
  await svg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.locator('select[name="y"]').selectOption('fgPct');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Faces', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByPlaceholder('player name').fill('Porter');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('player name').fill('');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.waitForTimeout(800);
  const leaders = '/nba/leaders?season=2026';
  res = await page.goto(base + leaders, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${leaders} failed: status ${res ? res.status() : '(no response)'}`);
  const table = page.locator('#nba-leaders');
  if ((await table.count()) !== 1) throw new Error(`${leaders}: expected the leaders table`);
  await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '5 games', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Most improved', exact: true }).click();
  await page.waitForTimeout(1500);
};
