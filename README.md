cfb-data-api
---

## Development

Make sure you have Docker installed. Once you do, `cd` into the repo and run `docker-compose up --build`. That will install all python and node dependencies, along with start the services in a Docker container.

If you want to run the app like it would be run on a server in Google Cloud Run:

```Shell
$ docker build -t <whatever you want to name the image> .
$ docker run -d -it -p 8000:8000 --name=game-on-paper <what you named the image>
```

Test API requests using Postman -- Send a GET request to `localhost:5000/cfb/pbp/<ESPN gameId>`.
Test the frontend using a browser -- load up `localhost:8000/cfb/pbp/<ESPN gameId>`.

## To-Do:

- [X] Docker container to encapsulate both services
- [X] Data manipulation to get epEnd input variables
- [X] Figure out how to calculate ExpScoreDiff for WPA
- [X] Figure out how to get timeouts for WPA
- [X] Frontend pages
- [X] Advanced Box Scores
- [X] Test requests during a live game
- [ ] Postgame win probabilities
- [ ] EPA in box scores
