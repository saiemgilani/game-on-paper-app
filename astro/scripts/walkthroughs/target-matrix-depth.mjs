// The game page's Target Matrix depth labels: open a college and an NFL game's away stats panel and stop on the
// matrix, whose rows read ESPN's split for the league (20 air yards in college, 16 in the NFL).
export default async (page, base) => {
  for (const [path, split] of [['/game/401856682', 20], ['/nfl/game/401772944', 16]]) {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.waitForTimeout(1000);
    const toggle = page.locator('a[data-bs-toggle="collapse"][href="#away-stats-panel"]');
    if ((await toggle.count()) !== 1) throw new Error(`${path}: expected one away-stats toggle, found ${await toggle.count()}`);
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.locator('#away-stats-panel').waitFor({ state: 'visible', timeout: 5000 });
    const matrix = page.locator('#away-stats-panel .target-matrix').first();
    // the flow exists to show the labels: a matrix without them is a failed recording, not a skip
    const text = await matrix.innerText({ timeout: 10_000 });
    if (!text.includes(`${split}+ air yards`) || !text.includes(`Under ${split} air yards`)) {
      throw new Error(`${path}: the Target Matrix does not label the ${split}-yard split`);
    }
    await matrix.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
  }
};
