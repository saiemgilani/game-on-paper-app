// Game page: a final, toggle a shot-chart period, collapse then reopen a quarter (a final opens every quarter). Behind the
// 'nba' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/nba/game/401766458';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#wp_container canvas', { timeout: 30_000 });
  await page.click('#shots button:has-text("Q4")');
  await page.click('#plays details:first-of-type summary'); // closes it
  await page.waitForSelector('#plays details:first-of-type table', { state: 'hidden', timeout: 30_000 });
  await page.click('#plays details:first-of-type summary'); // opens it again
  await page.waitForSelector('#plays details:first-of-type table', { state: 'visible', timeout: 30_000 });
};
