// Open a team-season page, hover a team that appears in two nearby-rank tables, and check both rows light up.
export default async (page, base) => {
  const res = await page.goto(base + '/nfl/year/2025/team/14', { waitUntil: 'networkidle', timeout: 90_000 });
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
  // an "other" entity: appears in two tables and is not the page's own row
  const key = await root.evaluate((el) => {
    const seen = {};
    for (const tr of el.querySelectorAll('tr[data-nb-key][data-nb-self="false"]')) seen[tr.dataset.nbKey] = (seen[tr.dataset.nbKey] ?? 0) + 1;
    return Object.keys(seen).find((k) => seen[k] >= 2);
  });
  if (!key) throw new Error('no other team appears in two tables');
  await root.locator(`tr[data-nb-key="${key}"]`).first().hover();
  // wait for the highlight to actually land on a second row, not a fixed sleep
  await root.locator(`tr[data-nb-key="${key}"].table-info`).nth(1).waitFor({ timeout: 5000 });
  const lit = await root.locator(`tr[data-nb-key="${key}"].table-info`).count();
  if (lit < 2) throw new Error(`hover lit ${lit} rows, expected at least 2`);

  // the own row: hovering it must not lose its identifying mark, and it must
  // never pick up table-info alongside table-secondary (final review finding)
  const own = root.locator('tr[data-nb-self="true"]');
  const ownCount = await own.count();
  if (ownCount < 1) throw new Error('no own row found');
  await own.first().hover();
  await page.waitForTimeout(200);
  const stillMarked = await root.locator('tr[data-nb-self="true"].table-secondary').count();
  if (stillMarked !== ownCount) throw new Error(`own row lost table-secondary on hover: ${stillMarked}/${ownCount}`);
  const conflicting = await root.locator('tr[data-nb-self="true"].table-info').count();
  if (conflicting !== 0) throw new Error(`own row combined table-secondary with table-info on ${conflicting} row(s)`);
  const ariaCurrent = await root.locator('[aria-current="page"]').count();
  if (ariaCurrent < 1) throw new Error('own row missing aria-current="page"');

  await page.waitForTimeout(1500);
};
