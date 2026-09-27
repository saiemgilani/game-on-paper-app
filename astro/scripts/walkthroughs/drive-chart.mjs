// Open the Drives section of a final game and expand the first drive, so its drive chart is on screen.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  const toggle = page.locator('a.toggle-link[href="#drives"]');
  if ((await toggle.count()) !== 1) throw new Error(`expected one Drives toggle, found ${await toggle.count()}`);
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.locator('#drives').waitFor({ state: 'visible', timeout: 5000 });
  const row = page.locator('#drives tr.accordion-toggle:visible').first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const canvas = page.locator('#drives .accordion-body.show canvas');
  await canvas.waitFor({ state: 'visible', timeout: 5000 });
  // a canvas the chart never initialised keeps the browser default 300x150 and renders blank
  const [bitmap, want] = await canvas.evaluate((c) => [`${c.width}x${c.height}`, `${720 * devicePixelRatio}x${300 * devicePixelRatio}`]);
  if (bitmap !== want) throw new Error(`drive chart did not draw: canvas bitmap is ${bitmap}, expected ${want}`);
  await page.waitForTimeout(2000);
};
