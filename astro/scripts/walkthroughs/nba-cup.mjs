// The NBA Cup (BB-G30): /nba/cup's four views (the groups, the wild-card race, the knockout, the odds). Behind
// 'bball-nba-cup' inside 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
// Until sdv-db's Cup routes deploy, the page is its "not available right now" empty state and the views stay empty.
export default async (page, base) => {
  const res = await page.goto(base + '/nba/cup', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto /nba/cup failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForTimeout(1200);
  const sel = page.locator('#cup-view');
  for (const [label, url] of [['Wild card', /view=wildcard/], ['Knockout', /view=bracket/], ['Odds', /view=odds/]]) {
    const value = await sel.locator('option', { hasText: label }).first().getAttribute('value');
    await Promise.all([page.waitForURL(url), sel.selectOption(value)]);
    await page.waitForTimeout(1200);
  }
};
