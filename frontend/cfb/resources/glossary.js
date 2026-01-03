const alphabet = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"];
async function generateGlossaryItems() {
    let glossary = {};
    fs.readFile(path.resolve(__dirname, "..", "..", "static", "glossary.json"), function (err, data) {
        if (err) {
            debuglog(err)
            throw err;
        }
        debuglog(`Loading glossary...`)
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

        debuglog(`Loaded glossary for ${Object.keys(glossary)} letters`)
    });
    return glossary;
}
module.exports = {
    generateGlossaryItems
}