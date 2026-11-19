// Evidence-route sanity for pr-evidence.yml: a PR that changes basketball code must
// shoot at least one basketball page. Nine basketball PRs (#438-#463) posted
// screenshots of the football default (/game/401856682, the PR template's prefill)
// because their `Evidence routes:` line was missing or pointed at football.
//
//   CHANGED="$(git diff --name-only HEAD^1 HEAD)" ROUTES="/nba /mbb" DEFAULT_ROUTES=/game/401856682 \
//     node scripts/lib/evidence-routes.mjs
//
// Exits 1 with the reason on stdout when the check fails; prints nothing otherwise.
import { pathToFileURL } from 'node:url';

const BASKETBALL_FILE = [
  /^astro\/src\/(basketball|nba|routes\/basketball|components\/nba)\//,
  /^astro\/src\/pages\/(nba|wnba|mbb|wbb)\//,
  /^astro\/src\/components\/routes\/(Basketball|Nba)[^/]*$/,
  // basketball-named reads and helpers (resources/bballScheduleContext.ts, utils/nbaCup.ts); shared ones stay unclassified
  /^astro\/src\/(resources|utils)\/(bball|nba|wnba|mbb|wbb)[A-Z][^/]*$/,
  /^astro\/public\/assets\/css\/nba\.css$/,
  /^python\/nba_game\.py$/,
];

/** A repo-relative path whose change shows on a basketball page. */
export const isBasketballFile = (f) => BASKETBALL_FILE.some((re) => re.test(f));

/** A route (path, optional query, optional /preview prefix) served by a basketball page. */
export const isBasketballRoute = (r) => /^(\/preview)?\/(nba|wnba|mbb|wbb)(\/|\?|$)/.test(r);

/**
 * @param {{ files: string[], routes: string[], defaultRoutes: string[] }} pr
 * @returns {string | null} why the evidence would not show the change, or null when it would
 */
export function checkEvidenceRoutes({ files, routes, defaultRoutes }) {
  const touched = files.filter(isBasketballFile);
  if (!touched.length || routes.some(isBasketballRoute)) return null;
  const sample = touched.slice(0, 3).join(', ') + (touched.length > 3 ? `, +${touched.length - 3} more` : '');
  const fellBack = routes.length > 0 && routes.every((r) => defaultRoutes.includes(r));
  return (fellBack
    ? `Evidence routes are the default football page (${routes.join(' ')}), but this PR changes basketball code (${sample}).`
    : `This PR changes basketball code (${sample}), but none of its evidence routes (${routes.join(' ') || 'none'}) is a basketball page.`)
    + ' Add an `Evidence routes: /nba/... /mbb/...` line to the PR description naming the basketball pages it changes, then re-run the job.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const words = (s) => (s ?? '').split(/\s+/).filter(Boolean);
  const reason = checkEvidenceRoutes({
    files: words(process.env.CHANGED),
    routes: words(process.env.ROUTES),
    defaultRoutes: words(process.env.DEFAULT_ROUTES),
  });
  if (reason) {
    console.log(reason);
    process.exitCode = 1;
  }
}
