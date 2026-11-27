// The college football team-season page's Passing Direction panel: Alabama 2026, Offense, then Defense from the side
// select. Behind 'team-pass-direction': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag
// forced on. Without the flag (or a pbp read) the page renders as today and this flow says so.
export default async (page, base) => {
  const path = '/year/2026/team/333';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const panel = page.locator('#pass-direction-panel');
  if (!(await panel.count())) { console.log('no Passing Direction panel: flag off or no pbp rows'); return; }
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.selectOption('#pass-direction-side', 'def');
  await page.waitForTimeout(2500);
  await page.selectOption('#pass-direction-side', 'off');
  await page.waitForTimeout(1500);
};
