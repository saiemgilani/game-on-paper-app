// Basketball team compare (BB-G60): two NBA teams, a third added from the add-a-team select, one removed, then the season
// select. The evidence build forces every 'preview' flag on.
const cards = async (page) => page.locator('[data-compare-card]').count();

export default async (page, base) => {
  await page.goto(base + '/nba/teams/compare?ids=1610612751,1610612738', { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await cards(page)) !== 2) throw new Error('expected 2 cards');
  await page.waitForTimeout(2000);
  await page.locator('#team-compare-team').selectOption({ index: 1 });
  await page.waitForURL((u) => (u.searchParams.get('ids') ?? '').split(',').length === 3, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if ((await cards(page)) !== 3) throw new Error('expected 3 cards after adding a team');
  await page.waitForTimeout(2000);
  await page.locator('[data-compare-remove]').first().click();
  await page.waitForURL((u) => (u.searchParams.get('ids') ?? '').split(',').length === 2, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.locator('#team-compare-season').selectOption({ label: '2024-25' });
  await page.waitForURL(/season=2025/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(2000);
};
