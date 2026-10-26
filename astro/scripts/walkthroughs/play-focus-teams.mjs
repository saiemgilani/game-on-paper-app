// Open the "Show only" player menu on the game Akshay flagged (Georgia Tech at Georgia, 2014)
// and check Tech's kicker, returner and field-goal blocker sit under Tech, then narrow the play
// list to the kicker's field goals. The expected count is ESPN's box score (Butker 1/2), not
// the menu's own label, so field goals counted from kickoffs would fail here.
const BODY = '[data-plays-body="all"]';
const TECH_PLAYERS = ['Harrison Butker', 'Jamal Golden', 'Adam Gotsis'];
const BUTKER_FG_ATTEMPTS = 2;

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
  for (const name of TECH_PLAYERS) {
    const groups = await select.evaluate((s, n) => [...s.querySelectorAll('option')]
      .filter((o) => o.dataset.name === n).map((o) => o.parentElement.label), name);
    if (!groups.length) throw new Error(`${name} is not in the menu`);
    if (!groups.every((g) => /tech/i.test(g))) throw new Error(`${name} listed under ${groups.join(', ')}`);
  }

  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const fg = await select.evaluate((s) => {
    const o = [...s.options].find((x) => x.dataset.name === 'Harrison Butker' && x.dataset.role === 'fg');
    return o && { value: o.value, label: o.textContent.trim() };
  });
  if (!fg) throw new Error('no field-goal option for Harrison Butker');
  if (!fg.label.endsWith(`(${BUTKER_FG_ATTEMPTS})`)) throw new Error(`"${fg.label}" should count ${BUTKER_FG_ATTEMPTS} attempts`);
  await select.selectOption(fg.value);
  await page.waitForTimeout(800);
  const shown = await page.locator(`${BODY} > tr.accordion-toggle`).evaluateAll((rows) => rows.filter((r) => r.offsetParent !== null).length);
  if (shown !== BUTKER_FG_ATTEMPTS) throw new Error(`"${fg.label}" shows ${shown} plays, want ${BUTKER_FG_ATTEMPTS}`);
  await page.waitForTimeout(1500);
};
