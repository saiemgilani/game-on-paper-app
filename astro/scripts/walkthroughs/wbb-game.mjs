// WBB game page, four quarters and one overtime: the WP chart, the fourth quarter's shots, collapse then reopen the first quarter.
// Behind the 'wbb' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/wbb/game/401805076';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#wp_container canvas', { timeout: 30_000 });
  await page.click('#shots button:has-text("Q4")');
  await page.click('#plays details:first-of-type summary'); // closes "1st Quarter"
  await page.waitForSelector('#plays details:first-of-type table', { state: 'hidden', timeout: 30_000 });
  await page.click('#plays details:first-of-type summary');
  await page.waitForSelector('#plays details:first-of-type table', { state: 'visible', timeout: 30_000 });
};
