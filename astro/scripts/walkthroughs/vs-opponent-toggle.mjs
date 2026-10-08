// Open a season team page, scroll to Results by Opponent, switch it to Margin, then to
// Success %, then back to Raw, and hover a bar for its game. The evidence build forces
// every 'preview' flag on (lighthouse-compare.mjs), so the clean URL renders the panel.
export default async (page, base) => {
  await page.goto(base + '/year/2025/team/333', { waitUntil: 'networkidle', timeout: 90_000 });
  const panel = page.locator('#vs-opponent');
  // the flow exists to exercise this panel: a missing one is a failed recording, not a skip
  if ((await panel.count()) !== 1) throw new Error(`expected one Results by Opponent panel, found ${await panel.count()}`);
  await panel.scrollIntoViewIfNeeded();
  // client:visible: the selects only switch the chart once the island has hydrated
  await page.locator('astro-island[component-url*="OpponentBarChart"]:not([ssr])').waitFor({ state: 'attached', timeout: 15_000 });
  const average = panel.locator('span', { hasText: 'Season average:' });
  await page.waitForTimeout(1500);
  for (const [select, value] of [['#vs-opponent-view', 'margin'], ['#vs-opponent-metric', 'success'], ['#vs-opponent-view', 'raw']]) {
    const before = await average.textContent();
    await page.locator(select).selectOption(value);
    // assert the switch redrew, not just that the select changed
    await page.waitForFunction(([el, prev]) => el.textContent !== prev, [await average.elementHandle(), before], { timeout: 5000 });
    await page.waitForTimeout(1500);
  }
  const box = await panel.locator('canvas').boundingBox();
  if (box) {
    // the first game's bar sits in the top row of the chart
    await page.mouse.move(box.x + box.width * 0.6, box.y + 18);
    await page.waitForTimeout(1500);
  }
};
