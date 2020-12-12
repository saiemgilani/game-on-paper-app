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
  cfb_game_box_advanced(as.numeric(gameId))
}

#* Returns current server status
#* @get /healthcheck
function() {
  list(status = "OK")
}

#* Returns expected points predictions using cfbscrapR's model
#* @post /ep/predict
function(data) {
# "TimeSecsRem",
# "down",
# "distance",
# "yards_to_goal",
# "log_ydstogo",
# "Goal_To_Go",
# "Under_two",
# "pos_score_diff_start"
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
  # print(res)
  return(list(predictions = res, count = nrow(res)))
}

#* Returns win probability predictions using cfbscrapR's model
#* @post /wp/predict
function(data) {
  res <- predict(wp_model, new_data = data, type = "response")
  return(res)
}