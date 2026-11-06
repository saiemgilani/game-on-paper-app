// The Nets' square-bin shot chart: sweep the share-by-distance bars (the court rings each distance and fades far squares),
// sweep the shooting signature, then click a square to pin it and click again to release it. Behind the 'nba' preview flag:
// pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flag forced on.
const TEAM = '/nba/team/1610612751?season=2026';

export default async (page, base) => {
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.max(page.viewportSize().height, 1400) });
  const res = await page.goto(base + TEAM, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${TEAM} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector('#nba-hex svg g path', { timeout: 30_000 });
  await page.locator('#nba-hex').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const sweep = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`${TEAM}: no ${selector}`);
    for (let f = 0.1; f <= 0.95; f += 0.12) {
      await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.45, { steps: 6 });
      await page.waitForTimeout(500);
    }
  };
  await sweep('#nba-share svg');
  await sweep('#nba-signature svg');
  const court = await page.locator('#nba-hex svg').boundingBox();
  await page.mouse.click(court.x + court.width / 2, court.y + court.height * 0.3);
  await page.mouse.move(court.x + 10, court.y + 10, { steps: 6 });
  await page.waitForTimeout(1500);
  await page.mouse.click(court.x + court.width / 2, court.y + court.height * 0.3);
  await page.waitForTimeout(800);
};
