// import logger from '../../utils/logger.js';
import glossaryRaw from '../static/glossary.json' with { type: 'json' };
import { LAST_YEAR } from '../utils/constants';
import { FLAGS } from '../utils/features';

// The head-coach boards sit behind the 'coaches' flag and middleware 404s them
// for the public. The glossary PRERENDERS (no preview cookie at build time), so
// it follows the flag's build-time state like the sitemap does: until 'coaches'
// is 'on', drop the "Shown on the ... board." pointer sentences, unwrap any other
// coach-board link to its text, and blank a source that is a coach board.
const COACH_BOARD_POINTER = /\s*Shown on the <a href='\/year\/\{season\}\/coaches\/[^']*'>[^<]*<\/a>[^.]*\./g;
const COACH_BOARD_LINK = /<a href='\/year\/\{season\}\/coaches\/[^']*'>([^<]*)<\/a>/g;
const COACH_BOARD_SOURCE = /^https:\/\/gameonpaper\.com(\/nfl)?(\/year\/[^/]+)?\/coaches(\/|$)/;

export function withoutCoachBoards(entry: GlossaryEntry): GlossaryEntry {
    return {
        ...entry,
        definition: entry.definition.replace(COACH_BOARD_POINTER, '').replace(COACH_BOARD_LINK, '$1'),
        source: COACH_BOARD_SOURCE.test(entry.source) ? '' : entry.source,
    };
}

export interface GlossaryEntry {
	term: string;
	definition: string;
	source: string;
}
type Glossary = Map<string, GlossaryEntry[]>;
const ALPHABET = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];

export function generateGlossaryItems(): Glossary {
    let glossary: Glossary = new Map<string, GlossaryEntry[]>();
    try {
        console.info(`Loading glossary...`)
        ALPHABET.forEach(letter => {
            let records = (glossaryRaw as Record<string, GlossaryEntry[]>)[letter];
            if (records) {
                // Leaderboard links in the copy are written as /year/{season}/... so
                // the JSON never goes stale; resolve to the latest finished season here.
                const coachesPublic = FLAGS['coaches'] === 'on';
                let copyRec = records
                    .map((r) => (coachesPublic ? r : withoutCoachBoards(r)))
                    .map((r) => ({ ...r, definition: r.definition.replaceAll('{season}', String(LAST_YEAR)) }));
                copyRec.sort((a, b) => {
                    return a.term.localeCompare(b.term)
                });
                glossary.set(letter, copyRec);
            }
        });

        console.info(`Loaded glossary for ${glossary.size} letters`)
        // return glossary;
    } catch (err) {
        console.error(`ERROR while loading glossary: ${err}`)
    } finally {
        return glossary;
    }
    
}