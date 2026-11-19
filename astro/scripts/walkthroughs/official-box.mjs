// The official box (utils/officialBox.ts): open a 2026 CFB final, show the Team Stats "Box Score"
// table ('official-team-box'), then expand both teams' player sections, whose stat lines read
// ESPN's box (Jared Curtis: 25/40 passing, 9 carries for -18 with the NCAA's sacks).
export default async (page, base) => {
  await page.goto(base + '/game/401856889', { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForTimeout(1500);
  const box = page.locator('th.box-heading', { hasText: 'Box Score' });
  if ((await box.count()) !== 1) throw new Error(`expected one Box Score table, found ${await box.count()}`);
  await box.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  for (const id of ['away-stats-panel', 'home-stats-panel']) {
    const toggle = page.locator(`a[data-bs-toggle="collapse"][href="#${id}"]`);
    if ((await toggle.count()) !== 1) throw new Error(`expected one toggle for #${id}, found ${await toggle.count()}`);
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await page.locator(`#${id}`).waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
    await page.waitForTimeout(1500);
  }
};
