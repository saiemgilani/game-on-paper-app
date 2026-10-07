// Open a player's season page (college, then NFL), scroll to the game log and switch its shading
// to the league scale. An `Evidence routes:` entry cannot carry a query string, and a player page
// only has a game log under `?season=`, so this flow is how the player route gets recorded.
const PAGES = ['/players/5191162?season=2026', '/nfl/players/16800?season=2025'];

export default async (page, base) => {
  for (const path of PAGES) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    const log = page.locator('#player-game-log');
    // the flow exists to show the game log: a page without one is a failed recording, not a skip
    if ((await log.count()) !== 1) throw new Error(`${path}: expected one game log, found ${await log.count()}`);
    if ((await log.locator('tbody tr').count()) < 1) throw new Error(`${path}: the game log has no rows`);
    await log.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    const shade = page.locator('#player-game-log-shade');
    if ((await shade.count()) === 1) {
      await shade.selectOption('league');
      await page.waitForTimeout(1200);
    }
    await log.locator('tbody tr').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
};
