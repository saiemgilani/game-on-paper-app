// BB-G18: a scheduled game's Projection card. Behind 'bball-pregame-projection' inside 'mbb': pass WALKTHROUGH_COOKIE
// (see README.md) or run against a tree with the flags forced on. The game is a 2026-11-14 tip (UNCG at Cornell, both
// four games in, so past the college prior hold); after it, pick a scheduled game whose teams have both played 4 games.
export default async (page, base) => {
  for (const [path, sel] of [['/mbb/game/401924720', '#pregame-projection']]) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    await page.waitForSelector(sel, { timeout: 30_000 });
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
