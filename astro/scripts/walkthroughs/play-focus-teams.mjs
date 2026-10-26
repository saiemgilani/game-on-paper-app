// Open the "Show only" player menu on the game Akshay flagged (Georgia Tech at Georgia, 2014)
// and check the kicker and returners sit under their own team, then narrow the play list to
// the Tech kicker's field goals and check the list shows exactly that many plays.
const BODY = '[data-plays-body="all"]';

export default async (page, base) => {
  const res = await page.goto(base + '/game/400547779', { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  const open = page.locator('a[data-bs-toggle="collapse"][href="#all-plays"]');
  if ((await open.count()) !== 1) throw new Error(`expected one All Plays toggle, found ${await open.count()}`);
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await page.locator('#all-plays').waitFor({ state: 'visible', timeout: 5000 });
  const select = page.locator('#focus-all');
  if ((await select.count()) !== 1) throw new Error('no "Show only" menu on the play list');

  // each player's options must sit in the optgroup of the team he plays for
  const groupOf = (name) => select.evaluate((s, n) => [...s.querySelectorAll('option')]
    .filter((o) => o.dataset.name === n).map((o) => o.parentElement.label), name);
  for (const name of ['Harrison Butker', 'Jamal Golden']) {
    const groups = await groupOf(name);
    if (!groups.length) throw new Error(`${name} is not in the menu`);
    if (!groups.every((g) => /tech/i.test(g))) throw new Error(`${name} listed under ${groups.join(', ')}`);
  }

  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const fg = await select.evaluate((s) => {
    const o = [...s.options].find((x) => x.dataset.name === 'Harrison Butker' && x.dataset.role === 'fg');
    return o && { value: o.value, label: o.textContent };
  });
  if (!fg) throw new Error('no field-goal option for Harrison Butker');
  const label = fg.label;
  const want = Number(/\((\d+)\)/.exec(label)[1]);
  await select.selectOption(fg.value);
  await page.waitForTimeout(800);
  const shown = await page.locator(`${BODY} > tr.accordion-toggle`).evaluateAll((rows) => rows.filter((r) => r.offsetParent !== null).length);
  if (shown !== want) throw new Error(`"${label.trim()}" shows ${shown} plays`);
  await page.waitForTimeout(1500);
};
