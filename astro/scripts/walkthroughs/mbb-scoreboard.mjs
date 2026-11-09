// MBB scoreboard: the Top 25 board of a busy Saturday, switch to the Big 12, step back to its previous game day (the group stays), open all of D-I.
// The Big 12 had no game on 2025-02-21 or 02-20 (ESPN group=8, checked 2026-10-19), so the step clicks back three days to 2025-02-19.
// Behind the 'mbb' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/mbb/scoreboard?date=2025-02-22';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('a[href="/mbb/game/401725751"]', { timeout: 30_000 }); // HOU at ISU, a ranked Big 12 game
  await Promise.all([page.waitForURL(/group=8/, { timeout: 30_000 }), page.selectOption('#nba-group', '8')]);
  await page.waitForSelector('a[href="/mbb/game/401725755"]', { timeout: 30_000 });
  for (const day of ['2025-02-21', '2025-02-20', '2025-02-19']) {
    await Promise.all([page.waitForURL(new RegExp(`date=${day}&group=8`), { timeout: 30_000 }), page.click('a[rel="prev"]')]);
    await page.waitForSelector('h1');
  }
  await page.waitForSelector('a[href="/mbb/game/401725749"]', { timeout: 30_000 }); // CIN at WVU
  await Promise.all([page.waitForURL(/group=all/, { timeout: 30_000 }), page.selectOption('#nba-group', 'all')]);
  await page.waitForSelector('a[href^="/mbb/game/"]', { timeout: 30_000 });
};
