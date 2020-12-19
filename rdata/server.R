library(plumber)
library(logger)
library(tictoc)

root_ip <- Sys.getenv("ROOT_IP")
print(paste0("Running on system IP: ", root_ip))
print(paste0("is system IP NA: ", is.na(root_ip)))

# Logging from https://rviews.rstudio.com/2019/08/13/plumber-logging/
# Specify how logs are written
log_dir <- "logs"
if (!fs::dir_exists(log_dir)) fs::dir_create(log_dir)
log_appender(appender_tee(tempfile("plumber_", log_dir, ".log")))

convert_empty <- function(string) {
  if (string == "") {
    "-"
  } else {
    string
  }
}

pr <- plumb("routes.R")

pr$registerHooks(
  list(
    preroute = function() {
      # Start timer for log info
      tictoc::tic()
    },
    postroute = function(req, res) {
      end <- tictoc::toc(quiet = TRUE)
      # Log details about the request and the response
      log_info('[rdata] {convert_empty(req$REMOTE_ADDR)} {convert_empty(req$HTTP_HOST)} {convert_empty(req$REQUEST_METHOD)} {convert_empty(req$PATH_INFO)} {convert_empty(res$status)} {round(end$toc - end$tic, digits = getOption("digits", 5))}')
    }
  )
)

# this is purposefully not set in GCP 
if(is.na(root_ip) || root_ip == '') {
  pr_run(pr, port=7000)
} else {
  pr_run(pr, host = "0.0.0.0", port=7000)
}
