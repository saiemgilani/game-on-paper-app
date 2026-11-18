// The live game page's Latest strip (BB-G41): the panel above Win probability and its nav item. Behind
// 'bball-latest-strip' inside each league's flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the
// flags forced on. The strip shows on a live game only, so LATEST_GAME=/nba/game/<id> names one; without it the flow
// tries each league's scoreboard for a game page with the strip and, when nothing is live, says so and records none.
export default async (page, base) => {
  // a named game must load; while searching, a page that fails (a 503 when the processor has no feed yet) is skipped
  const open = async (path, required = false) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => null);
    if (!res || !res.ok()) {
      if (required) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
      return false;
    }
    return (await page.locator('#latest').count()) > 0;
  };
  let found = process.env.LATEST_GAME ? await open(process.env.LATEST_GAME, true) : false;
  for (const league of process.env.LATEST_GAME ? [] : ['nba', 'wnba', 'mbb', 'wbb']) {
    if (found) break;
    await open(`/${league}/scoreboard`);
    const hrefs = (await page.locator('a.btn:has-text("Stats")').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).slice(0, 3);
    for (const h of hrefs) if ((found = await open(h))) break;
  }
  if (!found) { console.log('latest-strip: no live game found; nothing to record'); return; }
  // the page nav's link is hidden at phone width (the mobile run timed out on it): click it where it shows, else scroll
  const nav = page.locator('a[href="#latest"]').first();
  if (await nav.isVisible().catch(() => false)) await nav.click();
  await page.locator('#latest svg').scrollIntoViewIfNeeded();
  await page.hover('#latest svg g:last-of-type').catch(() => {}); // the newest mark's title
  // #445: the strip refetches the page every 30 s while live; wait for one refetch (within ~35 s) and the swap after it
  const here = page.url().split('#')[0];
  const refetch = await page.waitForResponse((r) => r.request().resourceType() === 'fetch' && r.url().split('#')[0] === here, { timeout: 35_000 }).catch(() => null);
  console.log(refetch ? `latest-strip: refetched (${refetch.status()})` : 'latest-strip: no refetch within 35 s');
  await page.waitForTimeout(1500);
};
