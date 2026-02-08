const logger = require("../../utils/logger");
const fs = require("fs/promises")
const path = require("path")

const alphabet = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
async function generateGlossaryItems() {
    const glossaryPath = path.resolve(__dirname, "..", "..", "static", "glossary.json");
    try {
        logger.info(`Loading glossary from path ${glossaryPath}...`)
        const data = await fs.readFile(glossaryPath, { encoding: "utf-8" })
        let glossary = {};
        const tmpGloss = JSON.parse(data);
        alphabet.forEach(letter => {
            let records = tmpGloss[letter];
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
module.exports = {
    generateGlossaryItems
}