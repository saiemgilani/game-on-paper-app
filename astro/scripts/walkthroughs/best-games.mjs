// Best Games board (BB-G29): /nba/best-games (the current season, or last season's labelled board), a past season from
// the select, a team, a day range, then a game page from the board; and /wbb/best-games. Behind 'bball-gei' inside each
// league's flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the flags forced on. With the cookie the
// flow starts on the uncacheable /preview surface, since the public URL may answer an edge-cached anonymous 404 first.
const pre = process.env.WALKTHROUGH_COOKIE ? '/preview' : '';
export default async (page, base) => {
  const go = async (path) => {
    const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
    if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  };
  await go(`${pre}/nba/best-games`);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/season=2025/), page.locator('#best-games-season').selectOption({ label: '2024-25' })]);
  await page.waitForTimeout(1200);
  const team = page.locator('#best-games-team');
  // the 2025 champion, so the April 19 (playoffs) start below still leaves games to open
  await team.selectOption({ label: 'Oklahoma City Thunder' });
  await Promise.all([page.waitForURL(/team=/), page.getByRole('button', { name: 'Apply' }).click()]);
  await page.waitForTimeout(1200);
  await page.locator('#best-games-from').fill('2025-04-19');
  await Promise.all([page.waitForURL(/from=2025-04-19/), page.getByRole('button', { name: 'Apply' }).click()]);
  await page.waitForTimeout(1200);
  await Promise.all([page.waitForURL(/\/nba\/game\//), page.locator('#best-games-table tbody a').first().click()]);
  await page.waitForTimeout(1500);
  await go(`${pre}/wbb/best-games`);
  await page.waitForTimeout(1500);
};
