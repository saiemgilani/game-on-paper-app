// Open a season team page, scroll to Team Stats, pick Conference Games, then Last 4 Games, then
// All Games from its select (each a navigation to ?games=), and check the title and the base
// team count follow the set. The evidence build forces every 'preview' flag on
// (lighthouse-compare.mjs), so the clean URL renders the panel.
export default async (page, base) => {
  await page.goto(base + '/year/2025/team/333', { waitUntil: 'networkidle', timeout: 90_000 });
  const panel = page.locator('#game-set-panel');
  // the flow exists to exercise this panel: a missing one is a failed recording, not a skip
  if ((await panel.count()) !== 1) throw new Error(`expected one Team Stats panel, found ${await panel.count()}`);
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const [value, title, pool] of [['?games=conf', 'Team Stats (Filtered)', 'SEC teams'], ['?games=last4', 'Team Stats (Filtered)', 'FBS teams'], ['?games=all', 'Team Stats', 'FBS teams']]) {
    await Promise.all([page.waitForURL(`**${value}`, { timeout: 90_000 }), page.locator('#game-set-select').selectOption(value)]);
    await page.waitForLoadState('networkidle');
    const heading = (await page.locator('#game-set-panel h2').textContent()).replace('[show/hide]', '').trim();
    if (heading !== title) throw new Error(`${value}: title "${heading}", expected "${title}"`);
    if (!(await page.locator('#game-set-panel caption').textContent()).includes(pool)) throw new Error(`${value}: caption does not rank among ${pool}`);
    await page.locator('#game-set-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
