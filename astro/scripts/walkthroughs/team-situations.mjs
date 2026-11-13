// The Situations sections (BB-G25): Minnesota 2025-26's team page, scrolled to the section, then Tied and Transition
// from its Situation select (each a plain URL); then Anthony Edwards' player page, the same control on Home; then a final's
// game page (DET at BKN, Nov 7 2025), its Situations panel on Leading. Behind
// 'bball-situational' inside each league's flag: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with the
// flags forced on.
const TEAM = '/nba/team/1610612750?season=2026';
const PLAYER = '/nba/players/1630162?season=2026';
const GAME = '/nba/game/401809773';

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 60_000 });
  await page.locator('#situations').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
}

async function open(page, base, path, table) {
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForSelector(table, { timeout: 30_000 });
  await settle(page);
}

async function pick(page, label, url) {
  await Promise.all([page.waitForURL(url, { timeout: 60_000 }), page.locator('#situation').selectOption({ label })]);
  await settle(page);
}

export default async (page, base) => {
  await open(page, base, TEAM, '#situations-team');
  await pick(page, 'Tied', /situation=tied/);
  await pick(page, 'Transition', /situation=transition/);
  await open(page, base, PLAYER, '#situations-player');
  await pick(page, 'Home', /situation=home/);
  await open(page, base, GAME, '#game-situations');
  await pick(page, 'Leading', /situation=leading/);
};
