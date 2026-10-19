// D29 (resolutions R3, R4): shots a provider parks at a placeholder location (stats.wnba.com's hoop centre, 1997-2010) are
// left out of the hex / zone / distance / side charts and counted in a note. A league with no placeholderLocation (the NBA)
// gets its shots back untouched, so its dashboards, 1998-2010 included, do not change. The note's sentence lives only here.

/** A league's placeholder point in the legacy court frame (tenths of a foot, hoop at the origin) and its last season (R22). */
export interface PlaceholderLocation { readonly x: number; readonly y: number; readonly through: number }

/** R22: the placeholder applies only through its last season; after it a shot at that point is a real shot. */
export function placeholderAt(loc: PlaceholderLocation | null | undefined, season: number): PlaceholderLocation | null {
    return loc && season <= loc.through ? loc : null;
}

/** The shots at a real location, and how many sat at the placeholder. Without `at`, the same array and 0. */
export function placeholderSplit<T extends { x_legacy: number; y_legacy: number }>(shots: T[], at?: PlaceholderLocation | null): { located: T[]; unlocated: number } {
    if (!at) return { located: shots, unlocated: 0 };
    const located = shots.filter((s) => !(s.x_legacy === at.x && s.y_legacy === at.y));
    return { located, unlocated: shots.length - located.length };
}

/** "N of M shots [this season] have no recorded location." ('' when N is 0): dashboards say 'season', game charts 'game'. */
export function placeholderNote(unlocated: number, total: number, scope: 'game' | 'season'): string {
    if (unlocated <= 0) return '';
    const n = (v: number) => v.toLocaleString('en-US');
    return `${n(unlocated)} of ${n(total)} shots ${scope === 'season' ? 'this season ' : ''}have no recorded location.`;
}
