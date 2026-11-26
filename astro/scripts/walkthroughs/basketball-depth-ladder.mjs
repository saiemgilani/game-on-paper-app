// Depth ladder (BB-G61): the Nets' team page scrolled to the ladder, then Duke's (a college roster on the same tiers). The
// evidence build forces every 'preview' flag on; before sdv-db's season-products reload the section is absent.
export default async (page, base) => {
  await page.goto(base + '/nba/team/1610612751', { waitUntil: 'networkidle', timeout: 90_000 });
  const ladder = page.locator('#depth-ladder');
  if (await ladder.count()) await ladder.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.goto(base + '/mbb/team/150', { waitUntil: 'networkidle', timeout: 90_000 });
  if (await ladder.count()) await ladder.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
};
