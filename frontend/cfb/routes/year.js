const express = require('express');
const cachePage = require('../../utils/cache');
const SummaryModel = require("../resources/summary")
const GamesModel = require("../resources/game")
const Teams = require("../resources/team")
const logger = require("../../utils/logger");

const router = express.Router();
logger.info("activating years page cache")
router.use(cachePage(60 * 60 * 24)) // 1 day TTL for stuff that doesn't change

function retrieveValue(dictionary, key) {
    const subKeys = key.split('.')
    let sub = dictionary;
    for (const k of subKeys) {
        sub = sub[k];
    }
    return sub;
}


router.get('/year/:year', async (req, res, next) => {
        try {
            let gameList = await GamesModel.retrieveGameList(req.originalUrl, { year: req.params.year, week: 1, type: 2, group: req.query.group });
            let weekList = Schedule.getWeeksMap();
            let groupList = Schedule.getGroups();
            return res.render('pages/cfb/index', {
                scoreboard: gameList,
                weekList: weekList,
                groups: groupList,
                year: req.params.year,
                week: 1,
                seasontype: 2,
                group: req.query.group || 80
            });
        } catch(err) {
            return next(err)
        }
    });


router.get('/charts/team/epa', async (req, res, next) => {
        try {
            const baseData = await SummaryModel.retrieveLeagueData(req.params.year, "overall") 

            let content = baseData.map(t => {
                // let target = t[type]
                return {
                    teamId: t.teamId,
                    team: t.team,
                    fbsClass: t.fbsClass,
                    adjOffEpa: t["offensive"]["overall"]["adjEpaPerPlay"],
                    adjDefEpa: t["defensive"]["overall"]["adjEpaPerPlay"],
                }
            })

            return res.render("pages/cfb/epa_chart", {
                teams: content,
                season: req.params.year,
                last_updated: await retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.get('/teams/:type', async (req, res, next) => {
        try {
            const type = req.params.type ?? "differential";
            let sortKey = req.query.sort ?? `overall.adjEpaPerPlay`
            // can't do passing/rushing/havoc differentials
            if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
                sortKey = `overall.adjEpaPerPlay`
            }
            const asc = (type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
            const baseData = await SummaryModel.retrieveLeagueData(req.params.year, "overall") 

            let content = baseData.map(t => {
                let target = t[type]
                return {
                    teamId: t.teamId,
                    team: t.team,
                    ...target
                }
            })
            // logger.info(content[0])
            content = content.filter(p => {
                const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
                const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
                if (sortKey.includes("adjEpaPerPlay")) {
                    return true
                }
                return nonNullRank && nonNullValue
            }).sort((a, b) => {
                const aVal = retrieveValue(a, sortKey)
                const bVal = retrieveValue(b, sortKey)
                
                if (aVal == null & bVal != null) {
                    return 1
                } else if (aVal != null & bVal == null) {
                    return -1
                } else if (aVal == null & bVal == null) {
                    return 0
                } else {
                    const compVal = parseFloat(aVal) - parseFloat(bVal)
                    return asc ? compVal : (-1 * compVal)
                }
            })
            // logger.info(content[0])
            // return res.json(content);
            return res.render("pages/cfb/leaderboard", {
                teams: content,
                type,
                season: req.params.year,
                sort: sortKey,
                last_updated: await SummaryModel.retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.get('/players/:type', async (req, res, next) => {
        try {
            const type = req.params.type ?? "passing";
            let sortKey = req.query.sort ?? `advanced.epaPerPlay`
            // // can't do passing/rushing/havoc differentials
            // if (type == "differential" && (!sortKey.includes("overall") || sortKey.includes("havocRate"))) {
            //     sortKey = `overall.epaPerPlay`
            // }
            const asc = false;//(type == "defensive" && sortKey != "overall.havocRate") || (type == "offensive" && sortKey == "overall.havocRate") // adjust for defensive stats where it makes sense
            let content = await SummaryModel.retrieveLeagueData(req.params.year, type) 

            content = content.filter(p => {
                const nonNullValue = retrieveValue(p, sortKey) != null && retrieveValue(p, sortKey) != "NA"
                const nonNullRank = retrieveValue(p, `${sortKey}Rank`) != null && retrieveValue(p, `${sortKey}Rank`) != "NA"
                return nonNullRank && nonNullValue
            }).sort((a, b) => {
                const compVal = parseFloat(retrieveValue(a, sortKey)) - parseFloat(retrieveValue(b, sortKey))
                return asc ? compVal : (-1 * compVal)
            })
            // return res.json(content);
            return res.render("pages/cfb/player_leaderboard", {
                players: content,
                type,
                season: req.params.year,
                sort: sortKey,
                last_updated: await SummaryModel.retrieveLastUpdated()
            })
        } catch(err) {
            return next(err)
        }
    })

router.get('/players', async (req, res, next) => {
    return res.redirect(`/cfb/year/${req.params.year}/players/passing`);
})

router.get('/team/:teamId', async (req, res, next) => {
        try {
            let data = await Teams.getTeamInformation(req.params.year, req.params.teamId)
            if (data == null) {
                throw Error(`Data not available for team ${req.params.teamId} and season ${req.params.year}. An internal service may be down.`)
            }
    
            if (req.query.json == true || req.query.json == "true" || req.query.json == "1") {
                return res.json(data);
            } else {
                const brkd = await SummaryModel.retrieveTeamData(req.params.year, req.params.teamId, 'overall')
                // logger.info(brkd[0])
                return res.render('pages/cfb/team', {
                    teamData: data,
                    breakdown: brkd,
                    players: {
                        passing: await SummaryModel.retrieveTeamData(req.params.year, req.params.teamId, 'passing'),
                        rushing: await SummaryModel.retrieveTeamData(req.params.year, req.params.teamId, 'rushing'),
                        receiving: await SummaryModel.retrieveTeamData(req.params.year, req.params.teamId, 'receiving')
                    },
                    season: req.params.year
                });
            }
        } catch(err) {
            return next(err)
        }
    })


router.get('/teams', async (req, res, next) => {
    return res.redirect(`/cfb/year/${req.params.year}/teams/differential`);
})

module.exports = router;