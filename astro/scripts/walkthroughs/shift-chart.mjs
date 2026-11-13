// The game page's shift chart (BB-G36): a final with stints, scrolled to the panel, a bar hovered, then the same page
// with the home team's first three players highlighted through `?shift_on=` (the "Together" row). Behind
// 'bball-shift-chart': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909088';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#shifts .shift-row', { timeout: 30_000 });
  await page.locator('#shifts').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await page.locator('#shifts-home .shift-bar').first().hover();
  await page.waitForTimeout(1500);
  const ids = await page.locator('#shifts-home .shift-row[data-player]').evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute('data-player')));
  await page.goto(`${base}${path}?shift_on=${ids.join(',')}#shifts`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.locator('#shifts').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
};
