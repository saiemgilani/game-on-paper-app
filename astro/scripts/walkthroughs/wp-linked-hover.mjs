// Hover the WP chart: that play's row lights up. Click: All Plays opens on that play.
// Focus a play row (keyboard) or hover a drive row: the chart answers. A tap on the chart
// shows its tooltip without moving the page, and a swipe that starts on the chart scrolls.
export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  const canvas = page.locator('#wpChart');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('the WP chart has no box');
  const at = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 };
  const pixels = () => canvas.evaluate((c) => c.toDataURL());
  const scrollY = () => page.evaluate(() => window.scrollY);
  const allPlaysOpen = () => page.evaluate(() => document.getElementById('all-plays')?.classList.contains('show'));

  // touch: a tap is not a jump, and the chart does not swallow a scroll
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y == null ? [] : [{ x: at.x, y }] });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const y0 = await scrollY();
  await touch('touchStart', at.y);
  await touch('touchEnd');
  await page.waitForTimeout(800);
  if (Math.abs((await scrollY()) - y0) > 4 || (await allPlaysOpen())) throw new Error('a tap on the WP chart moved the page');
  await touch('touchStart', at.y);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', at.y - i * 30); await page.waitForTimeout(16); }
  await touch('touchEnd');
  await page.waitForTimeout(600);
  if ((await scrollY()) - y0 < 100) throw new Error('a swipe that starts on the WP chart did not scroll the page');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await canvas.evaluate((c) => c.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1000);
  const box2 = await canvas.boundingBox();
  const at2 = { x: box2.x + box2.width * 0.6, y: box2.y + box2.height * 0.5 };

  // mouse: hover lights the play's rows, and not by colour alone
  await page.mouse.move(at2.x, at2.y, { steps: 5 });
  await page.waitForTimeout(600);
  const lit = page.locator('tr.table-active[data-play-row]');
  if ((await lit.count()) < 1) throw new Error('hovering the WP chart lit no play row');
  const deco = await lit.first().evaluate((tr) => getComputedStyle(tr).textDecorationLine);
  if (!deco.includes('underline')) throw new Error(`a lit row is marked by colour alone (text-decoration: ${deco})`);
  const n = (await lit.first().getAttribute('href')).match(/-(\d+)$/)[1];
  // leaving the chart puts the rows back
  await page.mouse.move(at2.x, Math.max(5, box2.y - 40), { steps: 5 });
  await page.waitForTimeout(400);
  if ((await lit.count()) > 0) throw new Error('rows stayed lit after the pointer left the WP chart');
  await page.mouse.move(at2.x, at2.y, { steps: 5 });
  await page.waitForTimeout(400);

  // click: All Plays opens on that play
  await page.mouse.click(at2.x, at2.y);
  await page.locator('#all-plays').waitFor({ state: 'visible', timeout: 5000 });
  // the page scrolls smoothly, so wait for the row to arrive rather than a fixed time
  await page.waitForFunction((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return !!r && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  }, `tr[href="#play-all-${n}"]`, { timeout: 8000 })
    .catch(() => { throw new Error(`clicking the chart did not bring play ${n} into view`); });
  await page.waitForTimeout(1000);

  // keyboard: focus moving onto a play row activates its WP point, as hover does
  await page.mouse.move(1, 1);
  await page.evaluate(() => {
    window.__hovered = [];
    window.addEventListener('gop:hover-play', (e) => window.__hovered.push(e.detail.n));
  });
  await page.waitForTimeout(300);
  const calm = await pixels();
  await page.locator(`tr[href="#play-all-${n}"] a`).first().focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
  const focusedRow = await page.evaluate(() => document.activeElement?.closest('tr[href]')?.getAttribute('href'));
  const m = Number(focusedRow?.match(/-(\d+)$/)?.[1]);
  if (!m || !(await page.evaluate(() => window.__hovered)).includes(m)) throw new Error(`tabbing onto play ${focusedRow} did not reach the chart`);
  if ((await pixels()) === calm) throw new Error('the WP chart did not change when a play row took focus');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());

  // drive row: hovering it shades the drive's stretch of the line
  const drives = page.locator('a[data-bs-toggle="collapse"][href="#drives"]');
  await drives.scrollIntoViewIfNeeded();
  await drives.click();
  await page.locator('#drives').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(800);
  const before = await pixels();
  const row = page.locator('#drives tr.accordion-toggle').nth(2);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.waitForTimeout(500);
  if ((await pixels()) === before) throw new Error('hovering a drive row did not shade the WP chart');
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
