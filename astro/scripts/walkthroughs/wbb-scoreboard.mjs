// WBB scoreboard: the Top 25 board of a Saturday, switch to the Big 12, step back a day (the group stays), open all of D-I.
// Behind the 'wbb' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/wbb/scoreboard?date=2026-02-07';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('a[href="/wbb/game/401827378"]', { timeout: 30_000 }); // ASU at #15 Baylor, a ranked Big 12 game
  await Promise.all([page.waitForURL(/group=8/, { timeout: 30_000 }), page.selectOption('#nba-group', '8')]);
  await page.waitForSelector('a[href="/wbb/game/401827380"]', { timeout: 30_000 }); // CIN at KU, unranked: only on the conference board
  await Promise.all([page.waitForURL(/date=2026-02-06&group=8/, { timeout: 30_000 }), page.click('a[rel="prev"]')]);
  await page.waitForSelector('h1'); // no Big 12 game that Friday: the empty conference board
  await Promise.all([page.waitForURL(/group=all/, { timeout: 30_000 }), page.selectOption('#nba-group', 'all')]);
  await page.waitForSelector('a[href^="/wbb/game/"]', { timeout: 30_000 }); // 7 D-I games on 2026-02-06
};
