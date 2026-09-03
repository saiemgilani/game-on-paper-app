// In-development features, hidden behind admin preview mode.
//
//   'off'      -> rendered for nobody (parked work)
//   'preview'  -> rendered only when the viewer holds a valid preview cookie
//                 (toggled from /admin; see utils/preview.ts)
//   'on'       -> rendered for everyone
//
// Ship a feature as 'preview', eyeball it on production data via the admin
// panel's Preview toggle, then PROMOTE it with a one-line 'preview' -> 'on'
// change -- promotion stays a reviewed commit, and the public path costs
// nothing (no store reads; the cookie check happens once in middleware).
//
// Usage in a component or page:
//   import { isFeatureEnabled } from '../utils/features';
//   { isFeatureEnabled('my-flag', Astro.locals) && <NewThing /> }

export type FeatureState = 'off' | 'preview' | 'on';

export const FLAGS: Record<string, FeatureState> = {
    // The rebuilt game page (#189) AND play marks (#187): public traffic gets
    // the frozen pre-v2 snapshot (components/game/classic/); the preview cookie
    // renders the new tree. Promote by flipping to 'on' and deleting classic/.
    'game-page-v2': 'preview',
};

export function isFeatureEnabled(name: string, locals: { preview?: boolean } | undefined): boolean {
    const state = FLAGS[name] ?? 'off';
    if (state === 'on') return true;
    if (state === 'preview') return locals?.preview === true;
    return false;
}
