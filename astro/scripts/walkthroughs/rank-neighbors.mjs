// Open a team-season page, hover a team that appears in two nearby-rank tables, and check both rows light up.
export default async (page, base) => {
  await page.goto(base + '/nfl/year/2025/team/14', { waitUntil: 'networkidle', timeout: 90_000 });
  const root = page.locator('[data-neighbor-ranks]');
  if ((await root.count()) !== 1) throw new Error(`expected one nearby-ranks block, found ${await root.count()}`);
  await root.scrollIntoViewIfNeeded();
  const key = await root.evaluate((el) => {
    const seen = {};
    for (const tr of el.querySelectorAll('tr[data-nb-key]:not(.table-active)')) seen[tr.dataset.nbKey] = (seen[tr.dataset.nbKey] ?? 0) + 1;
    return Object.keys(seen).find((k) => seen[k] >= 2);
  });
  if (!key) throw new Error('no team appears in two tables');
  await root.locator(`tr[data-nb-key="${key}"]`).first().hover();
  await page.waitForTimeout(600);
  const lit = await root.locator(`tr[data-nb-key="${key}"].table-primary`).count();
  if (lit < 2) throw new Error(`hover lit ${lit} rows, expected at least 2`);
  await page.waitForTimeout(1500);
};
