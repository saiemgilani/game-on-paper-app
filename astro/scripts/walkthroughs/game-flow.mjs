// The game page's Game flow panel (BB-G28): a 2026-27 final with 22 lead changes, scrolled to the panel. Behind
// 'bball-game-flow' inside 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909834';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#flow svg', { timeout: 30_000 });
  await page.locator('#flow').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
