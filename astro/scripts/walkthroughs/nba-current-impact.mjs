// Open a Nets player's page, follow "On this page" to the Season vs current impact panel (BB-G56) and hover its two
// headline rows for their definitions. The page and the panel are behind the 'nba' and 'bball-current-impact' preview
// flags: pass the preview cookie the walkthrough runner supports (WALKTHROUGH_COOKIE), or run against a tree with the
// flags forced on.
const PATH = '/nba/players/1629008?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + PATH, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${PATH} failed: status ${res ? res.status() : '(no response)'}`);
  const link = page.locator('a[href="#current-impact"]');
  if ((await link.count()) !== 1) throw new Error(`${PATH}: expected one "Season vs current" link (is the preview cookie set?)`);
  await page.waitForTimeout(1000);
  await link.click();
  const panel = page.locator('#current-impact');
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const row of ['#current-impact-season abbr', '#current-impact-current abbr']) {
    const cell = panel.locator(row);
    if ((await cell.count()) === 1) {
      await cell.hover();
      await page.waitForTimeout(1500);
    }
  }
  await page.locator('#value, #ranks').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
