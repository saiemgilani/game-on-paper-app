function generateKey(parts, sep = "-") {
    const valid = parts.filter(p => p != null)
    if (valid.length == 0) {
        throw new Error("invalid key")
    }
    return valid.join(sep)
}

module.exports = {
    generateKey
}