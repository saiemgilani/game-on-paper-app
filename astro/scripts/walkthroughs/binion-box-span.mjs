// Open a final game's Team Stats, pick a half in the span selector, and watch the Binion
// box drop its percentiles: the ladder is single full games, so a quarter or half shows its
// values unranked (no %ile, no cell colours, no caption). Back to the full game, they return.
// The evidence build forces every 'preview' flag on, so the clean URL renders the v2 page.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  const select = page.locator('#team-stats #span-stats');
  // the flow exists to exercise this selector: a missing one is a failed recording, not a skip
  if ((await select.count()) !== 1) throw new Error(`expected one span selector, found ${await select.count()}`);
  // the island hydrates on load; a change event before that would do nothing
  await page.locator('astro-island:not([ssr]) #span-stats').waitFor({ state: 'attached', timeout: 30_000 });
  const box = page.locator('#team-stats table', { has: page.locator('a[href*="robert_binion"]') });
  const ranks = box.locator('td.numeral small');
  const shaded = box.locator('td[class*="hulk-bg-level-"]');
  const caption = box.locator('caption span');
  const expectRanked = async (want, where) => {
    const [r, s, c] = [await ranks.count(), await shaded.count(), await caption.count()];
    if (want ? !(r > 0 && s > 0 && c === 1) : r + s + c !== 0) {
      throw new Error(`${where}: expected ${want ? 'ranked' : 'unranked'} cells, got ${r} %ile marks, ${s} shaded, ${c} caption`);
    }
  };
  await box.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await expectRanked(true, 'full game');
  // a half if the game has one, else the first period span offered
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
  const span = values.includes('h1') ? 'h1' : values.find((v) => v !== 'all');
  if (!span) throw new Error('the span selector offers no quarter or half');
  await select.selectOption(span);
  await caption.waitFor({ state: 'detached', timeout: 5000 });
  await expectRanked(false, span);
  await page.waitForTimeout(2000);
  await select.selectOption('all');
  await caption.waitFor({ state: 'attached', timeout: 5000 });
  await expectRanked(true, 'back to the full game');
  await page.waitForTimeout(2000);
};
