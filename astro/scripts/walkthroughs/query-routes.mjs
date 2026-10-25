// Open a player season and a team page BY QUERY STRING and assert the page honours it. Each
// check is on something the default render (no query string) does not show, so a dropped
// query string fails the recording instead of passing on the default view:
//   /players/4837248?season=2024  career view is the default; 2024 is a game log only this season has
//   /year/2025/team/333?side=def  Situational Splits opens on Offense unless ?side=def
const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
const fail = (msg) => { throw new Error(msg); };

async function open(page, base, path) {
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90_000 });
  if (!res || !res.ok()) fail(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
}

export default async (page, base) => {
  // player: the season select, the page title and the game log must all be 2024's
  await open(page, base, '/players/4837248?season=2024');
  const picked = norm(await page.locator('select option[selected], select option:checked').first().innerText());
  if (picked !== '2024') fail(`season select shows "${picked}", expected 2024`);
  if (!(await page.title()).includes('2024')) fail(`title is not the 2024 page: ${await page.title()}`);
  const log = page.locator('#player-game-log');
  if ((await log.count()) !== 1) fail('expected one game log');
  const logText = norm(await log.innerText());
  // 2024 week 2 at Auburn; the 2025 log opens with Kennesaw State and a different line
  if (!logText.includes('Auburn') || !logText.includes('25/36, 233 yds, 2 TD')) fail('2024 game log values missing');
  if (logText.includes('Kennesaw State')) fail('game log shows 2025 games');
  await log.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);

  // team: the page must open on Defense, with the defense row visible
  await open(page, base, '/year/2025/team/333?side=def');
  const select = page.locator('#team-splits-side');
  if ((await select.count()) !== 1) fail('expected one Situational Splits select');
  if ((await select.inputValue()) !== 'def') fail(`splits select opened on "${await select.inputValue()}", expected def`);
  const epa = page.locator('#team-splits tr[data-split="overall"]:not(.d-none) td:nth-child(4)');
  const shown = norm(await epa.innerText());
  const def = norm(await page.locator('#team-splits tr[data-side="def"][data-split="overall"] td:nth-child(4)').textContent());
  const off = norm(await page.locator('#team-splits tr[data-side="off"][data-split="overall"] td:nth-child(4)').textContent());
  if (shown !== def || shown === off) fail(`visible Overall EPA/Play ${shown}; defense ${def}, offense ${off}`);
  await select.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
};
