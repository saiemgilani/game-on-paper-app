// The game-set filter (BB-G14, 'bball-game-set'): on the Nets' team page, pick Clutch (a producer split row) and then
// Wins (summed from the impact rows); on Duke's, pick Conference games; on a player page with ?games=last5, the explorer
// starts from those five games. The evidence build forces every 'preview' flag on (lighthouse-compare.mjs).
const pick = async (page, label) => {
  const select = page.locator('#game-set-select');
  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const value = await select.locator('option', { hasText: label }).first().getAttribute('value');
  const want = (value.match(/games=[a-z0-9]+/) ?? [""])[0];
  await Promise.all([page.waitForURL((u) => u.href.includes(want), { timeout: 60_000 }).catch(() => {}), select.selectOption(value)]);
  await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
  await page.locator('#season-game-set, #player-game-set').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
};
export default async (page, base) => {
  await page.goto(base + '/nba/team/1610612751?season=2026', { waitUntil: 'networkidle', timeout: 90_000 });
  await pick(page, 'Clutch');
  await pick(page, 'Wins');
  await page.goto(base + '/mbb/team/150?season=2026', { waitUntil: 'networkidle', timeout: 90_000 });
  await pick(page, 'Conference games');
  await page.goto(base + '/nba/players/1629008?season=2026&games=last5', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#nba-games-panel').scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(2500);
};
