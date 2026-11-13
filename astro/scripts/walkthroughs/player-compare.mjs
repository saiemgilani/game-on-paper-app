// Player compare: start from Cam Ward's player page, press Compare, add Dillon Gabriel and Kyle
// McCord from the add box, then remove Gabriel. Each step is a URL (?ids=), so the comparison is
// shareable at every point. The evidence build forces every 'preview' flag on.
const cards = (page) => page.locator('[data-compare-card]');

async function add(page, name, id) {
  const box = page.locator('#player-compare-input');
  await box.click();
  await box.pressSequentially(name, { delay: 120 });
  const hit = page.locator(`#player-compare-results a[href*="${id}"]`).first();
  await hit.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(1000);
  await hit.click();
  await page.waitForURL(new RegExp(`ids=[0-9,]*${id}`), { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

export default async (page, base) => {
  await page.goto(base + '/players/4688380?season=2024', { waitUntil: 'networkidle', timeout: 90_000 });
  const compare = page.locator('#player-compare-link');
  if ((await compare.count()) !== 1) throw new Error('expected the Compare button on the player page');
  await page.waitForTimeout(1500);
  await compare.click();
  await page.waitForURL(/\/players\/compare\?ids=4688380&season=2024/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await add(page, 'Dillon Gabriel', '4427238');
  await add(page, 'Kyle McCord', '4433971');
  if ((await cards(page).count()) !== 3) throw new Error(`expected 3 cards, found ${await cards(page).count()}`);
  await page.locator('[data-compare-card="4427238"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.locator('[data-compare-card="4427238"] [data-compare-remove]').click();
  await page.waitForURL(/ids=4688380,4433971/, { timeout: 30_000 });
  if ((await cards(page).count()) !== 2) throw new Error(`expected 2 cards after removing, found ${await cards(page).count()}`);
  await page.waitForTimeout(2000);
};
