// BB-G18: a scheduled game's Projection card, then the bracketology bracket's game odds. Behind 'bball-pregame-projection'
// inside 'mbb' (and 'bball-bracketology' for the bracket): pass WALKTHROUGH_COOKIE (see README.md) or run against a tree
// with the flags forced on. The game is a 2026-11-14 tip (LSU at Gonzaga); after it, pick any scheduled game from /mbb/scoreboard.
export default async (page, base) => {
  for (const [path, sel] of [['/mbb/game/401921689', '#pregame-projection'], ['/mbb/bracketology', '#bracket-game-odds']]) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    await page.waitForSelector(sel, { timeout: 30_000 });
    await page.locator(sel).scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
