// 'bball-share-card' (G-R5): the Share button on a basketball player page and a team page
// shares the page's own link at once (no menu: there is no score to hide), through the share
// sheet, then through the copy fallback with its toast. The evidence build forces every
// 'preview' flag on, so the clean URLs render the button. Headless Chrome has no share sheet
// and the clipboard needs a permission, so both are recorded in the page.
const PAGES = ['/nba/players/1629029?season=2027', '/nba/team/1610612751?season=2027'];

export default async (page, base) => {
  await page.addInitScript(() => {
    window.__shared = [];
    window.__copied = [];
    navigator.share = async (data) => { window.__shared.push(data.url); };
    if (navigator.clipboard) navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
  });
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    const button = page.locator('button[aria-label="Share"] >> visible=true');
    if ((await button.count()) !== 1) throw new Error(`${path}: expected one visible Share button, found ${await button.count()}`);
    await page.waitForFunction(() => [...document.querySelectorAll('astro-island[component-url*="ShareButton"]')].every((i) => !i.hasAttribute('ssr')), null, { timeout: 30_000 });
    await button.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const want = `https://gameonpaper.com${path}`;
    const last = (list) => page.evaluate((l) => window[l].at(-1), list);

    await button.click();
    if ((await page.locator('.dropdown-menu').count()) !== 0) throw new Error(`${path}: the Share button opened a menu`);
    if ((await last('__shared')) !== want) throw new Error(`${path}: shared ${await last('__shared')}, expected ${want}`);
    await page.waitForTimeout(800);

    // a browser without a share sheet copies the link and says so
    await page.evaluate(() => { navigator.share = undefined; });
    await button.click();
    if ((await last('__copied')) !== want) throw new Error(`${path}: copied ${await last('__copied')}, expected ${want}`);
    await page.locator('.toast.show', { hasText: 'Link copied' }).waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1500);
  }
};
