// Open a player's season page (college, then NFL) and scroll to the Situational Splits table,
// whose metric cells are shaded against that split's league-season distribution with the
// percentile printed under each number. Like player-game-log.mjs, this flow is how the player
// route gets recorded: an `Evidence routes:` entry cannot carry the `?season=` the table needs.
const PAGES = ['/players/4837248?season=2025', '/nfl/players/16800?season=2025'];

export default async (page, base) => {
  for (const path of PAGES) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    const table = page.locator('#player-splits-table');
    // the flow exists to show the splits: a page without them is a failed recording, not a skip
    if ((await table.count()) !== 1) throw new Error(`${path}: expected one splits table, found ${await table.count()}`);
    if ((await table.locator('[data-league-pct]').count()) < 1) throw new Error(`${path}: the splits table carries no league percentiles`);
    await table.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    // the percentile explanation is the panel subtitle, visible without a hover (Akshay on #326)
    if ((await page.locator('#player-splits-panel [data-league-pct-caption]').count()) !== 1) throw new Error(`${path}: the splits panel carries no percentile subtitle`);
  }
};
