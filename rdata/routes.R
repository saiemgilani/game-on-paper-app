# routes.R
library(cfbscrapR)

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