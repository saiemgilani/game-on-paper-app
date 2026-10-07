// Download the WP chart: the PNG carries a title band and a URL footer, so it is taller than the chart.
import { readFileSync } from 'node:fs';

export default async (page, base) => {
  await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  const canvas = page.locator('#wpChart');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  await canvas.scrollIntoViewIfNeeded();
  // the handler is bound once the chart has drawn; a click before that downloads the page itself
  await page.waitForFunction(() => document.getElementById('wp-download')?.onclick, null, { timeout: 15_000 });
  const chartHeight = await canvas.evaluate((c) => c.height);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#wp-download').click()]);
  if (!download.suggestedFilename().endsWith('.png')) throw new Error(`saved as ${download.suggestedFilename()}`);
  const png = readFileSync(await download.path());
  if (png.toString('ascii', 1, 4) !== 'PNG') throw new Error('the download is not a PNG');
  const height = png.readUInt32BE(20); // IHDR height
  if (!(height > chartHeight)) throw new Error(`export is ${height}px tall, the chart ${chartHeight}px: no title or footer`);
  // the old export was a transparent PNG: the corner must carry the page background
  const alpha = await page.locator('#wp-download').evaluate(async (a) => {
    const img = new Image();
    img.src = a.href;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(1, 1, 1, 1).data[3];
  });
  if (alpha !== 255) throw new Error(`export background is transparent (alpha ${alpha})`);
  await page.waitForTimeout(1000);
};
