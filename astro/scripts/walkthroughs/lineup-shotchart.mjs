// The Nets' lineup shot chart (BB-G52): put the top player ON and Apply, flip him OFF, switch to defense, put the
// opponents' top player ON (the defense view's opponent rows) and Apply, then the Zones view.
// Behind the 'nba' and 'bball-lineup-shotchart' preview flags: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree
// with the flags forced on.
const TEAM = '/nba/team/1610612751?season=2026';

export default async (page, base) => {
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.max(page.viewportSize().height, 1400) });
  const res = await page.goto(base + TEAM + '#lineup-shots', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${TEAM} failed: status ${res ? res.status() : '(no response)'}`);
  const chart = '#lineup-shots-chart svg g path';
  await page.waitForSelector(chart, { timeout: 30_000 });
  await page.locator('#lineup-shots').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const apply = async () => {
    await Promise.all([page.waitForLoadState('networkidle'), page.locator('#lineup-shots-form button[type=submit]').click()]);
    await page.waitForSelector(chart, { timeout: 30_000 });
    await page.locator('#lineup-shots').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  };
  // the first option after "Any" is the player on the floor for the most shots
  const top = await page.locator('#lineup-p1 option').nth(1).getAttribute('value');
  await page.selectOption('#lineup-p1', top);
  await apply();
  await page.locator('#lineup-shots-form select[name=s]').first().selectOption('off');
  await apply();
  await page.selectOption('#lineup-side', 'defense');
  await apply();
  const opp = await page.locator('#lineup-op1 option').nth(1).getAttribute('value');
  await page.selectOption('#lineup-op1', opp);
  await apply();
  await page.locator('#lineup-shots-chart button', { hasText: 'Zones' }).click();
  await page.waitForTimeout(1500);
};
