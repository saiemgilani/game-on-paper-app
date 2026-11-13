// BB-G11: the rolling leaders' Most improved and Most declined boards on the WNBA and MBB leaders pages. Behind the league
// flags and 'bball-rolling-movers': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  for (const route of ['/wnba/leaders', '/mbb/leaders']) {
    const res = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${route} failed: status ${res ? res.status() : '(no response)'}`);
    const table = page.locator('#nba-leaders');
    if ((await table.count()) !== 1) throw new Error(`${route}: expected the leaders table`);
    await table.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    // five boards: the board picker is a select (Q9)
    await page.getByLabel('Board', { exact: true }).selectOption('improved');
    await page.waitForTimeout(1500);
    await page.getByLabel('Board', { exact: true }).selectOption('declined');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '5 games', exact: true }).click();
    await page.waitForTimeout(1500);
  }
};
