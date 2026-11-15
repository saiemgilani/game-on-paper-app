// The /for/agents tour ('agent-demo', preview): switch the links to another player with the form, check every
// player link follows, then open the season page the first card points at.
export default async (page, base) => {
  await page.goto(base + '/for/agents', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1000);
  await page.fill('#agent-demo-player', '4433971');
  await page.fill('#agent-demo-season', '2024');
  await page.fill('#agent-demo-team', '183');
  await page.waitForTimeout(600);
  await Promise.all([page.waitForURL(/player=4433971/), page.click('#agent-demo-form button[type=submit]')]);
  await page.waitForTimeout(1000);
  const hrefs = await page.locator('a[href^="/players/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  if (!hrefs.length || hrefs.some((h) => !h.includes('4433971'))) throw new Error(`player links did not follow the form: ${hrefs.join(' ')}`);
  for (const id of ['percentiles', 'compare', 'fit', 'coverage']) {
    await page.locator(`#agent-demo-${id}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
  }
  await Promise.all([page.waitForURL(/\/players\/4433971\?season=2024/), page.click('#agent-demo-percentiles a')]);
  await page.waitForTimeout(2500);
};
