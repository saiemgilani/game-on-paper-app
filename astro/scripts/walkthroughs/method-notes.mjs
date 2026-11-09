// Open a finished game, scroll to Team Stats, hover its title and check it carries the game method note
// (flag 'method-notes'). The season-note subtitles are copy, covered by the route scroll-through.
export default async (page, base) => {
  const res = await page.goto(base + '/game/401729745', { waitUntil: 'networkidle', timeout: 120_000 });
  if (!res || !res.ok()) throw new Error(`goto failed: status ${res ? res.status() : '(no response)'}`);
  const hint = page.locator('#team-stats-panel h2 abbr');
  await hint.scrollIntoViewIfNeeded();
  await hint.hover();
  const title = await hint.getAttribute('title');
  if (!title || !title.includes('garbage time included')) throw new Error(`Team Stats hint is ${JSON.stringify(title)}`);
  await page.waitForTimeout(1500);
};
