// WNBA scoreboard: a 2025 day with a double overtime, step back a day, pick a 2005 (halves-era) date, find its overtime game.
// Behind the 'wnba' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/wnba/scoreboard?date=2025-08-01';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('a[href="/wnba/game/401736289"]', { timeout: 30_000 });
  await Promise.all([page.waitForURL(/date=2025-07-31/, { timeout: 30_000 }), page.click('a[rel="prev"]')]);
  await page.waitForSelector('h1');
  await Promise.all([
    page.waitForURL(/date=2005-06-03/, { timeout: 30_000 }),
    (async () => { await page.fill('#nba-date', '2005-06-03'); await page.dispatchEvent('#nba-date', 'change'); })(),
  ]);
  await page.waitForSelector('a[href="/wnba/game/250603003"]', { timeout: 30_000 });
};
