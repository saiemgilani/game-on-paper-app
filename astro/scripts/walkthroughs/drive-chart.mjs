// Open a final game's Drives panel and expand a scoring drive, the way a reader does, so the
// recording shows the drive chart drawing. The default scroll-through never opens a drive.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  const panel = page.locator('a[data-bs-toggle="collapse"][href="#drives"]');
  if ((await panel.count()) !== 1) throw new Error(`expected one Drives panel toggle, found ${await panel.count()}`);
  await panel.scrollIntoViewIfNeeded();
  await panel.click();
  await page.locator('#drives').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(800);

  const row = page.locator('#drives tr.accordion-toggle.table-success').first();
  if ((await row.count()) === 0) throw new Error('no scoring drive to expand');
  const target = await row.getAttribute('href');
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const canvas = page.locator(`${target} canvas`);
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  await canvas.scrollIntoViewIfNeeded();

  // Each end zone is painted in its team's colour. A team whose colour never reached the chart
  // gets teamColorHex's fallback (#2394fd); an unpainted canvas is transparent or field green.
  const endZones = await canvas.evaluate((c) => {
    const ctx = c.getContext('2d');
    const d = window.devicePixelRatio;
    return [30, 690].map((x) => [...ctx.getImageData(x * d, 150 * d, 1, 1).data]);
  });
  const notATeamColour = [[0, 153, 41], [0x23, 0x94, 0xfd]];
  for (const [r, g, b, a] of endZones) {
    if (a === 0 || notATeamColour.some(([R, G, B]) => r === R && g === G && b === B)) {
      throw new Error(`end zone not painted in a team colour: rgba(${r},${g},${b},${a})`);
    }
  }
  await page.waitForTimeout(1500);
};
