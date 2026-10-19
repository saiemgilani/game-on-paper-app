// Open the Share menu beside Watch and hand over both links: the game's own and the
// ?spoilers=off one whose link preview hides the score, first through the share sheet,
// then through the copy fallback a browser without one gets. The evidence build forces
// every 'preview' flag on (lighthouse-compare.mjs), so the clean URL renders the button.
// Headless Chrome has no share sheet and the clipboard needs a permission, so both are
// recorded in the page: the flow proves which URL each item hands over.
const GAME = '/game/401856682';

export default async (page, base) => {
  await page.addInitScript(() => {
    window.__shared = [];
    window.__copied = [];
    navigator.share = async (data) => { window.__shared.push(data.url); };
    if (navigator.clipboard) navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
  });
  await page.goto(base + GAME, { waitUntil: 'networkidle', timeout: 90_000 });
  // one button per header twin; the viewport shows one of them
  const button = page.locator('button[aria-label="Share"] >> visible=true');
  if ((await button.count()) !== 1) throw new Error(`expected one visible Share button, found ${await button.count()}`);
  // client:load: wait until the island has hydrated before clicking it
  await page.waitForFunction(() => [...document.querySelectorAll('astro-island[component-url*="ShareButton"]')].every((i) => !i.hasAttribute('ssr')), null, { timeout: 30_000 });
  const menu = page.locator('.dropdown-menu.show');

  const pick = async (item) => {
    await button.click();
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    // the approved design: the menu hangs from the button's right edge
    const [b, m] = [await button.boundingBox(), await menu.boundingBox()];
    if (Math.abs(b.x + b.width - (m.x + m.width)) > 2 || m.y < b.y + b.height - 1) throw new Error(`menu not right-aligned below the button: ${JSON.stringify({ b, m })}`);
    await page.waitForTimeout(1200);
    await menu.getByText(item, { exact: false }).first().click();
    await menu.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(800);
  };
  const expectLast = async (list, suffix) => {
    const got = await page.evaluate((l) => window[l].at(-1), list);
    if (!got?.endsWith(suffix)) throw new Error(`${list}: expected a URL ending ${suffix}, got ${got}`);
  };

  await pick('Share link');
  await expectLast('__shared', GAME);
  await pick('Share without the score');
  await expectLast('__shared', `${GAME}?spoilers=off`);

  // a browser without a share sheet copies the link and says so
  await page.evaluate(() => { navigator.share = undefined; });
  await pick('Share without the score');
  await expectLast('__copied', `${GAME}?spoilers=off`);
  await page.locator('.toast.show', { hasText: 'Link copied' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1500);

  // Escape closes an open menu without sharing
  await button.click();
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(800);
};
