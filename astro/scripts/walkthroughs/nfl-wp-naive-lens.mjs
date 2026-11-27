// The NFL game page's WP lenses (N3): Baltimore at Kansas City, 2024 week 1. Switch between the market-aware and
// score-only lenses and back. Behind 'nfl-wp-naive-lens': pass WALKTHROUGH_COOKIE (see README.md) or run against a
// tree with the flag forced on.
export default async (page, base) => {
  const path = '/nfl/game/401671789';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const canvas = page.locator('#wpChart');
  await canvas.waitFor({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const labels = await page.locator('label[for^="wp-lens-"]').all();
  if (labels.length !== 2) throw new Error(`expected 2 WP lenses, found ${labels.length}`);
  for (const label of [...labels.slice(1), labels[0]]) { await label.click(); await page.waitForTimeout(1500); }
};
