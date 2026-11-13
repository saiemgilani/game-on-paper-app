// The game page's shooting signature and distance bars (BB-G39): a final's Shot charts panel, the bars switched from
// FG% to Share and back, a bar clicked to hold its distance. Behind 'bball-game-shooting': pass WALKTHROUGH_COOKIE
// (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401766458';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const dash = page.locator('#shots [data-shot-link]').first();
  await dash.waitFor({ timeout: 30_000 });
  await dash.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await dash.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForTimeout(1500);
  await dash.getByRole('button', { name: 'FG%', exact: true }).click();
  await page.waitForTimeout(1000);
  const bar = dash.locator('svg').last().locator('rect[style*="transparent"]').nth(1);
  if (await bar.count()) { await bar.click(); await page.waitForTimeout(1500); }
};
