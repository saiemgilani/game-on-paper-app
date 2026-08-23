// Dataset manifests: which named datasets the game page needs, and whether a
// render was ok / degraded (salvageable) / failed (whole-page error). PURE.

export type ManifestEntry = { name: string; need: 'required' | 'optional'; check: (g: any) => boolean };

// Field names below are the real `ProcessedGame` shape (astro/src/resources/python.ts):
// `header`, `plays`, `advBoxScore` (not `boxScore`), per-play `winProbability`,
// `drives.previous/current`.
export const GAME_PAGE_MANIFEST: ManifestEntry[] = [
  { name: 'header',         need: 'required', check: (g) => !!(g && g.header) },
  { name: 'plays',          need: 'required', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 },
  { name: 'boxscore',       need: 'required', check: (g) => !!g?.advBoxScore },
  { name: 'winprobability', need: 'optional', check: (g) => Array.isArray(g?.plays) && g.plays.length > 0 && g.plays.every((p: any) => p?.winProbability != null) },
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
// read play.winProbability.before/added/after per play, or game.drives.current
// unguarded (GamePage.astro). `{ previous: [] }` renders the "No drives" empty
// state; `.current` is only truthiness-checked, never dereferenced deeper. The
// manifest drives check (previous.length > 0) still reports it missing.
export function salvageGame(game: any) {
  if (game && Array.isArray(game.plays)) {
    for (const p of game.plays) {
      if (p && p.winProbability == null) p.winProbability = { before: 0.5, after: 0.5, added: 0.0 };
    }
  }
  if (game && game.drives == null) game.drives = { previous: [] };
  return game;
}
