// Open a finished game's play list, flip it to newest first and back, the way a reader does.
// Checks the rows really moved: the last play comes to the top with its detail row right
// under it, and the second click puts the first play back on top.
const BODY = '[data-plays-body="all"]';
const SUMMARY = `${BODY} > tr.accordion-toggle`;

export default async (page, base) => {
  const res = await page.goto(base + '/game/401856682', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  // the All Plays panel starts collapsed: open it the way a reader does
  const open = page.locator('a[data-bs-toggle="collapse"][href="#all-plays"]');
  if ((await open.count()) !== 1) throw new Error(`expected one All Plays toggle, found ${await open.count()}`);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.locator('#all-plays').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1000);
  const toggle = page.locator('[data-play-focus="all"] [data-order-toggle]');
  // the flow exists to exercise this button: a missing one is a failed recording, not a skip
  if ((await toggle.count()) !== 1) throw new Error(`expected one order toggle, found ${await toggle.count()}`);
  const summaries = page.locator(SUMMARY);
  if ((await summaries.count()) < 2) throw new Error('the play list has fewer than two plays');
  const first = await summaries.first().getAttribute('href');
  const last = await summaries.last().getAttribute('href');
  if ((await toggle.textContent()).trim() !== 'Oldest first') throw new Error('a final game should start oldest first');

  await toggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await toggle.click();
  await page.waitForFunction(({ sel, want }) => document.querySelector(sel)?.getAttribute('href') === want, { sel: SUMMARY, want: last }, { timeout: 5000 });
  const under = await page.locator(`${BODY} > tr`).nth(1).getAttribute('id');
  if (`#${under}` !== last) throw new Error(`the top play's detail row is not under it (${under} vs ${last})`);
  if ((await toggle.textContent()).trim() !== 'Newest first') throw new Error('the label did not flip to Newest first');
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') throw new Error('aria-pressed did not flip');
  await page.waitForTimeout(1500);

  await toggle.click();
  await page.waitForFunction(({ sel, want }) => document.querySelector(sel)?.getAttribute('href') === want, { sel: SUMMARY, want: first }, { timeout: 5000 });
  await page.waitForTimeout(1200);
};
