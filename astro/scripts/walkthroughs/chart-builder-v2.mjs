// Chart Builder v2: change X and Y, press Random, then Plot. Nothing navigates before Plot,
// and Plot loads the canonical builder URL (a cached GET; no client-side fetch).
export default async (page, base) => {
  const start = base + '/charts/builder?season=2025&x=adj_off_epa&y=adj_def_epa';
  await page.goto(start, { waitUntil: 'networkidle', timeout: 90_000 });
  if ((await page.locator('#builder-controls').count()) !== 1) throw new Error('expected the control bar above the chart');
  await page.waitForTimeout(1200);
  const loaded = page.url();
  // the logos taint the canvas (no toDataURL), so compare what it shows
  const chart = () => page.locator('#metric_chart_canvas').screenshot();
  const before = await chart();

  await page.selectOption('#builder-x', 'success_off');
  await page.waitForTimeout(800);
  await page.selectOption('#builder-y', 'success_def');
  await page.waitForTimeout(800);
  await page.click('#random-axes');
  await page.waitForTimeout(1200);
  if (page.url() !== loaded) throw new Error('a select or Random navigated before Plot');
  const x = await page.inputValue('#builder-x');
  const y = await page.inputValue('#builder-y');
  if (x === y || (x === 'success_off' && y === 'success_def')) throw new Error(`Random did not pick new axes: ${x}, ${y}`);
  const titles = await page.evaluate(() => ['#builder-x', '#builder-y'].map((s) => document.querySelector(s).selectedOptions[0].text));

  await Promise.all([page.waitForURL((u) => u.toString() !== loaded, { timeout: 90_000 }), page.click('#plot-chart')]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  const got = new URL(page.url());
  const want = new URL(base + `/charts/builder?season=2025&x=${x}&y=${y}`);
  if (got.pathname + got.search !== want.pathname + want.search) throw new Error(`not the canonical URL: ${got.pathname}${got.search}`);
  if ((await chart()).equals(before)) throw new Error('the chart did not redraw');
  const head = await page.locator('#points_table thead').innerText();
  if (!titles.every((t) => head.includes(t))) throw new Error(`the table is not titled ${titles.join(' / ')}: ${head}`);
  await page.locator('#points_table').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
};
