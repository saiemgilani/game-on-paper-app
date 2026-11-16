// Open a Nets player's page, follow "On this page" to the Impact table and hover its Season impact and Current impact
// rows (BB-G56) for their definitions and priors; the caption carries Current impact's date. The page and the rows are
// behind the 'nba' and 'bball-current-impact' preview flags: pass the preview cookie the walkthrough runner supports
// (WALKTHROUGH_COOKIE), or run against a tree with the flags forced on.
const PATH = '/nba/players/1629008?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + PATH, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${PATH} failed: status ${res ? res.status() : '(no response)'}`);
  const link = page.locator('a[href="#impact"]');
  if ((await link.count()) !== 1) throw new Error(`${PATH}: expected one "Impact" link (is the preview cookie set?)`);
  if ((await page.locator('#impact-current_impact').count()) !== 1) throw new Error(`${PATH}: no Current impact row in the Impact table`);
  await page.waitForTimeout(1000);
  await link.click();
  const table = page.locator('#impact-table');
  await table.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const row of ['#impact-reml_rapm abbr', '#impact-current_impact abbr']) {
    const cell = table.locator(row);
    if ((await cell.count()) === 1) {
      await cell.hover();
      await page.waitForTimeout(1500);
    }
  }
  await page.locator('#value, #ranks').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
