// Dataset manifests: which named datasets the game page needs, and whether a
// render was ok / degraded (salvageable) / failed (whole-page error). PURE.

export type ManifestEntry = { name: string; need: 'required' | 'optional'; check: (g: any) => boolean };

// Field names below are the real `ProcessedGame` shape (astro/src/resources/internal.ts):
// box score ships as `advBoxScore` (not `boxScore`); there is no `pickcenter`/`leaders`
// sub-payload on the processed game (those are raw-ESPN-summary concepts that don't
// survive the python /cfb/process step) — the closest real optional data is the
// top-level spread/O-U pair (`homeTeamSpread`/`overUnder`) and `broadcasts`.
export const GAME_PAGE_MANIFEST: ManifestEntry[] = [
  { name: 'header',         need: 'required', check: (g) => !!(g && (g.gameInfo || g.header)) },
  { name: 'plays',          need: 'required', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 },
  { name: 'boxscore',       need: 'required', check: (g) => !!(g?.advBoxScore || g?.boxScore || g?.boxscore) },
  { name: 'winprobability', need: 'optional', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 && g.plays.every((p: any) => p?.winProbability != null) },
  { name: 'odds',           need: 'optional', check: (g) => typeof g?.homeTeamSpread === 'number' && typeof g?.overUnder === 'number' },
  { name: 'broadcasts',     need: 'optional', check: (g) => Array.isArray(g?.broadcasts) && g.broadcasts.length > 0 },
  { name: 'drives',         need: 'optional', check: (g) => !!(g?.drives && Array.isArray(g.drives.previous) && g.drives.previous.length > 0) },
];

export function evaluateManifest(manifest: ManifestEntry[], game: unknown) {
  const missing = manifest.filter((m) => {
    try { return !m.check(game ?? {}); } catch { return true; }
  });
  const requiredMissing = missing.filter((m) => m.need === 'required').map((m) => m.name);
  return {
    outcome: (requiredMissing.length ? 'failed' : missing.length ? 'degraded' : 'ok') as 'ok' | 'degraded' | 'failed',
    missingNames: missing.map((m) => m.name),
    requiredMissing,
  };
}

// Neutral backfill so a missing optional dataset cannot crash templates that
// read play.winProbability.before/added/after per play.
export function salvageGame(game: any) {
  if (game && Array.isArray(game.plays)) {
    for (const p of game.plays) {
      if (p && p.winProbability == null) p.winProbability = { before: 0.5, after: 0.5, added: 0.0 };
    }
  }
  return game;
}
