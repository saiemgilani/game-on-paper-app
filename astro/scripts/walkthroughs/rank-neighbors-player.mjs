// Open a player's season page and hover a player who appears in two nearby-rank tables: both rows light up,
// and the page's own row keeps its mark. `?season=` is what gives a player page its ranked row, and an
// `Evidence routes:` entry cannot carry a query string, so this flow is how the player route gets recorded.
export default async (page, base) => {
  const res = await page.goto(base + '/players/4837248?season=2025', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  const root = page.locator('[data-neighbor-ranks]');
  if ((await root.count()) !== 1) throw new Error(`expected one nearby-ranks block, found ${await root.count()}`);
  await root.scrollIntoViewIfNeeded();
  // Below md one table shows at a time, switched from the metric picker (Akshay on #296);
  // the cross-table hover below is a desktop interaction, so a phone run steps the picker instead.
  const pick = root.locator('select[data-nb-select]');
  if (await pick.isVisible()) {
    const metrics = await pick.locator('option').evaluateAll((os) => os.map((o) => o.value));
    for (const m of metrics) {
      await pick.selectOption(m);
      await root.locator(`[data-nb-col="${m}"]`).waitFor({ state: 'visible', timeout: 5000 });
      const shown = await root.locator('[data-nb-col]:visible').count();
      if (shown !== 1) throw new Error(`picker on ${m}: ${shown} tables visible, expected 1`);
      await page.waitForTimeout(700);
    }
    return;
  }
  await page.waitForTimeout(1200);
  // an "other" player: appears in two tables and is not the page's own row
  const key = await root.evaluate((el) => {
    const seen = {};
    for (const tr of el.querySelectorAll('tr[data-nb-key][data-nb-self="false"]')) seen[tr.dataset.nbKey] = (seen[tr.dataset.nbKey] ?? 0) + 1;
    return Object.keys(seen).find((k) => seen[k] >= 2);
  });
  if (!key) throw new Error('no other player appears in two tables');
  await root.locator(`tr[data-nb-key="${key}"]`).first().hover();
  await root.locator(`tr[data-nb-key="${key}"].table-info`).nth(1).waitFor({ timeout: 5000 });

  const own = root.locator('tr[data-nb-self="true"]');
  const ownCount = await own.count();
  if (ownCount < 1) throw new Error('no own row found');
  await own.first().hover();
  await page.waitForTimeout(200);
  const stillMarked = await root.locator('tr[data-nb-self="true"].table-secondary').count();
  if (stillMarked !== ownCount) throw new Error(`own row lost table-secondary on hover: ${stillMarked}/${ownCount}`);
  await page.waitForTimeout(1500);
};
