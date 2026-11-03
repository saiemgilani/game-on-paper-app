// The whole basketball section, captioned: each stop names the page, the PR that built it and what to look at.
// A deliberate tour, not a PR flow, so it runs ~3 min (the README asks ~60 s of a PR flow). Behind the nba/wnba/mbb/wbb preview
// flags: pass WALKTHROUGH_COOKIE (see README.md) or run against a tree with them forced on.
//   BASE=http://localhost:4321 WALKTHROUGH_DEVICES=desktop npm run walkthrough -- --steps scripts/walkthroughs/basketball-tour.mjs

const caption = (page, title, text) =>
  page.evaluate(([t, s]) => {
    let el = document.getElementById('tour-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tour-caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;max-width:min(880px,92vw);'
        + 'background:rgba(17,17,17,.92);color:#fff;padding:12px 18px;border-radius:10px;font:15px/1.4 system-ui,sans-serif;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none';
      document.body.appendChild(el);
    }
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:700;font-size:16px;margin-bottom:2px';
    head.textContent = t;
    const body = document.createElement('div');
    body.textContent = s;
    el.replaceChildren(head, body);
  }, [title, text]);

const go = async (page, base, path) => {
  const res = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  if (!res || !res.ok()) throw new Error(`goto ${path} failed: status ${res ? res.status() : '(no response)'}`);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}); // a live page keeps polling
};

const scrollTo = async (page, selector, pause = 2200) => {
  await page.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => window.scrollBy(0, -70));
  await page.waitForTimeout(pause);
};

// [path, title, caption, then: optional extra steps]
const STOPS = [
  ['/nba/scoreboard?date=2025-01-15', 'NBA scoreboard · #318 (landed)', 'Day navigation, a card per game with leaders; live days refresh, past days are cached for good. Spice borders (this tour\'s parity PR) light close, late games.'],
  ['/nba/game/401766458', 'NBA game page · #319 (landed)', 'Header with the line and pregame prior, then win probability with its biggest swings, four factors, team and player boxes, both teams\' shots, play-by-play.', async (page) => {
    await scrollTo(page, '#wp');
    await caption(page, 'Win probability', 'The pregame prior, the in-game curve and the ten biggest swings, same chart island as football.');
    await scrollTo(page, '#factors');
    await caption(page, 'Four factors', 'eFG%, turnover rate, offensive rebounding and free-throw rate with possessions, ORtg, DRtg and pace.');
    await scrollTo(page, '#shots', 2800);
    await caption(page, 'Game shot charts', 'Every attempt for each team: dots made, crosses missed, filterable by quarter.');
  }],
  ['/nba/team/1610612751?season=2026', 'NBA team page · #316 (landed) + square bins (new)', 'The six-chart shooting dashboard and the roster by attempts. The shot chart is now square bins, sdvplot-js style.', async (page) => {
    await scrollTo(page, '#nba-hex', 2800);
    await caption(page, 'Square bins, linked', 'Hover a distance bar: the court rings that distance and the far squares fade, the 2021 Blazing the Nets link.');
    const box = await page.locator('#nba-share svg').boundingBox();
    if (box) {
      for (const f of [0.08, 0.3, 0.55, 0.72]) {
        await page.mouse.move(box.x + box.width * f, box.y + box.height * 0.5, { steps: 8 });
        await page.waitForTimeout(900);
      }
    }
    await scrollTo(page, '#nba-hex', 600);
    const court = await page.locator('#nba-hex svg').boundingBox();
    if (court) {
      await page.mouse.click(court.x + court.width / 2, court.y + court.height * 0.3);
      await caption(page, 'Click to pin', 'A clicked square stays lit with its tooltip, and its distance stays marked on the signature and the bars.');
      await page.waitForTimeout(2600);
    }
  }],
  ['/nba/players/1629008?season=2026', 'NBA player page · #314 (landed)', 'Headshot, the stat line and league ranks, then the explorer: pick games or drag the timeline and every chart rebuilds.', async (page) => {
    await scrollTo(page, '#nba-hex', 2600);
  }],
  ['/nba/leaders', 'NBA leaders · #317 (landed)', 'Rolling 5/10/20-game shooting leaders with a metric switch and minimum-attempt bars.'],
  ['/nba/scatter', 'NBA scatter · #317 (landed)', 'Any two shooting metrics against each other, dots or faces, with zoom.'],
  ['/nba/game/401909922', 'NBA pregame · parity PR (new)', 'Football\'s pregame cards: Players to Watch from our own season rows (pts/g, TS%, USG%) and Recent Form, plus SportsEvent JSON-LD.', async (page) => {
    await scrollTo(page, 'h2:has-text("Players to Watch")', 3200);
  }],
  ['/wnba/scoreboard?date=2025-08-01', 'WNBA scoreboard · #332 (open)', 'The same board for the WNBA; an off-season day names ESPN\'s last game day instead of "Tonight".'],
  ['/wnba/game/401736287', 'WNBA game page · #332 (open)', 'The full game page on the WNBA court (22\'1.75" arc), quarters or the halves of 1997-2005.', async (page) => {
    await scrollTo(page, '#shots', 2600);
  }],
  ['/wnba/team/1611661328', 'WNBA team page · #340 (open)', 'Seattle\'s dashboard on the season\'s court; the WNBA landing is a teams index.', async (page) => {
    await scrollTo(page, '#nba-hex', 2600);
  }],
  ['/mbb/scoreboard?date=2025-02-22', 'Men\'s college scoreboard · #341 (open)', 'Top 25, Division I or any conference via ?group=, with games split into live, upcoming and final.'],
  ['/mbb/game/401820775', 'Men\'s college game page · #341 (open)', 'Halves, an overtime, the NCAA court by season and ESPN\'s shot locations.', async (page) => {
    await scrollTo(page, '#wp', 2200);
    await scrollTo(page, '#shots', 2400);
  }],
  ['/mbb/teams?season=2026', 'Men\'s college teams · #342 (open)', 'Every Division I team grouped by conference that season.'],
  ['/mbb/team/251', 'Texas · #342 (open)', 'College dashboards read stats.ncaa.org shot charts (regular season + postseason) with a coverage note.', async (page) => {
    await scrollTo(page, '#nba-hex', 2600);
  }],
  ['/mbb/scatter', 'Men\'s college scatter · #342 (open)', 'The scatter with a conference filter, defaulting to the conference with the most qualified players.'],
  ['/wbb/scoreboard?date=2026-02-07', 'Women\'s college scoreboard · #343 (open)', 'The college board for the women\'s game.'],
  ['/wbb/team/2579', 'South Carolina · #344 (open)', 'The women\'s dashboards: same six charts, the women\'s court eras.', async (page) => {
    await scrollTo(page, '#nba-hex', 2600);
  }],
  ['/wbb/players/5239100', 'Joyce Edwards · #344 (open)', 'A college player page: the explorer, rolling shooting and each opponent.', async (page) => {
    await scrollTo(page, '#nba-hex', 2400);
  }],
];

export default async (page, base) => {
  for (const [path, title, text, then] of STOPS) {
    await go(page, base, path);
    await caption(page, title, text);
    await page.waitForTimeout(3200);
    if (then) await then(page);
  }
};
