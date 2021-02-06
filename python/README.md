# **Data Sources**
---
### **College Football - ESPN**
```Python
# play by play
pbp_url = "http://cdn.espn.com/core/college-football/playbyplay?gameId={}&xhr=1&render=false&userab=18".format(self.gameId)

# summary for pickcenter
summary_url = "http://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={}".format(self.gameId)
                
```

### **College Basketball - ESPN**
```Python
# play by play
pbp_url = "http://cdn.espn.com/mens-college-basketball/playbyplay?gameId={}&xhr=1&render=false&userab=18".format(self.gameId)

# summary for pickcenter
summary_url = "http://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event={}".format(self.gameId)

# schedule (date = YYYYMMDD)
schedule_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&dates={}".format(self.date)
```