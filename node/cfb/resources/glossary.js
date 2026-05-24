import logger from '../../utils/logger.js';
import { ALPHABET } from '../../utils/misc.js';
import glossaryRaw from '../../static/glossary.json' with { type: 'json' };

function generateGlossaryItems() {
    try {
        logger.info(`Loading glossary...`)
        let glossary = {};
        ALPHABET.forEach(letter => {
            let records = glossaryRaw[letter];
            if (records) {
                let copyRec = [...records];
                copyRec.sort((a, b) => {
                    return a.term.localeCompare(b.term)
                });
                glossary[letter] = copyRec;
            }
        });

        logger.info(`Loaded glossary for ${Object.keys(glossary)} letters`)
        return glossary;
    } catch (err) {
        logger.error(err)
        return {}
    }
    
}
export {
    generateGlossaryItems
}