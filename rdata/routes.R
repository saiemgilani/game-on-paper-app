# routes.R
library(cfbscrapR)
library(mgcv)

# load models
load("models/fg_model.RData")
load("models/wp_model.RData")
load("models/ep_model.RData")

#* Return the advanced box score from CFBData
#* @param gameId the ESPN gameId to return data for
#* @post /box
function(gameId) {
  return(
    tryCatch({
        cfb_game_box_advanced(as.numeric(gameId))
        }, 
        error=function(cond) {
            # message(paste("URL does not seem to exist:", url))
            # message("Here's the original error message:")
            print(cond)
            # Choose a return value in case of error
            list()
        }
    )
  )
}

#* Returns current server status
#* @get /healthcheck
function() {
  return(list(status = "OK"))
}

#* Returns expected points predictions using cfbscrapR's model
#* @post /ep/predict
function(data) {
  # print(data)
  base <- as.data.frame(data)
  colnames(base) <- c(
    "TimeSecsRem",
    "down",
    "distance",
    "yards_to_goal",
    "log_ydstogo",
    "Goal_To_Go",
    "Under_two",
    "pos_score_diff_start"
  )
  # print(base)
  base$down <- as.factor(base$down)
  base$Under_two = as.logical(base$Under_two)
  base$Goal_To_Go = as.logical(base$Goal_To_Go)
  res <- data.frame(predict(ep_model, newdata = base, type = "probs"))

  return(list(predictions = res, count = nrow(res)))
}

#* Returns win probability predictions using cfbscrapR's model
#* @post /wp/predict
function(data) {
  base <- as.data.frame(data)
  colnames(base) <- c(
    "ExpScoreDiff",
    "half",
    "TimeSecsRem",
    "ExpScoreDiff_Time_Ratio",
    "Under_two",
    "pos_team_timeouts_rem_before",
    "def_pos_team_timeouts_rem_before"
  )

  base$Under_two = as.logical(base$Under_two)
  # print(base)
  res <- as.vector(predict(wp_model, newdata = base, type = "response"))
  # print(res)
  return(list(predictions = res, count = nrow(res)))
}