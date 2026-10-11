// Open a Nets player's shooting dashboard, switch the hex chart to zones, pick Home games, set a
// 5-game rolling window and scroll through. The page is behind the 'nba' preview flag: pass the
// preview cookie the walkthrough runner supports (WALKTHROUGH_COOKIE), or run against
// a tree with the flag forced on.
const PAGES = ['/nba/players/1629008?season=2026'];

export default async (page, base) => {
  for (const path of PAGES) {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
    const hex = page.locator('#nba-hex-panel');
    if ((await hex.count()) !== 1) throw new Error(`${path}: expected one shot chart panel`);
    await hex.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await hex.getByRole('button', { name: 'Zones' }).click();
    await page.waitForTimeout(1200);
    await hex.getByRole('button', { name: 'Raw' }).click();
    const games = page.locator('#nba-games-panel');
    if ((await games.count()) === 1) {
      await games.scrollIntoViewIfNeeded();
      await games.getByRole('button', { name: 'Home' }).click();
      await page.waitForTimeout(1200);
      await games.getByRole('button', { name: 'All' }).click();
    }
    const rolling = page.locator('#nba-rolling-panel');
    if ((await rolling.count()) === 1) {
      await rolling.scrollIntoViewIfNeeded();
      await rolling.getByRole('button', { name: '5 games' }).click();
      await page.waitForTimeout(1200);
    }
    await page.locator('#nba-versus-panel, nav[aria-label$="players"]').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
};
