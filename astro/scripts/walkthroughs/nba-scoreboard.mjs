// Scoreboard: tonight, step back a day, pick a date, find a game's link target. Behind the 'nba'
// preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/nba/scoreboard';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('h1');
  await Promise.all([page.waitForURL(/\/nba\/scoreboard\?date=/, { timeout: 30_000 }), page.click('a[rel="prev"]')]);
  await page.waitForSelector('h1');
  await Promise.all([
    page.waitForURL(/date=2025-04-15/, { timeout: 30_000 }),
    (async () => { await page.fill('#nba-date', '2025-04-15'); await page.dispatchEvent('#nba-date', 'change'); })(),
  ]);
  await page.waitForSelector('a[href="/nba/game/401766458"]', { timeout: 30_000 });
};
