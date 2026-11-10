// The game page's Game info panel (BB-G42): a 2026-27 final, from the Game info nav entry to the officials' season
// profiles, then the injury report and the DNPs. Behind 'bball-game-info' inside 'nba': pass WALKTHROUGH_COOKIE (see
// README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/game/401909834';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#info', { timeout: 30_000 });
  const nav = page.locator('a[href="#info"].link-secondary');
  if (await nav.isVisible()) await nav.click();
  else await page.locator('#info').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  for (const id of ['#injury-report', '#dnp-list']) {
    const el = page.locator(id);
    if (await el.count()) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(1800); }
  }
};
