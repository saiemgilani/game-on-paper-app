// BB-G2: the garbage-time select above the four factors. Behind 'bball-garbage-time' (with 'bball-impact-box') inside
// 'wbb': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on. GW at Temple, a final
// whose college log flags 14 possessions: pick "Garbage time out" above the four factors, land back on #factors with the
// All and GT out columns, then the same select in the Impact panel.
export default async (page, base) => {
  const res = await page.goto(base + '/wbb/game/401824983', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#garbage-factors', { timeout: 30_000 });
  await page.locator('#garbage-toggle-factors').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await Promise.all([
    page.waitForURL(/garbage=out/, { timeout: 60_000 }),
    page.selectOption('#garbage-factors', { label: 'Garbage time out' }),
  ]);
  await page.waitForSelector('#garbage-factors-note', { timeout: 30_000 });
  await page.locator('#garbage-toggle-factors').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.locator('#garbage-toggle').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
