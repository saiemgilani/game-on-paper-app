// The game page's EPV box (BB-G26): a 2024-25 final, scrolled to the panel's biggest plays list (Q35). Behind 'bball-epv' inside 'nba': pass
// WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on. Needs the epv backfill to have run.
export default async (page, base) => {
  const path = '/nba/game/401703372';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#epv-plays table', { timeout: 30_000 });
  await page.locator('#epv-plays').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
