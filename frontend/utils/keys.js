function generateKey(parts, sep = "-") {
    const valid = parts.filter(p => p != null)
    if (valid.length == 0) {
        throw new Error("invalid key")
    }
    return valid.join(sep)
}


function getPercentileKey(metric) {
    switch (metric) {
        case "overall.epaPerPlay": 
            return "epaPerPlay";
        case "overall.yardsPerPlay": 
            return "yardsPerPlay";
        case "overall.successRate": 
            return "successRate";
        case "passing.epaPerPlay": 
            return "epaPerDropback";
        case "passing.yardsPerPlay": 
            return "yardsPerDropback";
        case "passing.successRate": 
            return "passingSuccessRate";
        case "rushing.epaPerPlay": 
            return "epaPerRush";
        case "rushing.yardsPerPlay": 
            return "yardsPerRush";
        case "rushing.successRate": 
            return "rushingSuccessRate";
        case "overall.havocRate": 
            return "havocRate";
        case "passing.explosiveRate":
            return "passingExplosivePlayRate";
        case "rushing.explosiveRate":
            return "rushingExplosivePlayRate";
        case "rushing.opportunityRate":
            return "rushOpportunityRate";
        case "rushing.lineYards":
            return "lineYards";
        case "rushing.stuffedPlayRate":
            return "playStuffedRate";
        case "overall.explosiveRate":
            return "explosivePlayRate";
        case "overall.nonExplosiveEpaPerPlay":
            return "nonExplosiveEpaPerPlay";
        case "overall.earlyDownEPAPerPlay":
            return "earlyDownEpaPerPlay";
        case "overall.lateDownSuccessRate":
            return "lateDownSuccessRate";
        case "overall.thirdDownDistance":
            return "thirdDownDistance";
        default:
            return metric;
    }
}


module.exports = {
    generateKey,
    getPercentileKey
}