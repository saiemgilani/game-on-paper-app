// The scoreboard's conference filter follows the season picker ('scoreboard-season-groups').
export default async (page, base) => {
  await page.goto(base + '/year/2024', { waitUntil: 'networkidle', timeout: 90_000 });
  // the picker is a client:idle island: a selection made before it hydrates changes nothing
  await page.locator('astro-island:not([ssr]) form.form-picker').waitFor({ timeout: 15_000 });
  const season = page.locator('form.form-picker select').nth(0);
  const conference = page.locator('form.form-picker select').nth(2);
  const labels = () => conference.locator('option').allTextContents();

  if (!(await labels()).includes('Big South-OVC')) throw new Error('the 2024 list has no Big South-OVC');
  await conference.selectOption({ label: 'UAC' });
  await page.waitForTimeout(1200);

  // 2019 has no UAC: the list swaps and the filter falls back to FBS
  await season.selectOption('2019');
  await page.waitForTimeout(1200);
  const after = await labels();
  if (after.includes('UAC') || !after.includes('OVC')) throw new Error(`the list did not follow the season: ${after.join(', ')}`);
  if ((await conference.inputValue()) !== '80') throw new Error(`expected the filter reset to FBS, got ${await conference.inputValue()}`);

  await conference.selectOption({ label: 'OVC' });
  await page.waitForTimeout(800);
  await Promise.all([
    page.waitForURL(/\/year\/2019\?group=26$/, { timeout: 60_000 }),
    page.locator('form.form-picker button[type=submit]').click(),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 90_000 });
  await page.waitForTimeout(1500);
};
