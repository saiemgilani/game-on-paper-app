library(plumber)

pr("routes.R") %>%
  pr_run(host = "0.0.0.0", port=7000)