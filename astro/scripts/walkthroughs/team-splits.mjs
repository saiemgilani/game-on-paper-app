// Open a season team page, scroll to Situational Splits and switch it from Offense to
// Defense, the way a reader does. The evidence build forces every 'preview' flag on
// (lighthouse-compare.mjs), so the clean URL renders the flagged panel.
export default async (page, base) => {
  await page.goto(base + '/year/2025/team/333', { waitUntil: 'networkidle', timeout: 90_000 });
  const select = page.locator('#team-splits-side');
  // the flow exists to exercise this panel: a missing select is a failed recording, not a skip
  if ((await select.count()) !== 1) throw new Error(`expected one Situational Splits select, found ${await select.count()}`);
  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  // the visible Overall EPA/Play cell (4th column), offense then defense
  const epa = page.locator('#team-splits tr[data-split="overall"]:not(.d-none) td:nth-child(4)');
  const off = (await epa.innerText()).trim();
  const want = (await page.locator('#team-splits tr[data-side="def"][data-split="overall"] td:nth-child(4)').textContent())?.trim();
  await select.selectOption('def');
  await page.waitForTimeout(1200);
  const def = (await epa.innerText()).trim();
  if (def !== want || def === off) throw new Error(`Overall EPA/Play after switching: ${def} (offense ${off}, defense ${want})`);
  if (!page.url().includes('side=def')) throw new Error(`URL did not take ?side=def: ${page.url()}`);
  await page.locator('#team-splits tr[data-split="vs_ranked"]:not(.d-none)').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await select.selectOption('off');
  await page.waitForTimeout(1200);
};
