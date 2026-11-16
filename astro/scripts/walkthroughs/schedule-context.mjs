// Open the Nets' team page, open the season block's Schedule panel for BB-G53's rest, trip, opponent and line columns
// and the records line, hover a back-to-back badge, then scroll to the Rotation section's minutes strip. The columns and
// the section are behind 'bball-team-season' and 'bball-schedule-context'; the evidence build forces every 'preview'
// flag on (lighthouse-compare.mjs), so the clean URL renders them.
const PATH = '/nba/team/1610612751?season=2026';

export default async (page, base) => {
  const res = await page.goto(base + PATH, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${PATH} failed: status ${res ? res.status() : '(no response)'}`);
  const panel = page.locator('#season-schedule-panel');
  if ((await panel.count()) !== 1) throw new Error(`${PATH}: no Schedule panel (are the preview flags on?)`);
  await panel.locator('summary').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await panel.locator('summary').click();
  await page.locator('#season-schedule-context').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  // Q21: the Proj / vs Proj columns (rated_priors) and the "Against our projection" W-L on the records line
  if ((await page.locator('#season-schedule-vs-proj').count()) !== 1) throw new Error(`${PATH}: no projection W-L (is rated_priors served?)`);
  await page.locator('#season-schedule-vs-proj').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await panel.locator('#season-schedule th', { hasText: 'vs Proj' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const b2b = panel.locator('#season-schedule .badge').first();
  if ((await b2b.count()) === 1) {
    await b2b.scrollIntoViewIfNeeded();
    await b2b.hover();
    await page.waitForTimeout(1500);
  }
  await page.locator('#rotation').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
};
