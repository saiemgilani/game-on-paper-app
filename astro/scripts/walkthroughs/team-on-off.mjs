// The team page's On/Off and WOWY section (BB-G4): Minnesota 2025-26, scrolled to the on/off table,
// then the WOWY player select (a plain URL) switched to another player. Behind 'bball-on-off' inside
// 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
const TEAM = '/nba/team/1610612750?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + TEAM, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${TEAM} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#on-off-table', { timeout: 30_000 });
  await page.locator('#on-off').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.locator('#wowy').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await Promise.all([page.waitForURL(/wowy=/, { timeout: 60_000 }), page.locator('#wowy-player').selectOption({ index: 2 })]);
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  if ((await page.locator('#wowy-table').count()) !== 1) throw new Error('expected the WOWY table for the picked player');
  await page.locator('#wowy').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
};
