// The player page's Situations section (BB-G55): scroll to it, pick Clutch, then Second chance, from the Situation select.
// Behind 'bball-player-situations' inside 'nba': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const path = '/nba/players/1628983?season=2026';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#situations-player', { timeout: 30_000 });
  await page.locator('#situations').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  for (const label of ['Clutch', 'Second chance']) {
    // each option is a URL: the select navigates, so wait for the new page's table
    await Promise.all([page.waitForURL(/situation=/, { timeout: 30_000 }), page.selectOption('#situation', { label })]);
    await page.waitForSelector('#situations-player', { timeout: 30_000 });
    await page.locator('#situations').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
  }
};
