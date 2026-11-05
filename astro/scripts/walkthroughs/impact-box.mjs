// The game page's Impact box and Lineups used (BB-G1): a 2026-27 final, scrolled to the panel. Behind 'bball-impact-box'
// inside 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909088';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#impact table', { timeout: 30_000 });
  await page.locator('#impact').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
