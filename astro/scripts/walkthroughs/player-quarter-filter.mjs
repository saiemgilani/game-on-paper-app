// G9: open a final game's home player section, pick the 1st quarter in its "Show only"
// select, and watch the Game window hide and the 1st-quarter window show; then back to Game.
// The evidence build forces every 'preview' flag on, so the clean URL renders the filter.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  const panel = page.locator('#home-stats-panel');
  // the panel starts collapsed; open it from its [show/hide] toggle
  await page.locator('a.toggle-link[href="#home-stats-panel"]').click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  const select = panel.locator('[data-player-span-bar] select');
  // the flow exists to exercise this selector: a missing one is a failed recording, not a skip
  if ((await select.count()) !== 1) throw new Error(`expected one player span selector, found ${await select.count()}`);
  const win = (key) => panel.locator(`[data-player-span="${key}"]`);
  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await select.selectOption('q1');
  await win('q1').waitFor({ state: 'visible', timeout: 5000 });
  if (await win('all').isVisible()) throw new Error('the Game window is still visible on 1st quarter');
  await page.waitForTimeout(2500);
  await select.selectOption('all');
  await win('all').waitFor({ state: 'visible', timeout: 5000 });
  if (await win('q1').isVisible()) throw new Error('the 1st-quarter window is still visible on Game');
  await page.waitForTimeout(1500);
};
