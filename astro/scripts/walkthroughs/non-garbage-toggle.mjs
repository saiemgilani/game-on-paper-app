// Open a lopsided final's Team Stats (Alabama 38, Wisconsin 14, 2025: garbage time in the second half), switch the
// All / Non-garbage toggle and watch the Overall box re-count without those plays, then switch back. Picking a
// quarter in "Show only" hides the toggle: it is the full game's. The evidence build forces every 'preview' flag on
// and runs the PR's own processor, so the clean URL renders the toggle.
export default async (page, base) => {
  await page.goto(base + '/game/401752696', { waitUntil: 'networkidle', timeout: 90_000 });
  // the island hydrates on load; a click before that would do nothing
  await page.locator('astro-island:not([ssr]) #span-stats').waitFor({ state: 'attached', timeout: 30_000 });
  const group = page.locator('#team-stats [aria-label="Plays counted"]');
  // the flow exists to exercise this toggle: a missing one is a failed recording, not a skip
  if ((await group.count()) !== 1) throw new Error(`expected one All / Non-garbage toggle, found ${await group.count()}`);
  const box = page.locator('#team-stats table', { has: page.locator('th', { hasText: /^Overall$/ }) });
  const cells = () => box.locator('td.numeral').allInnerTexts();
  await box.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const all = await cells();
  await group.getByRole('button', { name: 'Non-garbage', exact: true }).click();
  await page.waitForTimeout(2000);
  const clean = await cells();
  if (clean.join('|') === all.join('|')) throw new Error('the Overall box did not change on Non-garbage');
  await group.getByRole('button', { name: 'All', exact: true }).click();
  await page.waitForTimeout(1500);
  if ((await cells()).join('|') !== all.join('|')) throw new Error('All did not restore the full-game box');
  await page.locator('#team-stats #span-stats').selectOption('q1');
  await group.waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForTimeout(1500);
  await page.locator('#team-stats #span-stats').selectOption('all');
  await group.waitFor({ state: 'attached', timeout: 5000 });
  await page.waitForTimeout(1500);
};
