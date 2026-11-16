// BB-G18: a scheduled game's Projection card, read from the game's rated_priors row. Behind 'bball-pregame-projection'
// inside each league's flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on. The
// games tip 2026-11-14 (UNCG at Cornell, LSU at Gonzaga 2 and 3 games in) and 2026-11-16 (ORL at BOS); after that,
// pick scheduled games whose rated_priors rows carry a prediction.
export default async (page, base) => {
  for (const [path, sel] of [['/mbb/game/401924720', '#pregame-projection'], ['/mbb/game/401921689', '#pregame-projection'], ['/nba/game/401909994', '#pregame-projection']]) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    await page.waitForSelector(sel, { timeout: 30_000 });
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
