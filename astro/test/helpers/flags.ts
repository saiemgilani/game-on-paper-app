// flagOverrides for a basketball test: every 'bball-*' preview flag forced off except the ones named, which keep their
// state (on with `preview: true`, off without it). With the whole basketball stack in, `preview: true` turns on some
// thirty features, each with its own reads; a test that mocks only its own feature's reads names that feature here and
// the rest stay off. Spread a test's own overrides after it: `{ ...bballOnly('bball-game-info'), 'bball-epv': true }`.
import { FLAGS } from '../../src/utils/features';

export const bballOnly = (...keep: string[]): Record<string, boolean> =>
    Object.fromEntries(Object.keys(FLAGS).filter((k) => k.startsWith('bball-') && FLAGS[k] === 'preview' && !keep.includes(k)).map((k) => [k, false]));
