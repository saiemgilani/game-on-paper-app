# Design conventions

Why this file exists: between 2026-09-05 and 2026-09-15 the site's design owner
([@akeaswaran](https://github.com/akeaswaran)) reworked most of the features added in
PRs #218–#256, because they did not match the existing site. Almost none of those
reworks were taste calls — they were *a convention already in the tree that the new
code did not use*. This file is that set of conventions, each with the commit or review
comment it comes from, so the next change matches on the first try instead of the third.

The rule underneath all of it: **match the existing site.** Never introduce a new font,
colour, spacing scale, table format, or component when one already exists. When unsure,
open the closest existing page and copy its pattern.

---

## 1. Sources of truth — read these before styling anything

There is no design-token file and no Tailwind config. The site is **Bootstrap 5
(vendored as static CSS) + a small set of hand-written app classes**. The truth lives in:

| File | What it owns |
|---|---|
| `astro/public/assets/css/base.css` | `@font-face` for Chivo + Fira Mono, `body { font-size: .875rem }`, `header { font-size: 1rem }`, sidebar/feather |
| `astro/public/assets/css/index.css` | the `font-family: "Chivo", "Fira Mono", serif` stack, scoreboard/index styling |
| `astro/public/assets/css/nav-header.css` | `.numeral` (table number font), the **`hulk-*` colour ramp** (`hulk-bg-level-0..9`, `hulk-bg-green`, `hulk-bg-purple`, `hulk-text-level-*`), nav header |
| `astro/public/assets/css/dark-index.css`, `dark-game.css` | the dark-mode halves, under `prefers-color-scheme` |
| `astro/public/assets/css/sticky-table.css`, `championship.css`, `favorite.css` | sticky table columns, championship/favourite accents |
| `astro/public/assets/css/bootstrap*.css` | vendored Bootstrap 5. **Never edit.** Its utility classes are the spacing/layout vocabulary |
| `astro/src/layouts/GenericPage.astro` | the page shell: Header, Footer, Scripts, breadcrumbs, JSON-LD, `heading` (visually-hidden h1) |
| `astro/src/layouts/ContentPage.astro` | prose/content pages |
| `astro/src/layouts/panel/GenericPanel.astro`, `panel/TeamPanel.astro` | the collapsible `[show/hide]` panel — the game page's only container |
| `astro/src/layouts/FilterGroup.astro` | the filter/toggle pill row |
| `astro/src/components/DarkModeLogos.astro` | dark-mode + override logo swapping |
| `astro/src/components/Header.astro`, `Footer.astro`, `NavScroller.astro` | nav, footer, in-page section nav |
| `astro/src/components/dropdowns/*.svelte` | the metric-switch dropdown pattern |
| `astro/src/utils/misc.ts` | `cleanField`, `cleanAbbreviation`, `cleanName`, `cleanLocation`, `cleanNickname`, `roundNumber`, `generateMarginalString`, `generateColorRampValue`, `generateTeamMetricTitle` |
| `astro/src/utils/constants.ts` | `MEME_LIST`, `MEME_STRING_LIST`, `SPECIAL_IMAGES`, `SPECIAL_IMAGES_DARK`, `NETWORK_MAPPINGS`, season constants |
| `astro/src/utils/playShade.ts` | play-row shading (`table-danger` / `table-success` / `table-warning`) |
| `astro/src/utils/features.ts` | the `FLAGS` map — every new thing ships through here (§9) |
| `astro/src/pages/glossary.astro` + `astro/src/components/glossary/*` | where metric explanations go instead of new pages |

Reference pages to match, by surface:

| Building a… | Match this |
|---|---|
| game page section | `astro/src/components/game/metrics/TraditionalTeamStats.astro` (table), `PaperIndex.astro` (panel + subtitle) |
| play table | `astro/src/components/game/plays/PlaysTable.astro` + `PlayRow.astro` |
| leaderboard / ranked table | `astro/src/components/leaderboards/CoachLeaderboardTable.astro`, and the team leaderboards |
| team / season page | `astro/src/components/team/**`, `astro/src/layouts/panel/TeamPanel.astro` |
| schedule / scoreboard | `astro/src/components/schedule/SchedulePage.astro` |
| static content page | `astro/src/pages/data-sources.astro` (post-`6e6c422d` form), `glossary.astro` |

`PERCENTILE_FEATURE_PROPOSAL.md` at the repo root is an outside contributor's feature
proposal, not design guidance — it is a precedent for *proposing before building*, nothing more.

---

## 2. Typography

- **Two fonts. That is the whole set.** `Chivo` (400 regular, 700 bold) for everything;
  `Fira Mono` (500) only as the fallback in the stack. Both are self-hosted from
  `astro/public/assets/fonts/`. Adding a font — or a Google Fonts `<link>` — is a
  regression. *Why: the stack is declared once in `index.css` and the files are vendored.*
- **Do not set font sizes by hand.** `body` is `.875rem`, `header` is `1rem`. Headings use
  Bootstrap's `fs-*` / `h1`–`h6`; small print uses `text-small` and `text-muted`.
  *`895b0d74` "header: return to consistent font size" added `header { font-size: 1rem !important }`
  back to `base.css` after a change had let the header inherit the body size.*
- **Numbers in tables get `class="numeral"`.** That class exists to switch the font for
  numerals only (`nav-header.css:69`). New numeric `<td>`s carry it; some older cells
  (`MatchupView.astro`) still do not, and that is debt to pay when touching them, not a
  pattern to copy.

## 3. Colour

- **Good/bad is green → purple, never green → red.** This is the site's strongest
  convention and the one most often broken by new code.
  - `generateColorRampValue()` (`utils/misc.ts`) returns `hulk-bg-level-0..9`; level 9 is
    green `#34C759`, level 0 is purple `#AF52DE`, levels 4–5 return `null` (no shading).
  - Akshay on #224: *"would rather use green and purple instead of green/red. we are already
    using those colors to mean good/bad"*; on #228: *"Should use green/purple instead of
    green/red to match site conventions"*; on #222 (`RecentForm.astro`): *"these should use
    green/purple to represent good/bad to match site style"*.
- **The one place red is correct is play-row shading**, and it is not a metric judgement:
  `utils/playShade.ts` — yellow = penalty, red = possession lost, green = score. Use the
  shared helper, do not re-derive it (see the classic/v2 note in §9).
- Otherwise use Bootstrap's semantic classes (`text-muted`, `text-success`, `text-danger`,
  `badge bg-danger`) as the existing components use them. **No hex literals in components.**

## 4. Spacing and layout

- Spacing is **Bootstrap utilities only** (`mb-3`, `mb-md-3`, `gap-1`, `gap-2`, `me-2`, `px-md-4`,
  `p-2`). No inline `margin`/`padding`, no new spacing class.
- **Check the responsive infix is real.** `9f70f26c` "game: fix unknown margin class" replaced
  `mb-xs-3` with `mb-3` in `game/classic/GamePage.astro` — Bootstrap has **no `xs` infix**, so
  `mb-xs-3` was dead markup that silently applied no margin.
- **Panels need `mb-md-3`.** Akshay on #224: *"Needs a `mb-md-3` to add margin on smaller screen
  sizes"* — `PaperIndex.astro` now renders `<Panel … class="mb-md-3">`. Read the infix
  literally: Bootstrap's `md-` utilities apply from the `md` breakpoint (≥768px) **up**, so
  `mb-md-3` spaces stacked panels on tablets and desktops; if a phone layout is the one
  missing its gap, that is `mb-3` (next bullet), not a bigger infix.
- **Don't stack redundant responsive margins.** #222 on `RecentForm.astro`: *"Think this just
  needs `mb-3` on mobile, too much whitespace if both are added"*.
- **Vertically align a logo with its text.** Flagged three separate times: #228 *"All of these
  elements are not vertically aligned"*, #222 *"also: the image and text are not properly
  vertically aligned"* and *"Need image/text alignment"*. The working pattern is a flex row
  (`d-flex align-items-center`) or the `img … me-2` + text inline pattern from
  `CoachLeaderboardTable.astro`.
- Mobile-first: real narrow viewports, not scaled desktop. `72cf38e6` "game: only invoke tap
  target height on xs screens" and `c1c106bb` "remove min height for button" both walked back
  tap-target CSS that applied too broadly.

## 5. Components — use the existing one

| Don't build / don't use | Use instead | Evidence |
|---|---|---|
| a Bootstrap **card** on the game page | `GenericPanel` / `Panel` section | #224: *"I don't think this needs to be a card on the game page because we don't use cards at all there. This can just be another GenericPanel section"* |
| `btn-group btn-group-sm` for a filter row | `layouts/FilterGroup.astro` (`d-flex … flex-wrap gap-1`, buttons each `btn btn-sm btn-outline-secondary`) | `c98c9740` "playfilters: match existing standard", `44b98fb4` "situational: match existing standards for tables" |
| a raw `<img>` for a team logo | `DarkModeLogos.astro` (+ `teamLogoUrl`), which also applies `SPECIAL_IMAGES` / `SPECIAL_IMAGES_DARK` overrides | #228: *"This does not handle dark mode images or our flagged image replacements at all"*; #224: *"This doesn't handle the dark mode images or our overrides"*, *"No dark mode support here either"* |
| printing `row.team` / `row.coach` / a location raw | `cleanField(row, field)`, `cleanAbbreviation`, `cleanName`, `cleanLocation`, `cleanNickname` | #228: *"this does not use our cleanLocation function"*; #222: *"it should be subject to our `cleanField` code"*, *"same as above re: cleaning of team abbreviations"*; `a0a15688` |
| a team **name** where the table shows a logo | the logo (dark-mode aware), to match the other tables | #224: *"This needs to be the team logo (accounting for dark mode/overrides) instead to match the other tables"* |
| a long page-anchor list to switch a dimension | the leaderboards' **dropdown** (`components/dropdowns/*.svelte`) | #228: *"A better approach may be to switch polls based on a dropdown (like on the leaderboards)"* and the same for conferences |
| a **new page** for metric explanations | add entries to `glossary.astro` / `components/glossary/*` | #226: *"I would also rather add all of these answers to the glossary rather than building a separate page"* |
| a one-off `extraClass` prop | the `class` prop, aliased to `className` (Astro convention) | #224 on `GenericPanel.astro`: *"where is this extra class coming from? just `class` seems to be enough here"* |
| a bespoke icon set / legend | keep the marker set minimal — only the explosive-play mark survived | `393e6845` "plays: as discussed, keep only explosive play marker", `3025307a`, `5344e605` (legend row deleted from `PlaysTable.astro`) |
| a helper under `src/lib/` | `src/utils/` (shared logic) or `src/resources/` (data access) | `b07e8632` "utils: move a few things around to match project norms" — moved `lib/telemetry`→`utils/telemetry`, `lib/manifest`→`utils/manifest`, `lib/adminAuth`→`resources/admin` |
| game-page logic that other consumers want | a method in `sportsdataverse-py`, called from `python/` | #221: *"I feel like the right place for this logic is in SDV-py so that other consumers can take advantage… We should just be able to run a method from SDV-py"* (twice, on `drive_summary.py` and `situational_stats.py`) |

Also: **Svelte only for real interactivity.** Astro components are the default; the tree's
Svelte islands are the dropdowns, `LocalDate`, and the ported box scores
(`bdd58257` "game: port binion box score to svelte and rig"). Don't reach for `is:inline`
without a reason — #225: *"does this need to be marked as is:inline?"*

## 6. Dark mode

Dark mode is `prefers-color-scheme`, served by `dark-index.css` / `dark-game.css`. Two things
break in it and both were caught in review, not by the author:

1. **Logos.** ESPN's default logo art is unreadable on dark. Always go through
   `DarkModeLogos.astro` — it emits `img.team-logo-<id> { content: url(<dark path>) }` plus the
   `SPECIAL_IMAGES_DARK` overrides. (`eb7c1135` "fix some dark mode images",
   `29d3da16` "darkmodelogos: don't look them up for NFL", `249` for the NFL abbreviation path.)
2. **Any colour you wrote by hand.** If it is not a Bootstrap semantic class or a `hulk-*`
   ramp class, it has no dark half.

Dark mode must be **emulated**, never faked by toggling a class — see §10.

## 7. Tables and numbers

- **Alignment:** team/coach name column **left** (`text-left text-nowrap`); everything else
  **centered**; a trailing numeric column may be `text-right`. #228: *"these columns should all
  be centered, except for the team name"*, *"This column should be centered"*, *"This should be
  left justified to match our existing style on the team leaderboards"*.
- **Bolding is per-column, not per-row.** The coach/primary name is `<strong>`; a team-name cell
  inside a link is **not**. `066deb43` "hotfix(leaderboards): align bolding" removed the
  `<strong>` from the team cell that the coach cell legitimately has.
- **A secondary metric is its own indented row, not a stacked span in the value cell.** Both
  `44b98fb4` and `e0834ce3` replaced
  ```astro
  <td class="numeral">{rows[i].value}
      <span class="text-muted text-small" style="display: block;">{roundNumber(rows[i].epa, 2, 2)} EPA</span>
  </td>
  ```
  with a following `<tr>` whose label cell is `&emsp;&emsp;EPA` and whose value cells hold the
  bare number. *Why: it keeps one number per cell so columns line up across every table.*
- **Numbers go through `roundNumber(value, power10, fixed)`** (and `generateMarginalString` for
  signed margins) — never `toFixed` inline. `07fb5030` "constants: fix rounding issues in nfl";
  #243 fixed `roundNumber` for zero decimal places.
- **Percentages render as percentages.** #224: *"This should be a %"*.
- **Small screens get the abbreviation**, not the full name. #228: *"This should also use the
  team abbreviation instead of the name if on the smaller screen sizes"*; and use the
  conference abbreviations the chart builder already uses.
- `sticky-table.css` / `5d7cd5d9` "sticky column for team name in team list" — long tables keep
  the name column sticky.
- **Table headers must match the body cell order.** `5344e605` / `3025307a` reordered
  `PlayRow.astro` cells to the canonical `Time · Offense · Play Description · EPA · WP% · WPA`
  and updated `PlaysTable.astro`'s `<thead>` in the same commit.

## 8. Copy tone

Akshay rewrote copy more often than markup. The voice is **short, plain, and non-redundant**.

- **Use the site's canonical metric names.** #224, four comments in a row: *"This needs to be
  `Explosive Play Rate` to match existing convention"*, *"This needs to be Success Rate to match
  existing convention"*, *"Opportunity Conversion Rate"*, *"Havoc Rate"*. `generateTeamMetricTitle`
  and `SDV_BASE_METRIC_TITLES` in `utils/misc.ts` are the register.
- **Delete anything the UI already says.** #228: *"This is already implied by the link and thus
  needs to be removed"*, *"Noting the week is unnecessary when it's at the top of the page"*,
  *"This part of the caption is not needed"*, *"Conference name is not necessary if only one is
  selected"*, *"I think we can safely ditch the poll name given the dropdown"*. #223, twice:
  *"This is duplicating information because these plays are already in their own sections"*,
  *"Yeah this is all duplicated information that is already exposed on the page."*
- **No explanatory essay where a sentence works.** The clearest single example is
  `01cf4514`, whose message is literally **"penalty breakdown: remove claudism"**:

  ```diff
  - Accepted penalties only. A flag on a kick counts as special teams whichever side it fell on;
  - otherwise the unit is whether the penalised team had the ball.
  + Accepted penalties only. Flags on kicks count as special teams, regardless of if the penalized
  + team was offense or defense.
  ```

  Same class, `4bfaa7e8` "PGWE: fix copy" on `PaperIndex.astro`:

  ```diff
  - Who {completed ? "won" : "is winning"} this game on paper: efficiency, explosiveness,
  - finishing drives, field position, havoc, and turnovers — each in its advanced-box form,
  - weighted by how much it decides real games.
  + AKA post-game win expectancy. Inspired by <a href="…">Bill Connelly</a>'s SP+ PGWE models.
  ```

  and `6e6c422d` on `data-sources.astro`, which cut the subtitle to *"Data sources, freshness,
  and limitations"* and deleted the duplicated FAQ block outright (the page still spells it
  "souces" [sic] — a live typo on `data-sources.astro`, unflagged, owed a fix).
  *Tells: em-dash-joined enumerations, hedged sub-clauses ("whichever side it fell on"), British
  spelling ("penalised"), and a sentence that restates the heading. Prefer naming the prior art.*
- **Punctuation:** colons, not dashes — #226: *"use colons instead of dashes"*. No interpunct/dot
  separators — #222: *"replace dot with 'by'"*, *"Use slashes or dashes instead of the dots"*,
  *"Use a dash here instead of a dot"*; #228: *"the dot does not match the rest of our standards"*.
  Titles take a parenthetical: `44b98fb4` changed *"Situational by period"* → *"Situational (by period)"*.
- **Watch for missing whitespace around `<a>` tags** in rendered prose — #226 flagged exactly that.
- **`cleanField`'s lowercase easter egg is intentional.** `MEME_LIST = [61]` and
  `MEME_STRING_LIST = ["Georgia Bulldogs"]` render that team's name lowercase; `a0a15688` had to
  add `formatCoachString` to a brand-new table because it printed `row.coach` directly. Route
  team- and coach-derived strings through the helpers and you get this for free.
- **Structure:** a new footer sentence is its own `<p>` (#228), a new page needs a nav-header link
  (#228 *"We need to add links to these in the nav header"*, `60f17b96` "data: fix spacing + add
  link to header"), a subtitle belongs under the card title (#222), and static content pages set
  `export const prerender = true` (#226).
- **Changelog entries only when the UI is public.** #221: *"This changelog is unnecessary until we
  actually build the UI for all of these views"*; `9ccb96d6` "changelog: remove feature that is
  still behind a feature flag".

---

## 9. Everything that is not a bug fix ships behind a preview flag

**Rule: if the change is not a fix to already-public behaviour, it lands gated.** New pages, new
features, new sections, restyles of public surfaces, new data surfaces — all `'preview'` first.
Only a fix to behaviour the public already sees lands unflagged.

*Why: preview is how the design owner reviews on production data. An ungated new surface makes
the review and the launch the same event, which is exactly what produced the #218–#256 rework pile.*

### The mechanism

`astro/src/utils/features.ts` holds one map:

```ts
export const FLAGS: Record<string, FeatureState> = { 'game-page-v2': 'preview', … };
// 'off' -> nobody | 'preview' -> viewers holding a valid preview cookie | 'on' -> everyone
```

- **In a component or page:** `isFeatureEnabled('my-flag', Astro.locals) && <NewThing />`.
- **For a whole URL namespace:** gate once in `astro/src/middleware.ts`, which rewrites to `/404`
  for a viewer without the cookie — the pattern `nfl` and `coaches` use. `astro/src/utils/coaches.ts`
  `isCoachBoardPath` is how a namespace declares its paths. A gate, not a route rewrite: the URL
  and the page file stay one-to-one.
- **Existing examples to copy:** `'nfl'` (the whole `pages/nfl/**` tree, the header league switch,
  the sitemap's `/nfl` URLs — PR #238), `'game-page-v2'` (the rebuilt game page; public traffic gets
  `components/game/classic/`), `'coaches'` (`/coaches/*`, `/year/N/coaches/*` and the `/nfl` twins —
  PR #258), `'scoreboard-compact'`.
- **Sitemap and nav must respect the flag too** — both `nfl` and `coaches` exclude their URLs while
  gated (PRs #255, #258).

### Minting a preview view (`astro/src/utils/preview.ts`)

| Route in | How |
|---|---|
| Own browser | `/admin` → the **`Preview: …`** toggle button (`POST /admin/api/preview`) sets the `gop_preview` cookie, TTL `PREVIEW_TTL_S` = 30 days |
| Anyone else, no login | `/admin` → **`Copy preview link`** (`POST /admin/api/preview-link`) mints `?preview_key=<signed token>`, valid `PREVIEW_LINK_TTL_S` = 14 days. One click on any browser sets the 30-day cookie |
| Guaranteed render | the link lands on **`/preview/<path>`** (`PREVIEW_PATH_PREFIX`), which is never cached. A clean URL can be served from a Workers Caching HIT, which never runs middleware and so ignores the cookie |

Both tokens are HMAC'd with the `ADMIN_PASS` secret. `withPreviewCacheGuard` in `middleware.ts`
forces every preview response uncacheable — a preview variant in Workers Caching would be served
to everyone (the bug reviewed on #213).

### Promoting to public

Promotion is a **separate, reviewed one-line commit**: `'preview'` → `'on'` in `FLAGS`, nothing
else. `features.ts` says it in the file: *"Ship a feature as 'preview', eyeball it on production
data via the admin panel's Preview toggle, then PROMOTE it with a one-line 'preview' -> 'on'
change -- promotion stays a reviewed commit."* **Akshay and Saiem decide when a flag flips**; the
author's job is to hand them a preview link. Once a flag is `'on'`, delete the superseded tree
(the `game-page-v2` comment: *"Promote by flipping to 'on' and deleting classic/"*).

### The classic/v2 twin — consequence for bug fixes

Because `game-page-v2` is `'preview'`, **public traffic renders
`astro/src/components/game/classic/`** while `components/game/**` is preview-only. A fix to public
behaviour must reach the twin the public actually sees. PR #250 fixed 4th-down penalty shading in
`game/plays/PlayRow.astro`; the deployed page was still wrong because the public renders
`classic/PlayRow.astro` — fixed a second time in #251. Put shared logic in `astro/src/utils/`
(as `playShade.ts` and `latestDrive.ts` did) and grep `classic/` for a twin before you call a
game-page fix done. Note that **`pr-evidence.yml` forces preview flags on**, so its screenshots
and Lighthouse runs only ever see v2 — they cannot catch a classic-only regression.

---

## 10. How to self-check before opening a PR

1. **Read this file and the §1 files you are about to touch.** Then open the §1 reference page for
   your surface, in the browser, and put your work beside it.
2. **`git log --author=akeaswaran --since=<3 months ago> -- astro/`** — recent corrections are the
   freshest statement of the conventions, and several post-date this file.
3. **Run the local gates:** `cd astro && npx vitest run` and `cd python && pytest`. (`astro check` /
   `astro build` need Node ≥ 22.12 and often can't run locally; CI covers the templates.)
4. **Shoot the four-shot matrix** — {desktop 1280×800, mobile 390×844} × {light, dark}:
   ```bash
   cd astro && BASE=https://gameonpaper.com npm run visual-check -- <routes…>
   ```
   `astro/scripts/visual-check.mjs`. Dark mode must be **emulated** (`prefers-color-scheme`), not a
   class toggle; mobile must be a real narrow viewport. Shoot a `/nfl` route together with its `cfb`
   twin — they share components. See the repo `CLAUDE.md` for the full recipe.
5. **Check the flag** (§9): is this a bug fix to public behaviour? If not, it is `'preview'`, and
   the PR includes the preview link you minted. If it *is* a public fix, check `classic/` for a twin.
6. **Let `.github/workflows/pr-evidence.yml` post the evidence** — the four screenshots plus a
   base-vs-head Lighthouse comparison, in one PR comment. Never paste numbers it didn't measure.
   Run it locally with `astro/scripts/lighthouse-compare.mjs`.

## 11. The review checklist Akshay applies

Read your own diff against this list before he has to.

- [ ] Every logo goes through `DarkModeLogos` — dark mode **and** `SPECIAL_IMAGES` overrides.
- [ ] Every team/coach/location string goes through `cleanField` / `cleanAbbreviation` / `cleanLocation` / `cleanName`.
- [ ] Good/bad shading is **green → purple** (`generateColorRampValue` → `hulk-bg-level-*`), never green/red.
- [ ] Table alignment: name left, the rest centered. Bolding matches the column, not the row.
- [ ] One number per cell; a secondary metric is its own indented row. All numbers via `roundNumber`. Percentages show `%`.
- [ ] `<thead>` order matches the body cells.
- [ ] Logo and text are vertically aligned.
- [ ] Panels, not cards, on the game page; `mb-md-3` spaces stacked panels from `md` (≥768px) up, `mb-3` if the phone layout needs the gap; no stacked redundant margins.
- [ ] Filter pills use `FilterGroup`, buttons `btn btn-sm btn-outline-secondary`.
- [ ] Responsive infixes are real Bootstrap (`sm`/`md`/`lg`/`xl`, **never `xs`**).
- [ ] Small screens show abbreviations, not full names.
- [ ] Dimension switching is a dropdown, like the leaderboards.
- [ ] No new font, no hex literal, no inline margin/padding, no new spacing class.
- [ ] Copy: canonical metric names; nothing the UI already says; colons not dashes; no dot separators; no em-dash essay.
- [ ] Metric explanations went to the glossary, not a new page. Static pages set `prerender = true`.
- [ ] New page is linked from the nav header; a new footer sentence is its own `<p>`.
- [ ] Changelog entry only if the UI is public.
- [ ] Shared/reusable logic lives in `src/utils/` (or `sportsdataverse-py` for processor logic), not `src/lib/` and not duplicated.
- [ ] Not a public bug fix → behind a `'preview'` flag, with a preview link in the PR. Public fix → the `classic/` twin got it too.
- [ ] The four screenshots and the Lighthouse comparison are on the PR.
