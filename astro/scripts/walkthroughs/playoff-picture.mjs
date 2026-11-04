// Pro standings and playoff picture (BB-G23): /nba/standings on the 2025-26 snapshot (the standings with the play-in
// group, the seed odds, the divisions, the first round, the lottery), then /wnba/standings (last season's labelled
// final snapshot) and its lottery view. Behind 'bball-playoff-picture' inside 'nba' / 'wnba': pass WALKTHROUGH_COOKIE
// (see README.md) or run against a tree with the flags forced on.
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  const pick = async (id, label, url) => {
    const sel = page.locator(`#${id}`);
    const value = await sel.locator('option', { hasText: label }).first().getAttribute('value');
    await Promise.all([page.waitForURL(url), sel.selectOption(value)]);
    await page.waitForTimeout(1200);
  };
  await go('/nba/standings?season=2026');
  await page.waitForTimeout(1200);
  await page.getByRole('heading', { name: 'Western Conference' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pick('standings-view', 'Seed odds', /view=seeds/);
  await pick('standings-view', 'Divisions', /view=divisions/);
  await pick('standings-view', 'Bracket', /view=bracket/);
  await pick('standings-view', 'Lottery', /view=lottery/);
  await page.getByRole('heading', { name: 'Lottery odds by slot' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await go('/wnba/standings');
  await page.waitForTimeout(1500);
  await pick('standings-view', 'Lottery', /view=lottery/);
};
