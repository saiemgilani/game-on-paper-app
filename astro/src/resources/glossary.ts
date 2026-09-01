// import logger from '../../utils/logger.js';
import glossaryRaw from '../static/glossary.json' with { type: 'json' };
import { LAST_YEAR } from '../utils/constants';

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
                let copyRec = records.map((r) => ({ ...r, definition: r.definition.replaceAll('{season}', String(LAST_YEAR)) }));
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