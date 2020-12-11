cfb-data-api
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run `docker-compose up --build`. That will install all python and node dependencies, along with start the services in a Docker container.

Test the actual API requests using Postman -- Send a GET request to `localhost:5000/cfb/pbp?gameId=<ESPN gameId>`.

## To-Do:

- [X] Docker container to encapsulate both services
- [X] Data manipulation to get epEnd input variables
- [X] Figure out how to calculate ExpScoreDiff for WPA
- [X] Figure out how to get timeouts for WPA
- [X] Frontend pages?
- [ ] Advanced Box Scores?
- [ ] Test requests during a live game
