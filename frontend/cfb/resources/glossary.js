const logger = require("../../utils/logger");
const fs = require("fs/promises")
const path = require("path")
const { ALPHABET } = require("../../utils/misc");

async function generateGlossaryItems() {
    const glossaryPath = path.resolve(__dirname, "..", "..", "static", "glossary.json");
    try {
        logger.info(`Loading glossary from path ${glossaryPath}...`)
        const data = await fs.readFile(glossaryPath, { encoding: "utf-8" })
        const tmpGloss = JSON.parse(data);
        let glossary = {};
        ALPHABET.forEach(letter => {
            let records = tmpGloss[letter];
            if (records) {
                let copyRec = [...records];
                copyRec.sort((a, b) => {
                    return a.term.localeCompare(b.term)
                });
                result[letter] = copyRec;
            }
        });

        logger.info(`Loaded glossary for ${Object.keys(glossary)} letters`)
        return glossary;
    } catch (err) {
        logger.error(err)
        return {}
    }
    
}
module.exports = {
    generateGlossaryItems
}