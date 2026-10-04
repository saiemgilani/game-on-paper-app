// Open a player's season page and hover a player who appears in two nearby-rank tables: both rows light up,
// and the page's own row keeps its mark. `?season=` is what gives a player page its ranked row, and an
// `Evidence routes:` entry cannot carry a query string, so this flow is how the player route gets recorded.
export default async (page, base) => {
  const res = await page.goto(base + '/players/4837248?season=2025', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  const root = page.locator('[data-neighbor-ranks]');
  if ((await root.count()) !== 1) throw new Error(`expected one nearby-ranks block, found ${await root.count()}`);
  await root.scrollIntoViewIfNeeded();
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
