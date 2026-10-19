// MBB game page, one overtime: the WP chart, the second half's shots, collapse then reopen the first half.
// Behind the 'mbb' preview flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
export default async (page, base) => {
  const path = '/mbb/game/401820775';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#wp_container canvas', { timeout: 30_000 });
  await page.click('#shots button:has-text("H2")');
  await page.click('#plays details:first-of-type summary'); // closes "1st Half"
  await page.waitForSelector('#plays details:first-of-type table', { state: 'hidden', timeout: 30_000 });
  await page.click('#plays details:first-of-type summary');
  await page.waitForSelector('#plays details:first-of-type table', { state: 'visible', timeout: 30_000 });
};
