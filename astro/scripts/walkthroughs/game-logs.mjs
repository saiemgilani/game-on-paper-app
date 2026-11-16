// BB-G50's review answers. On the Nets' team page, open the season block's Schedule panel: with the game log on it keeps
// the results and upcoming games and drops each game's ratings and four factors, which the game log below carries. Then
// a Nets player's log, scrolled to a game he played without a field-goal attempt (listed from his box). Behind
// 'bball-team-season' and 'bball-game-logs'; the evidence build forces every 'preview' flag on, so the clean URLs render them.
const TEAM = '/nba/team/1610612751?season=2026';
const PLAYER = '/nba/players/1642962?season=2026';
const NO_FGA_GAME = '0022500669'; // 2026-01-27 at PHX: 0/0 from the field

const open = async (page, base, path) => {
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
};

export default async (page, base) => {
  await open(page, base, TEAM);
  const panel = page.locator('#season-schedule-panel');
  if ((await panel.count()) !== 1) throw new Error(`${TEAM}: no Schedule panel (are the preview flags on?)`);
  await panel.locator('summary').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await panel.locator('summary').click();
  await page.waitForTimeout(2000);
  await page.locator('#team-game-log').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);

  await open(page, base, PLAYER);
  const row = page.locator(`#player-game-log-table tr[data-game="${NO_FGA_GAME}"]`);
  if ((await row.count()) !== 1) throw new Error(`${PLAYER}: no log row for ${NO_FGA_GAME}`);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
};
