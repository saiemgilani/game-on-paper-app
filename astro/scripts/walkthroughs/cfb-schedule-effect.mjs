// The college football team-season page's Schedule Effect panel (B2): LSU 2025, then open "Every game". Behind
// 'cfb-schedule-effect': pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on. The panel
// needs the team_adjustment_ledger table in the Data API; without it the page renders as today and this flow says so.
export default async (page, base) => {
  const path = '/year/2025/team/99';
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  const panel = page.locator('#schedule-effect');
  if (!(await panel.count())) { console.log('no Schedule Effect panel: team_adjustment_ledger not served yet'); return; }
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await panel.locator('summary').click();
  await page.waitForTimeout(2000);
};
