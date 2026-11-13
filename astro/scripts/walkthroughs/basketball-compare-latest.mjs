// Basketball player compare (BB-G13): two NBA players pinned to 2025-26, then the season select's "Latest", which drops
// ?season= so each card shows that player's own latest season (as football's compare does), then back to one season.
// The evidence build forces every 'preview' flag on.
const seasons = async (page) => page.locator('[data-compare-season]').allTextContents();

export default async (page, base) => {
  await page.goto(base + '/nba/players/compare?ids=1629008,1641730&season=2026', { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await page.locator('[data-compare-card]').count()) !== 2) throw new Error('expected 2 cards');
  await page.waitForTimeout(2000);
  await page.locator('#player-compare-season').selectOption({ label: 'Latest' });
  await page.waitForURL((u) => !u.searchParams.has('season'), { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if ((await seasons(page)).length !== 2) throw new Error(`expected a season under each card, found ${(await seasons(page)).join(' / ')}`);
  await page.waitForTimeout(2500);
  await page.locator('#player-compare-season').selectOption({ label: '2024-25' });
  await page.waitForURL(/season=2025/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(2000);
};
