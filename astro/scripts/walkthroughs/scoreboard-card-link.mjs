// The scoreboard card link ('scoreboard-card-link', preview): a click on a desktop card's team rows, away from its
// Stats button, opens the game. Phones get the compact rows (one link each, 'scoreboard-compact'), so the mobile
// pass clicks a row instead.
export default async (page, base) => {
  await page.goto(base + '/year/2025/type/2/week/12', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1000);
  const card = page.locator('.col-xl-3 .col.p-3').first();
  const desktop = await card.isVisible();
  const target = desktop ? card : page.locator('.game-banner').first();
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  // the card's first team row, well clear of the Stats and broadcast buttons at the bottom
  await Promise.all([page.waitForURL(/\/game\/\d+/, { timeout: 90_000 }), target.click(desktop ? { position: { x: 60, y: 50 } } : {})]);
  await page.waitForTimeout(2500);
};
