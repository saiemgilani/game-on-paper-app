// The game page's WP lenses and game-flow extras (BB-G45): a 2025 NBA final with a closing line. Switch the lenses (only
// those the game has), hover a play, click to pin it, drag a stretch, then the extras under the chart. Behind
// 'bball-wp-lenses': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/nba/game/401704939';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const canvas = page.locator('#wpChart');
  await canvas.waitFor({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  for (const label of await page.locator('label[for^="wp-lens-"]').all()) { await label.click(); await page.waitForTimeout(1200); }
  const box = await canvas.boundingBox();
  if (box) {
    const y = box.y + box.height * 0.4;
    await page.mouse.move(box.x + box.width * 0.55, y); await page.waitForTimeout(1200);
    await page.mouse.click(box.x + box.width * 0.62, y); await page.waitForTimeout(1500);
    await page.mouse.move(box.x + box.width * 0.25, y); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, y, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(1800);
  }
  const extras = page.locator('#wp-extras');
  if (await extras.count()) { await extras.scrollIntoViewIfNeeded(); await page.waitForTimeout(1800); }
};
