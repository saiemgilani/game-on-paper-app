// The WNBA scatter (no featured team: every dot in its team colour): switch the Y axis, show faces, find a player, reset the
// zoom; then the leaders: the 5-game window and Most improved. Behind the 'wnba' preview flag: pass WALKTHROUGH_COOKIE.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  await go('/wnba/scatter');
  const svg = page.locator('svg.nba-chart');
  if ((await svg.count()) !== 1) throw new Error('/wnba/scatter: expected one scatter chart');
  await svg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await page.locator('select[name="y"]').selectOption('fgPct');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Faces', exact: true }).click();
  await page.waitForTimeout(1500);
  const name = await page.locator('#nba-scatter-names option').first().getAttribute('value');
  await page.getByPlaceholder('player name').fill(name ?? '');
  await page.waitForTimeout(1200);
  await page.getByPlaceholder('player name').fill('');
  await page.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await page.waitForTimeout(800);
  await go('/wnba/leaders');
  const table = page.locator('#nba-leaders');
  if ((await table.count()) !== 1) throw new Error('/wnba/leaders: expected the leaders table');
  await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '5 games', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Most improved', exact: true }).click();
  await page.waitForTimeout(1500);
};
